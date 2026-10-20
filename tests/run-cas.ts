// Lance un cas de test réel contre DeepSeek et affiche la réponse brute,
// puis la somme des durées par version. Usage : npx tsx tests/run-cas.ts [tests/cas.json]
import { readFileSync } from 'fs';
import { validateParams, buildPrompt, callDeepSeek } from '../lib/_lib';

const file = process.argv[2] || new URL('./cas-a1-2.json', import.meta.url).pathname;
const validation = validateParams(JSON.parse(readFileSync(file, 'utf8')));
if ('error' in validation) throw new Error(validation.error);

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('DEEPSEEK_API_KEY manquante.');

const result = await callDeepSeek(buildPrompt(validation.params), apiKey);
if (result.ok === false) throw new Error(result.error);

console.log(result.content);
const data = JSON.parse(result.content);
for (const key of ['guided', 'standard', 'challenge']) {
  const steps = data[key]?.steps ?? [];
  const total = steps.reduce((sum: number, s: { minutes?: number }) => sum + (s.minutes ?? 0), 0);
  console.error(`${key} : ${steps.length} étapes, ${total} min`);
}
console.error(`organization : ${typeof data.organization === 'string' ? 'présent' : 'ABSENT'}`);
