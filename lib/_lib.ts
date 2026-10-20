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
  challenge: 'Version défi : plus ouverte et plus exigeante, toujours sur la compétence visée par l\'objectif.'
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
  '{ "title": "...", "instruction": "...", "steps": [{ "minutes": 5, "text": "..." }], "supportLevel": "...", "successCriteria": ["..."], "extension": "..." }';

const LENGTH_LIMITS = `Limites de longueur (strictes, en mots) :
- title : 6 mots maximum.
- instruction : 50 mots maximum.
- steps : 3 ou 4 étapes maximum ; chaque étape 30 mots maximum, durée comprise (le texte de l'étape fait donc 28 mots maximum).
- supportLevel : 50 mots maximum.
- successCriteria : 3 critères maximum, 15 mots maximum chacun.
- extension : 20 mots maximum.
- Une version complète (tous champs réunis) : 120 mots maximum.
Phrases courtes. Chaque information n'apparaît qu'une fois : un champ ne répète jamais ce qu'un autre dit déjà (par exemple, les notes pour le formateur ne redisent pas les étapes, la consigne ne redit pas les critères).`;

const SELF_CHECK = `Avant de répondre, vérifie en silence chaque point ci-dessous sur ta réponse complète. Si un point échoue, corrige la réponse, puis renvoie uniquement la version corrigée. Cette vérification reste interne : rien de son contenu n'apparaît dans la réponse (aucun champ, commentaire ou mention de vérification).
1. Objectif respecté : aucune étape ne contredit ou ne déborde l'objectif ; les informations que l'objectif dit déjà acquises servent de point de départ.
2. Consignes apprenants au niveau indiqué : chaque "instruction" s'adresse directement aux apprenants, en phrases courtes, avec un vocabulaire adapté au public décrit ; si l'activité porte sur l'apprentissage d'une langue ou si le public est décrit par un niveau CECRL A1 ou A2 : présent, impératif et futur proche uniquement.
3. Nombres cohérents : chaque nombre cité dans les critères de réussite ou la consigne correspond exactement au nombre d'éléments listés dans le déroulé ou le support.
4. Durées justes : dans chaque version, la somme des "minutes" des étapes est égale à la durée indiquée.
5. Une seule variable de différenciation : les versions diffèrent uniquement par le type de différenciation choisi ; chaque version diffère de la précédente par au moins un élément nommé de ce type ; en étayage ou en autonomie, la production attendue est la même dans les trois versions.
6. Mise en commun réaliste : chaque phase devant la classe entière fixe un nombre de passages dont la durée totale tient dans l'étape ; aucune étape n'est consacrée uniquement à de l'organisation.
7. Étayage cloisonné : aucune aide propre à une version n'est présentée devant la classe entière ; aucune consigne ne contient l'aide retirée à sa version ; chaque critère de réussite s'applique à tous les apprenants ; le support de la version la plus guidée couvre chaque élément exigé par les critères de réussite, y compris les conversions d'unités.
8. Longueurs respectées : chaque champ tient dans sa limite de mots, aucune information n'est répétée d'un champ à l'autre.`;

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
- Respecte strictement l'objectif pédagogique : n'ajoute aucune étape ni phase préalable qui le contredit. Quand l'objectif mentionne des informations, connaissances ou productions déjà acquises (par exemple des données déjà recueillies ou une notion vue précédemment), considère qu'elles sont disponibles au début de l'activité et pars de ces informations.
- Varie uniquement le niveau d'étayage, d'autonomie ou de complexité selon le type de différenciation choisi (${DIFF_TYPE_LABELS[p.diffType]}). Fais varier ce seul paramètre : n'ajoute aucune difficulté étrangère à la compétence visée (mémorisation, vitesse, quantité de travail, connaissance hors objectif).
- Chaque version diffère de la précédente par au moins un élément nommé du type de différenciation choisi (en étayage par exemple : modèle ou exemple résolu, fiche guide, aide du formateur pendant la préparation). Nomme ces éléments dans les notes pour le formateur.
- Un élément d'étayage propre à une version (modèle, exemple résolu, liste, fiche guide) n'est jamais présenté devant la classe entière : il est donné uniquement aux apprenants de cette version.
- Le support de la version la plus guidée couvre chaque élément exigé par les critères de réussite : chaque élément attendu apparaît dans le modèle ou l'exemple fourni.
- La consigne de chaque version est donnée uniquement aux apprenants de cette version.
- La consigne d'une version ne contient pas l'aide qui est retirée à cette version (par exemple, pas de liste des éléments attendus dans la consigne d'une version qui n'a pas de liste).
- Quand la différenciation porte sur l'étayage ou l'autonomie, la production attendue et les critères de réussite portent sur la même tâche dans les trois versions : la version défi retire de l'aide et n'ajoute aucune exigence de contenu ou de forme (étape supplémentaire, contrainte de forme, contenu hors objectif, etc.).
- ${VARIANT_DEFINITIONS.guided}
- ${VARIANT_DEFINITIONS.standard}
- ${VARIANT_DEFINITIONS.challenge}
- Évite le jargon inutile et les clichés éducatifs vagues.
- Les sorties doivent être concrètes et directement utilisables par un enseignant ou formateur.
- Ne mentionne pas la taxonomie de Bloom.
- IMPORTANT : Réponds UNIQUEMENT avec un objet JSON strict. Pas de markdown autour, pas de "Voici le résultat". Juste le JSON.

Directives spécifiques pour le contenu :
- Consigne (instruction) : texte destiné aux apprenants, que le formateur lit ou distribue tel quel. Adresse-toi directement à eux (vouvoiement ou tutoiement, de façon constante), en phrases courtes, avec un vocabulaire accessible au public décrit ; explique les termes techniques ou du métier si nécessaire. Uniquement si l'activité porte sur l'apprentissage d'une langue ou si le public est décrit par un niveau CECRL : adapte le vocabulaire et les temps à ce niveau, et pour un niveau A1 ou A2 utilise uniquement le présent, l'impératif et le futur proche.
- Notes pour le formateur (supportLevel) : texte destiné au formateur seul : étayage à apporter dans cette version, points de vigilance, ce qu'il observe et comment il intervient.
- Déroulement en étapes (steps) : Sois concret : une action précise par étape. Chaque étape porte sa durée en minutes (entier, champ "minutes"). La somme des minutes est exactement égale à la durée estimée. Chaque étape comporte une production des apprenants : les actions d'organisation (former les groupes, distribuer, choisir des volontaires) s'intègrent à une étape de travail, jamais à une étape à part. Si l'activité se fait en groupes, tiens compte de leur taille : quand les apprenants présentent ou restituent, précise si c'est devant leur sous-groupe ou devant la classe entière, et prévois assez de temps pour que chacun passe. L'effectif de la classe est inconnu : pour une phase devant la classe entière, fixe un nombre précis de passages (par exemple 2 ou 3) et une durée par passage, dont le total tient dans la durée de l'étape ; ne fais jamais passer « chaque groupe ».
- Critères de réussite (successCriteria) : Utilise un langage clair, mesurable et actionnable. Exemple : "L'apprenant a formulé 2 arguments basés sur le texte" plutôt que "L'apprenant a compris le texte". Tout nombre cité correspond exactement au nombre d'éléments listés dans le déroulé ou le support de la même version. Chaque critère s'applique à tous les apprenants de la version (pas de critère qui porte sur un passage que seuls certains apprenants font).

${LENGTH_LIMITS}`;

  if (p.variant) {
    return `${context}

Génère UNIQUEMENT la variante suivante : ${VARIANT_DEFINITIONS[p.variant]}
Propose une version différente de la précédente (autre angle, autres exemples), toujours alignée sur l'objectif.

La réponse DOIT ABSOLUMENT être un objet JSON valide avec cette structure EXACTE (un seul objet, sans clé englobante) :
${VARIANT_STRUCTURE}

${SELF_CHECK}`;
  }

  return `${context}

Génère les 3 variantes différenciées, puis un bloc commun "organization" destiné au formateur : explique comment faire fonctionner les trois versions en parallèle dans un même groupe (démarrage, temps commun, ce que fait le formateur pendant l'activité, mise en commun) et comment il répartit les apprenants entre les versions à partir de critères observables (ce que l'apprenant produit, demande ou réussit), sans étiqueter les apprenants ni nommer leur niveau devant le groupe.
Règles pour l'organisation :
- Elle parle d'un objectif commun, jamais d'une consigne commune : chaque version garde sa propre consigne.
- Elle tient dans la durée indiquée : aucun temps en plus des étapes (pas de démarrage commun ni de clôture hors du décompte).
- Les phases en classe entière ont lieu au même moment dans les trois versions : aligne les étapes concernées (même minute de début, même durée).
- Si l'activité se fait en sous-groupes, précise leur composition et comment cela fonctionne. Choisis une seule composition, sans alternative. Quand un support est remis à un sous-groupe, ce sous-groupe ne réunit que des apprenants de la même version.
- Elle reste cohérente avec les étapes : chaque action citée (modelage, passages, mise en commun) a lieu au même endroit, devant le même public et au même moment que dans l'étape correspondante.
- Elle tient en 80 mots maximum et ne redit pas le contenu des étapes.

La réponse DOIT ABSOLUMENT être un objet JSON valide avec cette structure EXACTE :
{
  "guided": ${VARIANT_STRUCTURE},
  "standard": ${VARIANT_STRUCTURE},
  "challenge": ${VARIANT_STRUCTURE},
  "organization": "..."
}

${SELF_CHECK}
9. Organisation : le bloc "organization" explique le fonctionnement en parallèle et la répartition par critères observables, parle d'un objectif commun et jamais d'une consigne commune, tient dans la durée indiquée, aligne les phases en classe entière, précise la composition des sous-groupes s'il y en a et ne contredit aucune étape, en 80 mots maximum.`;
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
