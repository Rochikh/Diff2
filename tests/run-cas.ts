// Lance un cas de test réel contre DeepSeek et affiche la réponse brute,
// puis la somme des durées, le nombre de mots par champ, les contrôles bloquants
// (consignes identiques, support absent) et la taille de l'export Markdown.
// Usage : npx tsx tests/run-cas.ts [tests/cas.json]
import { readFileSync } from 'fs';
import { validateParams, buildPrompt, callDeepSeek, DIFF_TYPE_LABELS, FORMAT_LABELS } from '../lib/_lib';
import { buildMarkdown, stepToMd } from '../src/markdown';

const file = process.argv[2] || new URL('./cas-a1-2.json', import.meta.url).pathname;
const validation = validateParams(JSON.parse(readFileSync(file, 'utf8')));
if ('error' in validation) throw new Error(validation.error);
const params = validation.params;

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('DEEPSEEK_API_KEY manquante.');

const result = await callDeepSeek(buildPrompt(params), apiKey);
if (result.ok === false) throw new Error(result.error);

console.log(result.content);
const data = JSON.parse(result.content);

// Un mot = une suite sans espace contenant au moins une lettre ou un chiffre.
const words = (t: string) => (t.match(/\S+/g) ?? []).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
let overflows = 0;
let blocking = 0;
const check = (label: string, n: number, max: number) => {
  const over = n > max;
  if (over) overflows++;
  console.error(`  ${label} : ${n}/${max}${over ? '  DÉPASSE' : ''}`);
};

const extraKeys = Object.keys(data).filter(k => !['guided', 'standard', 'challenge', 'organization'].includes(k));
if (extraKeys.length) console.error(`Clés inattendues : ${extraKeys.join(', ')}`);

for (const key of ['guided', 'standard', 'challenge']) {
  const v = data[key];
  const steps: { minutes?: number; text: string }[] = v?.steps ?? [];
  const total = steps.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  console.error(`${key} : ${steps.length} étapes, ${total} min`);
  check('titre', words(v.title), 6);
  check('consigne', words(v.instruction), 70);
  if (typeof v.handout === 'string' && v.handout.trim()) check('support', words(v.handout), 120);
  else { console.error('  support : ABSENT  BLOQUANT'); blocking++; }
  check('nombre d\'étapes', steps.length, 4);
  steps.forEach((s, i) => check(`étape ${i + 1}`, words(stepToMd(s)), 30));
  check('notes formateur', words(v.supportLevel), 50);
  check('nombre de critères', v.successCriteria.length, 3);
  v.successCriteria.forEach((c: string, i: number) => check(`critère ${i + 1}`, words(c), 15));
  check('prolongement', words(v.extension), 20);
}
if (params.diffType === 'etayage' || params.diffType === 'autonomie') {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const pairs: [string, string][] = [['guided', 'standard'], ['standard', 'challenge'], ['guided', 'challenge']];
  for (const [a, b] of pairs) {
    if (norm(data[a].instruction) === norm(data[b].instruction)) {
      console.error(`Consignes identiques : ${a} / ${b}  BLOQUANT`);
      blocking++;
    }
  }
}
if (typeof data.organization === 'string') {
  console.error('organization :');
  check('organisation', words(data.organization), 80);
} else {
  console.error('organization : ABSENT');
}

const markdown = buildMarkdown(data, {
  theme: params.theme,
  objective: params.objective,
  target: params.target,
  duration: params.duration,
  diffTypeLabel: DIFF_TYPE_LABELS[params.diffType],
  formatLabel: FORMAT_LABELS[params.format]
});
const size = markdown.length;
console.error(`Export Markdown : ${size} caractères (cible < 7000)${size >= 7000 ? '  DÉPASSE' : ''}`);
console.error(`Champs hors limite : ${overflows}`);
console.error(`Contrôles bloquants en échec : ${blocking}`);
