// Logique serveur utilisée par server.ts. Le prompt est construit ici, côté serveur :
// le client n'envoie que des champs de formulaire validés, jamais un prompt libre.

export const DIFF_TYPE_LABELS: Record<string, string> = {
  autonomie: "Niveau d'autonomie",
  complexite: 'Niveau de complexité',
  etayage: "Niveau d'étayage (scaffolding)"
};

export const FORMAT_LABELS: Record<string, string> = {
  individuel: 'Exercice individuel',
  binome: 'Activité en binôme',
  groupe: 'Activité de groupe',
  cas: 'Mini étude de cas',
  quiz: 'Quiz',
  situation: 'Mise en situation'
};

const VARIANT_DEFINITIONS: Record<string, string> = {
  guided: 'Version très guidée : hautement étayée, explicite, rassurante.',
  standard: 'Version standard : équilibrée, utilisable en conditions ordinaires.',
  challenge: 'Version défi : plus ouverte, exigeante, ou demandant un transfert de compétences.'
};

const MAX_DOC_CHARS = 60000;

export interface GenerateParams {
  theme: string;
  objective: string;
  target: string;
  duration: string;
  diffType: string;
  format: string;
  docText: string;
  variant: 'guided' | 'standard' | 'challenge' | null;
}

export function validateParams(body: unknown): { params: GenerateParams } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Requête invalide.' };
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max).trim() : '');

  const theme = str(b.theme, 300);
  const objective = str(b.objective, 1000);
  if (!theme || !objective) return { error: "Le thème et l'objectif pédagogique sont obligatoires." };

  const diffType = typeof b.diffType === 'string' && DIFF_TYPE_LABELS[b.diffType] ? b.diffType : 'autonomie';
  const format = typeof b.format === 'string' && FORMAT_LABELS[b.format] ? b.format : 'individuel';
  const variant =
    b.variant === 'guided' || b.variant === 'standard' || b.variant === 'challenge' ? b.variant : null;

  return {
    params: {
      theme,
      objective,
      target: str(b.target, 300),
      duration: str(b.duration, 100),
      diffType,
      format,
      docText: str(b.docText, MAX_DOC_CHARS),
      variant
    }
  };
}

const VARIANT_STRUCTURE =
  '{ "title": "...", "instruction": "...", "steps": ["..."], "supportLevel": "...", "successCriteria": ["..."], "extension": "..." }';

export function buildPrompt(p: GenerateParams): string {
  const docSection = p.docText
    ? `\nDocument de référence fourni par le formateur (à utiliser comme base de contenu pour les activités) :
"""
${p.docText}
"""
Appuie-toi prioritairement sur le contenu de ce document pour concevoir les activités (exemples, notions, vocabulaire), tout en respectant l'objectif pédagogique et le type de différenciation demandés.\n`
    : '';

  const context = `En tant qu'expert en pédagogie, tu conçois des variantes différenciées d'une activité d'apprentissage à partir des paramètres suivants :
- Thème : ${p.theme}
- Objectif pédagogique : ${p.objective}
- Public cible : ${p.target || 'non précisé'}
- Durée estimée : ${p.duration || 'non précisée'}
- Type de différenciation : ${DIFF_TYPE_LABELS[p.diffType]}
- Format souhaité : ${FORMAT_LABELS[p.format]}
${docSection}
Règles pédagogiques :
- Garde le même objectif pédagogique pour toutes les versions.
- Varie uniquement le niveau d'étayage, d'autonomie ou de complexité selon le type de différenciation choisi (${DIFF_TYPE_LABELS[p.diffType]}).
- ${VARIANT_DEFINITIONS.guided}
- ${VARIANT_DEFINITIONS.standard}
- ${VARIANT_DEFINITIONS.challenge}
- Évite le jargon inutile et les clichés éducatifs vagues.
- Les sorties doivent être concrètes et directement utilisables par un enseignant ou formateur.
- Ne mentionne pas la taxonomie de Bloom.
- IMPORTANT : Réponds UNIQUEMENT avec un objet JSON strict. Pas de markdown autour, pas de "Voici le résultat". Juste le JSON.

Directives spécifiques pour le contenu :
- Déroulement en étapes (steps) : Sois très descriptif. Inclus des exemples concrets d'actions, de consignes intermédiaires ou de questions à poser aux apprenants pour guider le formateur pas à pas.
- Critères de réussite (successCriteria) : Utilise un langage clair, mesurable et actionnable. Donne des exemples précis de ce qui est attendu (ex: "L'apprenant a formulé 2 arguments basés sur le texte" plutôt que "L'apprenant a compris le texte").`;

  if (p.variant) {
    return `${context}

Génère UNIQUEMENT la variante suivante : ${VARIANT_DEFINITIONS[p.variant]}
Propose une version différente de la précédente (autre angle, autres exemples), toujours alignée sur l'objectif.

La réponse DOIT ABSOLUMENT être un objet JSON valide avec cette structure EXACTE (un seul objet, sans clé englobante) :
${VARIANT_STRUCTURE}`;
  }

  return `${context}

Génère les 3 variantes différenciées.

La réponse DOIT ABSOLUMENT être un objet JSON valide avec cette structure EXACTE :
{
  "guided": ${VARIANT_STRUCTURE},
  "standard": ${VARIANT_STRUCTURE},
  "challenge": ${VARIANT_STRUCTURE}
}`;
}

export async function callDeepSeek(
  prompt: string,
  apiKey: string
): Promise<{ ok: true; content: string } | { ok: false; status: number; error: string }> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content:
            "Tu es un assistant pédagogique expert. Tu réponds EXCLUSIVEMENT par un objet JSON valide, sans texte avant ni après, sans bloc markdown, sans commentaire. Si la consigne demande une structure précise, respecte-la à la lettre."
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('DeepSeek API Error:', response.status, errText);
    return {
      ok: false,
      status: response.status,
      error: `DeepSeek API failed (${response.status} ${response.statusText}): ${errText.slice(0, 500)}`
    };
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return { ok: false, status: 500, error: 'No content returned from DeepSeek' };
  }
  return { ok: true, content };
}
