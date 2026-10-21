// Export Markdown des variantes, partagé par l'application (bouton Copier)
// et par tests/run-cas.ts (mesure de la taille de l'export).

export interface MarkdownVariant {
  title: string;
  instruction: string;
  steps: { minutes?: number; text: string }[];
  handout?: string;
  supportLevel: string;
  successCriteria: string[];
  extension: string;
  calcWarnings?: string[];
}

export interface MarkdownResult {
  guided: MarkdownVariant;
  standard: MarkdownVariant;
  challenge: MarkdownVariant;
  organization?: string;
  organizationCalcWarnings?: string[];
}

export interface MarkdownHeader {
  theme: string;
  objective: string;
  target: string;
  duration: string;
  diffTypeLabel: string;
  formatLabel: string;
  docName?: string | null;
}

export const stepToMd = (s: { minutes?: number; text: string }) =>
  `${s.minutes != null ? `(${s.minutes} min) ` : ''}${s.text}`;

// Même libellé et même place que sur les cartes : en tête de la variante, sous l'organisation.
const warningsToMd = (w?: string[]) => (w?.length ? w.map(x => `> **Vérifiez le calcul** : ${x}\n`).join('>\n') + '\n' : '');

export function buildMarkdown(data: MarkdownResult, h: MarkdownHeader): string {
  const variantToMd = (label: string, v: MarkdownVariant) => {
    return `## ${label} — ${v.title}\n\n` +
      warningsToMd(v.calcWarnings) +
      `**Consigne apprenants**\n\n${v.instruction}\n\n` +
      `**Déroulement**\n${v.steps.map((s, i) => `${i + 1}. ${stepToMd(s)}`).join('\n')}\n\n` +
      (v.handout ? `**Support à distribuer**\n\n${v.handout}\n\n` : '') +
      `**Notes pour le formateur** : ${v.supportLevel}\n\n` +
      `**Critères de réussite**\n${v.successCriteria.map(c => `- ${c}`).join('\n')}\n\n` +
      `**Pour aller plus loin** : ${v.extension}\n`;
  };
  const header = `# Variantes pédagogiques différenciées\n\n` +
    `- **Thème** : ${h.theme}\n` +
    `- **Objectif** : ${h.objective}\n` +
    `- **Public** : ${h.target || '—'}\n` +
    `- **Durée** : ${h.duration || '—'}\n` +
    `- **Type de différenciation** : ${h.diffTypeLabel}\n` +
    `- **Format** : ${h.formatLabel}\n` +
    (h.docName ? `- **Document de référence** : ${h.docName}\n` : '') +
    `\n`;
  return header +
    variantToMd('Version très guidée', data.guided) + '\n' +
    variantToMd('Version standard', data.standard) + '\n' +
    variantToMd('Version défi', data.challenge) +
    (data.organization ? `\n## Organisation\n\n${data.organization}\n` + (data.organizationCalcWarnings?.length ? '\n' + warningsToMd(data.organizationCalcWarnings) : '') : '');
}
