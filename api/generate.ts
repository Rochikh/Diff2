import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  validateParams,
  buildPrompt,
  callDeepSeek,
  rateLimited,
  RATE_LIMIT_MESSAGE
} from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Le frontend est servi sur le même domaine : pas d'en-têtes CORS,
  // les appels cross-origin sont donc refusés par défaut par le navigateur.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} Not Allowed.` });
  }

  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : '') || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
  }

  try {
    const validation = validateParams(req.body);
    if ('error' in validation) {
      return res.status(400).json({ error: validation.error });
    }

    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({ error: 'DEEPSEEK_API_KEY is not configured on the server.' });
    }

    const result = await callDeepSeek(buildPrompt(validation.params), DEEPSEEK_API_KEY);
    if (result.ok === false) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(200).json({ content: result.content });
  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: 'Internal server error during content generation' });
  }
}
