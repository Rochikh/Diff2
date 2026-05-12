import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat", // DeepSeek model on OpenRouter
        messages: [
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter API Error:", response.status, errText);
      return res.status(response.status).json({ error: `OpenRouter API failed: ${response.statusText}` });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    
    if (!content) {
      return res.status(500).json({ error: "No content returned from OpenRouter" });
    }

    res.status(200).json({ content });

  } catch (error) {
    console.error("Error generating content:", error);
    res.status(500).json({ error: "Internal server error during content generation" });
  }
}
