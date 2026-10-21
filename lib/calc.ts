// Contrôle des calculs écrits dans une sortie générée : repère chaque expression
// « opérandes = résultat » (formats français : virgule décimale, espaces dans les milliers,
// ×, x, *, ÷, /, +, −, parenthèses, unités collées ou non), la recalcule et signale
// celles dont le résultat annoncé ne correspond pas.

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string } | { kind: 'paren'; value: '(' | ')' };

// Nombre : non précédé d'une lettre ou d'un chiffre (pas « V1 », « CH-04 »),
// milliers séparés par une espace (1 000, 12 500), décimales après virgule ou point.
const NUMBER = String.raw`(?<![\p{L}\d.,])\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?(?![\d])|(?<![\p{L}\d.,])\d+(?:[.,]\d+)?`;
// Unité facultative après un nombre : un mot court, éventuellement « L/m² » ou « € ».
const UNIT = String.raw`(?:[   ]?(?:%|€|(?!x(?![\p{L}]))[\p{L}²³°]{1,8}(?:\/[\p{L}²³]{1,4})?))?`;
const OPERATOR = String.raw`[×x*÷\/+\-−–]`;
const OPERAND = String.raw`\(*[   ]*(?:${NUMBER})${UNIT}[   ]*\)*`;
const EXPRESSION = new RegExp(
  String.raw`(${OPERAND}(?:[   ]*${OPERATOR}[   ]*${OPERAND})+)[   ]*(=|≈|~)[   ]*(-?(?:${NUMBER}))${UNIT}`,
  'gu'
);

const parseNumber = (s: string) => Number(s.replace(/[   ]/g, '').replace(',', '.'));
const decimals = (s: string) => (s.match(/[.,](\d+)$/)?.[1].length ?? 0);

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  const re = new RegExp(String.raw`(${NUMBER})(${UNIT})|([()])|(${OPERATOR})|([   ]+)`, 'uy');
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < expr.length) {
    re.lastIndex = pos;
    m = re.exec(expr);
    if (!m) return null;
    pos = re.lastIndex;
    if (m[1]) tokens.push({ kind: 'num', value: parseNumber(m[1]) / (m[2].trim() === '%' ? 100 : 1) });
    else if (m[3]) tokens.push({ kind: 'paren', value: m[3] as '(' | ')' });
    else if (m[4]) tokens.push({ kind: 'op', value: m[4] });
  }
  return tokens;
}

// Descente récursive : × et ÷ avant + et −.
function evaluate(tokens: Token[]): number | null {
  let i = 0;
  const opAt = (re: RegExp) => { const t = tokens[i]; return t?.kind === 'op' && re.test(t.value) ? t.value : null; };
  const factor = (): number | null => {
    const t = tokens[i];
    if (!t) return null;
    if (t.kind === 'num') { i++; return t.value; }
    if (t.kind === 'paren' && t.value === '(') {
      i++;
      const v = sum();
      const close = tokens[i];
      if (close?.kind !== 'paren' || close.value !== ')') return null;
      i++;
      return v;
    }
    return null;
  };
  const product = (): number | null => {
    let v = factor();
    let op: string | null;
    while (v != null && (op = opAt(/[×x*÷\/]/))) {
      i++;
      const r = factor();
      if (r == null) return null;
      v = /[÷\/]/.test(op) ? v / r : v * r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    let op: string | null;
    while (v != null && (op = opAt(/[+\-−–]/))) {
      i++;
      const r = product();
      if (r == null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return v != null && i === tokens.length && Number.isFinite(v) ? v : null;
}

const format = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

// Renvoie une phrase par calcul faux, par exemple « 8 × 25 = 160 (résultat juste : 200) ».
export function findWrongCalcs(text: string): string[] {
  const wrong: string[] = [];
  for (const m of text.matchAll(EXPRESSION)) {
    const [, left, sign, right] = m;
    const tokens = tokenize(left.trim());
    if (!tokens || !tokens.some(t => t.kind === 'op')) continue;
    const actual = evaluate(tokens);
    if (actual == null) continue;
    const claimed = parseNumber(right);
    // Après ≈, « 80 » peut arrondir à la dizaine : la tolérance suit aussi les zéros finaux.
    const roundedTo = decimals(right) ? 10 ** -decimals(right) : 10 ** (right.replace(/\D/g, '').match(/0*$/)![0].length);
    const tolerance = sign === '=' ? 0.5 * 10 ** -decimals(right) + 1e-9 : Math.max(Math.abs(actual) * 0.02, 0.5 * roundedTo);
    if (Math.abs(actual - claimed) > Math.max(tolerance, Math.abs(actual) * 0.005)) {
      wrong.push(`${m[0].trim()} (résultat juste : ${format(actual)})`);
    }
  }
  return wrong;
}

// Toutes les chaînes d'une valeur JSON (champs, étapes, critères).
const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

export const wrongCalcsIn = (v: unknown) => strings(v).flatMap(findWrongCalcs);
