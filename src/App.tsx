/// <reference types="vite/client" />
import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  RefreshCcw,
  Lightbulb,
  Loader2,
  AlertCircle,
  Check,
  Printer,
  Copy,
  FileUp,
  FileText,
  X,
  Loader,
  ChevronDown,
  ArrowUpRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Plafond de caractères extraits envoyés à l'IA (~20-30 pages) pour éviter
// d'exploser les coûts et le contexte sur de très gros documents.
const MAX_DOC_CHARS = 50000;

const STORAGE_KEY = 'diff-assistant-v1';

interface ActivityVariant {
  title: string;
  instruction: string;
  steps: string[];
  supportLevel: string;
  successCriteria: string[];
  extension: string;
}

type VariantKey = 'guided' | 'standard' | 'challenge';

interface GenerationResult {
  guided: ActivityVariant;
  standard: ActivityVariant;
  challenge: ActivityVariant;
}

interface FormFields {
  theme: string;
  objective: string;
  target: string;
  duration: string;
  diffType: string;
  format: string;
}

// Paramètres figés au moment de la génération : le récapitulatif et l'export
// reflètent ce qui a réellement servi, même si le formulaire change ensuite.
interface GenParams extends FormFields {
  docName: string | null;
}

const EMPTY_FORM: FormFields = {
  theme: '',
  objective: '',
  target: '',
  duration: '',
  diffType: 'autonomie',
  format: 'individuel'
};

const DIFF_TYPES = [
  {
    id: 'autonomie',
    label: 'Niveau d’autonomie',
    description: 'Ajuste la quantité de directives données. Les apprenants guidés ont des étapes très détaillées, tandis que les apprenants autonomes doivent planifier eux-mêmes leur démarche.'
  },
  {
    id: 'complexite',
    label: 'Niveau de complexité',
    description: 'Modifie la difficulté cognitive de la tâche. Les apprenants en difficulté traitent des concepts simples, tandis que les apprenants avancés analysent, synthétisent ou évaluent des concepts complexes.'
  },
  {
    id: 'etayage',
    label: 'Niveau d’étayage (scaffolding)',
    description: 'Varie les outils d\'aide fournis. Les apprenants ayant besoin de soutien reçoivent des glossaires, des modèles ou des amorces de phrases, qui sont retirés pour les autres.'
  }
];

const FORMATS = [
  { id: 'individuel', label: 'Exercice individuel' },
  { id: 'binome', label: 'Activité en binôme' },
  { id: 'groupe', label: 'Activité de groupe' },
  { id: 'cas', label: 'Mini étude de cas' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'situation', label: 'Mise en situation' }
];

const DIFF_TYPE_LABEL = (id: string) => DIFF_TYPES.find(t => t.id === id)?.label || id;
const FORMAT_LABEL = (id: string) => FORMATS.find(f => f.id === id)?.label || id;

type PenColor = 'vert' | 'bleu' | 'rouge';

const VARIANT_META: Record<VariantKey, { label: string; short: string; description: string; color: PenColor }> = {
  guided: { label: 'Version très guidée', short: 'Très guidée', description: 'Hautement étayée et rassurante', color: 'vert' },
  standard: { label: 'Version standard', short: 'Standard', description: 'Équilibrée et autonome', color: 'bleu' },
  challenge: { label: 'Version défi', short: 'Défi', description: 'Exigeante et ouverte', color: 'rouge' }
};

const LOADING_MESSAGES = [
  "Analyse de l'objectif pédagogique…",
  'Conception de la version très guidée…',
  'Rédaction de la version standard…',
  'Construction de la version défi…',
  'Vérification de la cohérence des trois variantes…',
  'Mise en forme des fiches, encore quelques instants…'
];

function parseAIJson(raw: string): any {
  let clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(clean);
}

// Le modèle numérote parfois lui-même ses listes ("1. Ouvrez...") : on retire
// cette numérotation, l'interface affiche déjà la sienne.
function normalizeVariant(v: ActivityVariant): ActivityVariant {
  const strip = (s: string) => s.replace(/^\s*(?:\d+[.)]\s*|[-•]\s*)/, '').trim();
  return {
    ...v,
    steps: v.steps.map(strip),
    successCriteria: v.successCriteria.map(strip)
  };
}

function isValidVariant(v: any): v is ActivityVariant {
  return (
    v &&
    typeof v.title === 'string' &&
    typeof v.instruction === 'string' &&
    Array.isArray(v.steps) &&
    typeof v.supportLevel === 'string' &&
    Array.isArray(v.successCriteria) &&
    typeof v.extension === 'string'
  );
}

// Signature visuelle : une entrée, trois chemins.
function Bifurcation({ mode = 'draw', className }: { mode?: 'draw' | 'pulse'; className?: string }) {
  const anim = (n: 1 | 2 | 3) =>
    mode === 'draw'
      ? `path-draw${n > 1 ? ` path-draw-${n}` : ''}`
      : `path-pulse${n > 1 ? ` path-pulse-${n}` : ''}`;
  return (
    <svg viewBox="0 0 340 120" fill="none" className={className} aria-hidden="true">
      <circle cx="14" cy="60" r="5" className="fill-ink" />
      <path d="M22 60 H64" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-ink" />
      <path d="M64 60 C130 60 175 17 314 15" strokeWidth="2.5" strokeLinecap="round" className={`stroke-vert ${anim(1)}`} />
      <path d="M64 60 H314" strokeWidth="2.5" strokeLinecap="round" className={`stroke-bleu ${anim(2)}`} />
      <path d="M64 60 C130 60 175 103 314 105" strokeWidth="2.5" strokeLinecap="round" className={`stroke-rouge ${anim(3)}`} />
      <circle cx="322" cy="15" r="4.5" className={`fill-vert ${mode === 'draw' ? 'dot-reveal' : ''}`} />
      <circle cx="322" cy="60" r="4.5" className={`fill-bleu ${mode === 'draw' ? 'dot-reveal' : ''}`} />
      <circle cx="322" cy="105" r="4.5" className={`fill-rouge ${mode === 'draw' ? 'dot-reveal' : ''}`} />
    </svg>
  );
}

function PenMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 10" className={className} aria-hidden="true">
      <circle cx="4" cy="5" r="3.5" className="fill-vert" />
      <circle cx="13" cy="5" r="3.5" className="fill-bleu" />
      <circle cx="22" cy="5" r="3.5" className="fill-rouge" />
    </svg>
  );
}

export default function App() {
  const [formData, setFormData] = useState<FormFields>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<{ theme?: boolean; objective?: boolean }>({});

  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [regenerating, setRegenerating] = useState<VariantKey | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [genParams, setGenParams] = useState<GenParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeVariant, setActiveVariant] = useState<VariantKey>('guided');
  const [hydrated, setHydrated] = useState(false);

  // Document de référence optionnel (PDF, TXT ou Markdown) chargé par le formateur.
  const [docName, setDocName] = useState<string | null>(null);
  const [docText, setDocText] = useState<string>('');
  const [docPages, setDocPages] = useState<number>(0);
  const [docTruncated, setDocTruncated] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const themeRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Restauration de la dernière session (formulaire + variantes) au chargement.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        if (s.formData) setFormData({ ...EMPTY_FORM, ...s.formData });
        if (s.result && isValidVariant(s.result.guided) && isValidVariant(s.result.standard) && isValidVariant(s.result.challenge)) {
          setResult({
            guided: normalizeVariant(s.result.guided),
            standard: normalizeVariant(s.result.standard),
            challenge: normalizeVariant(s.result.challenge)
          });
        }
        if (s.genParams) setGenParams(s.genParams);
        if (s.doc) {
          setDocName(s.doc.name);
          setDocText(s.doc.text || '');
          setDocPages(s.doc.pages || 0);
          setDocTruncated(!!s.doc.truncated);
        }
      }
    } catch {
      // Stockage corrompu : on repart de zéro sans bloquer l'app.
    }
    setHydrated(true);
  }, []);

  // Sauvegarde continue : un refresh ne fait plus rien perdre.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          formData,
          result,
          genParams,
          doc: docName ? { name: docName, text: docText, pages: docPages, truncated: docTruncated } : null
        })
      );
    } catch {
      // Quota dépassé (gros document) : on ignore, la session en cours n'est pas affectée.
    }
  }, [hydrated, formData, result, genParams, docName, docText, docPages, docTruncated]);

  // Compteur de secondes pendant la génération.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if ((name === 'theme' || name === 'objective') && value.trim()) {
      setFieldErrors(prev => ({ ...prev, [name]: false }));
    }
  };

  const loadExample = () => {
    if (
      (formData.theme.trim() || formData.objective.trim()) &&
      !window.confirm("Remplacer le contenu actuel du formulaire par l'exemple ?")
    ) {
      return;
    }
    setFieldErrors({});
    setFormData({
      theme: 'Rédiger un mail professionnel',
      objective: 'Écrire un message clair, structuré et poli',
      target: 'Adultes en formation',
      duration: '15 minutes',
      diffType: 'autonomie',
      format: 'individuel'
    });
  };

  const buildMarkdown = (data: GenerationResult): string => {
    const p = genParams;
    const variantToMd = (label: string, v: ActivityVariant) => {
      return `## ${label} — ${v.title}\n\n` +
        `**Consigne** : ${v.instruction}\n\n` +
        `**Déroulement**\n${v.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
        `**Accompagnement attendu** : ${v.supportLevel}\n\n` +
        `**Critères de réussite**\n${v.successCriteria.map(c => `- ${c}`).join('\n')}\n\n` +
        `**Pour aller plus loin** : ${v.extension}\n`;
    };
    const header = `# Variantes pédagogiques différenciées\n\n` +
      `- **Thème** : ${p?.theme || formData.theme}\n` +
      `- **Objectif** : ${p?.objective || formData.objective}\n` +
      `- **Public** : ${p?.target || '—'}\n` +
      `- **Durée** : ${p?.duration || '—'}\n` +
      `- **Type de différenciation** : ${DIFF_TYPE_LABEL(p?.diffType || formData.diffType)}\n` +
      `- **Format** : ${FORMAT_LABEL(p?.format || formData.format)}\n` +
      (p?.docName ? `- **Document de référence** : ${p.docName}\n` : '') +
      `\n`;
    return header +
      variantToMd('Version très guidée', data.guided) + '\n' +
      variantToMd('Version standard', data.standard) + '\n' +
      variantToMd('Version défi', data.challenge);
  };

  const handlePrint = () => window.print();

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildMarkdown(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Impossible de copier dans le presse-papier.');
    }
  };

  const clearDocument = () => {
    setDocName(null);
    setDocText('');
    setDocPages(0);
    setDocTruncated(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Réinitialise l'input pour permettre de recharger le même fichier.
    e.target.value = '';
    if (!file) return;

    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isText = file.type === 'text/plain' || file.type === 'text/markdown' || /\.(txt|md|markdown)$/.test(name);

    if (!isPdf && !isText) {
      setError('Format non supporté. Formats acceptés : PDF, TXT, Markdown.');
      return;
    }

    setError(null);
    setExtracting(true);
    clearDocument();

    try {
      let fullText = '';
      let pages = 0;

      if (isPdf) {
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        pages = pdf.numPages;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => ('str' in item ? item.str : ''))
            .join(' ');
          fullText += pageText + '\n\n';
          if (fullText.length > MAX_DOC_CHARS) break;
        }
      } else {
        fullText = await file.text();
      }

      fullText = fullText.trim();

      if (!fullText) {
        setError(
          isPdf
            ? "Aucun texte extractible trouvé. Le PDF est peut-être scanné (image). L'OCR n'est pas encore géré."
            : 'Le fichier est vide.'
        );
        setExtracting(false);
        return;
      }

      const truncated = fullText.length > MAX_DOC_CHARS;
      setDocText(truncated ? fullText.slice(0, MAX_DOC_CHARS) : fullText);
      setDocTruncated(truncated);
      setDocName(file.name);
      setDocPages(pages);
    } catch (err) {
      console.error(err);
      setError(
        isPdf
          ? "Impossible de lire ce PDF. Vérifiez qu'il n'est pas protégé ou corrompu."
          : 'Impossible de lire ce fichier.'
      );
    } finally {
      setExtracting(false);
    }
  };

  const resetForm = () => {
    const hasContent =
      result ||
      docName ||
      formData.theme.trim() ||
      formData.objective.trim() ||
      formData.target.trim() ||
      formData.duration.trim();
    if (hasContent && !window.confirm('Effacer le formulaire et les variantes générées ?')) {
      return;
    }
    setFormData(EMPTY_FORM);
    setFieldErrors({});
    setResult(null);
    setGenParams(null);
    setError(null);
    clearDocument();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const scrollTo = (ref: React.RefObject<HTMLElement | null>, block: ScrollLogicalPosition = 'start') => {
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block }), 100);
  };

  const requestGeneration = async (variant: VariantKey | null): Promise<any> => {
    const fields = variant && genParams ? genParams : formData;
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        theme: fields.theme,
        objective: fields.objective,
        target: fields.target,
        duration: fields.duration,
        diffType: fields.diffType,
        format: fields.format,
        docText,
        variant
      })
    });

    if (!response.ok) {
      let errorMsg = `Erreur lors de la communication avec le serveur (${response.status} ${response.statusText}).`;
      try {
        const errDetails = await response.json();
        if (errDetails.error) errorMsg = errDetails.error;
      } catch (e) {
        // Réponse HTML (timeout, 404) : on garde le statut brut.
      }
      throw new Error(errorMsg);
    }

    const responseData = await response.json();
    try {
      return parseAIJson(responseData.content);
    } catch {
      throw new Error("La réponse de l'IA n'est pas exploitable. Réessayez, cela arrive parfois.");
    }
  };

  const generateActivities = async () => {
    if (loading || regenerating) return;

    const missing = {
      theme: !formData.theme.trim(),
      objective: !formData.objective.trim()
    };
    if (missing.theme || missing.objective) {
      setFieldErrors(missing);
      setError("Veuillez remplir le thème et l'objectif pédagogique (champs marqués *).");
      themeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      themeRef.current?.focus({ preventScroll: true });
      return;
    }

    setLoading(true);
    setError(null);
    scrollTo(loadingRef, 'center');
    try {
      const data = await requestGeneration(null);

      if (!isValidVariant(data.guided) || !isValidVariant(data.standard) || !isValidVariant(data.challenge)) {
        throw new Error("La réponse de l'IA est incomplète ou mal formatée. Réessayez.");
      }

      setResult({
        guided: normalizeVariant(data.guided),
        standard: normalizeVariant(data.standard),
        challenge: normalizeVariant(data.challenge)
      });
      setGenParams({ ...formData, docName });
      setActiveVariant('guided');
      scrollTo(resultsRef);
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue. Veuillez réessayer.');
      scrollTo(errorRef, 'center');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const regenerateVariant = async (variant: VariantKey) => {
    if (loading || regenerating || !result) return;
    setRegenerating(variant);
    setError(null);
    try {
      const data = await requestGeneration(variant);
      if (!isValidVariant(data)) {
        throw new Error("La réponse de l'IA est incomplète ou mal formatée. Réessayez.");
      }
      setResult(prev => (prev ? { ...prev, [variant]: normalizeVariant(data) } : prev));
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue. Veuillez réessayer.');
      scrollTo(errorRef, 'center');
      console.error(err);
    } finally {
      setRegenerating(null);
    }
  };

  const loadingMessage = LOADING_MESSAGES[Math.min(Math.floor(elapsed / 6), LOADING_MESSAGES.length - 1)];
  const progressPct = Math.min(5 + (elapsed / 40) * 90, 95);

  const inputClasses = (invalid?: boolean) =>
    `w-full px-4 py-3 rounded-lg border bg-white text-[15px] placeholder:text-inkfaint transition-colors outline-none focus-visible:ring-2 focus-visible:ring-bleu/60 focus:border-bleu ${
      invalid ? 'border-rouge ring-1 ring-rouge/30' : 'border-line hover:border-inkfaint'
    }`;

  const labelClasses = 'block font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-inksoft mb-2';

  return (
    <div className="min-h-screen bg-paper text-ink font-sans selection:bg-bleu-soft">
      {/* Header */}
      <header className="bg-paper/90 backdrop-blur border-b border-line sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <PenMark className="w-7 shrink-0" />
            <div className="min-w-0">
              <p className="font-display text-[17px] font-bold leading-tight truncate">
                Assistant de différenciation pédagogique
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-inksoft">
                Parcours d'apprentissage inclusifs
              </p>
            </div>
          </div>
          <button
            onClick={loadExample}
            className="hidden sm:inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider text-bleu hover:text-bleu-dark transition-colors px-3 py-2 rounded-lg border border-line hover:border-bleu/40 bg-white"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            Exemple
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-14 pb-10">
        {/* Hero */}
        <section className="mb-14 grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-8">
          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.22em] text-bleu mb-4">
              Pour formateurs et enseignants
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] mb-5">
              Une activité,<br />trois chemins.
            </h1>
            <p className="text-inksoft text-lg leading-relaxed max-w-xl">
              Décrivez votre activité et son objectif : l'outil génère trois versions
              différenciées, <span className="text-vert font-semibold">très guidée</span>,{' '}
              <span className="text-bleu font-semibold">standard</span> et{' '}
              <span className="text-rouge font-semibold">défi</span>, prêtes à ajuster.
            </p>
            <p className="mt-4 text-sm text-inkfaint">
              Aucune donnée personnelle n'est traitée. L'outil ne remplace pas le jugement du formateur.
            </p>
          </div>
          <Bifurcation mode="draw" className="hidden md:block w-64 text-ink" />
        </section>

        {/* Form Card */}
        <div className="bg-white rounded-xl border border-line mb-12">
          <div className="px-6 sm:px-8 py-4 border-b border-line flex items-center justify-between">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink">
              Fiche de préparation
            </p>
            <PenMark className="w-6 opacity-60" />
          </div>
          <div className="p-6 sm:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column */}
              <div className="space-y-6">
                <div>
                  <label htmlFor="theme" className={labelClasses}>
                    Thème de l’activité <span className="text-rouge" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="theme"
                    ref={themeRef}
                    type="text"
                    name="theme"
                    value={formData.theme}
                    onChange={handleInputChange}
                    required
                    aria-required="true"
                    aria-invalid={fieldErrors.theme || undefined}
                    placeholder="Ex: La gestion du temps, Excel niveau 1..."
                    className={inputClasses(fieldErrors.theme)}
                  />
                  {fieldErrors.theme && (
                    <p className="mt-1.5 text-xs text-rouge">Ce champ est obligatoire.</p>
                  )}
                </div>

                <div>
                  <label htmlFor="objective" className={labelClasses}>
                    Objectif pédagogique <span className="text-rouge" aria-hidden="true">*</span>
                  </label>
                  <textarea
                    id="objective"
                    name="objective"
                    value={formData.objective}
                    onChange={handleInputChange}
                    rows={3}
                    required
                    aria-required="true"
                    aria-invalid={fieldErrors.objective || undefined}
                    placeholder="Ex: Être capable de structurer un argumentaire de vente..."
                    className={`${inputClasses(fieldErrors.objective)} resize-none`}
                  />
                  {fieldErrors.objective && (
                    <p className="mt-1.5 text-xs text-rouge">Ce champ est obligatoire.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="target" className={labelClasses}>
                      Public cible
                    </label>
                    <input
                      id="target"
                      type="text"
                      name="target"
                      value={formData.target}
                      onChange={handleInputChange}
                      placeholder="Ex: Demandeurs d'emploi"
                      className={inputClasses()}
                    />
                  </div>
                  <div>
                    <label htmlFor="duration" className={labelClasses}>
                      Durée
                    </label>
                    <input
                      id="duration"
                      type="text"
                      name="duration"
                      value={formData.duration}
                      onChange={handleInputChange}
                      placeholder="Ex: 30 min"
                      className={inputClasses()}
                    />
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                <div>
                  <span className={labelClasses}>Type de différenciation</span>
                  <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Type de différenciation">
                    {DIFF_TYPES.map(type => {
                      const selected = formData.diffType === type.id;
                      return (
                        <button
                          key={type.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setFormData(prev => ({ ...prev, diffType: type.id }))}
                          className={`w-full text-left px-4 py-3 rounded-lg border transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-bleu/60 ${
                            selected
                            ? 'bg-bleu-soft border-bleu/50'
                            : 'bg-white border-line hover:border-inkfaint'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className={`text-sm font-semibold ${selected ? 'text-bleu-dark' : 'text-ink'}`}>{type.label}</span>
                            <div className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${
                              selected ? 'border-bleu bg-bleu' : 'border-line bg-white'
                            }`}>
                              {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
                            </div>
                          </div>
                          {selected && (
                            <p className="mt-1.5 text-[13px] text-inksoft leading-relaxed font-normal">
                              {type.description}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="format" className={labelClasses}>
                    Format souhaité
                  </label>
                  <div className="relative">
                    <select
                      id="format"
                      name="format"
                      value={formData.format}
                      onChange={handleInputChange}
                      className={`${inputClasses()} pr-10 appearance-none cursor-pointer`}
                    >
                      {FORMATS.map(f => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-inksoft absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Document de référence (optionnel) */}
            <div className="mt-9 pt-7 border-t border-line">
              <span className={labelClasses}>Document de référence (optionnel)</span>
              <p className="text-[13px] text-inksoft mb-3">
                Chargez un document (cours, support, fiche) : l'IA s'appuiera sur son contenu pour différencier les activités.
              </p>

              {!docName ? (
                <label className={`flex flex-col items-center justify-center gap-2 w-full px-4 py-7 rounded-lg border border-dashed transition-colors cursor-pointer ${
                  extracting
                    ? 'border-bleu/40 bg-bleu-soft/40 cursor-wait'
                    : 'border-line bg-paper hover:border-bleu/50 hover:bg-bleu-soft/30'
                }`}>
                  {extracting ? (
                    <>
                      <Loader className="w-5 h-5 text-bleu animate-spin" />
                      <span className="text-sm font-medium text-inksoft">Extraction du texte en cours…</span>
                    </>
                  ) : (
                    <>
                      <FileUp className="w-5 h-5 text-inkfaint" />
                      <span className="text-sm font-medium text-ink">Cliquez pour choisir un fichier</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-inkfaint">PDF · TXT · Markdown — reste dans votre navigateur</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="application/pdf,.pdf,.txt,.md,.markdown,text/plain,text/markdown"
                    onChange={handleFileChange}
                    disabled={extracting}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-vert/40 bg-vert-soft">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-vert shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{docName}</p>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-inksoft">
                        {docPages > 0 && `${docPages} page${docPages > 1 ? 's' : ''} · `}
                        {docText.length.toLocaleString('fr-FR')} caractères
                        {docTruncated && ' (tronqué)'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearDocument}
                    className="shrink-0 p-1.5 rounded-lg text-inksoft hover:text-rouge hover:bg-rouge-soft transition-colors"
                    title="Retirer le document"
                    aria-label="Retirer le document"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {docTruncated && (
                <p className="mt-2 text-xs text-rouge flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Document volumineux : seuls les {MAX_DOC_CHARS.toLocaleString('fr-FR')} premiers caractères seront utilisés.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="mt-9 flex flex-col sm:flex-row gap-3 pt-7 border-t border-line">
              <button
                onClick={generateActivities}
                disabled={loading}
                className="flex-1 bg-bleu hover:bg-bleu-dark disabled:bg-bleu/50 text-white font-semibold py-3.5 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-bleu/60 focus-visible:ring-offset-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Sparkles className="w-5 h-5" />
                )}
                {loading ? 'Génération en cours…' : result ? 'Régénérer les variantes' : 'Générer les variantes'}
              </button>
              <button
                onClick={resetForm}
                disabled={loading}
                className="px-6 py-3.5 rounded-lg border border-line text-inksoft font-semibold hover:border-inkfaint hover:text-ink transition-colors disabled:opacity-50"
              >
                Réinitialiser
              </button>
              <button
                onClick={loadExample}
                disabled={loading}
                className="sm:hidden px-6 py-3.5 rounded-lg border border-bleu/30 text-bleu font-semibold bg-bleu-soft disabled:opacity-50"
              >
                Charger un exemple
              </button>
            </div>

            {error && (
              <div
                ref={errorRef}
                role="alert"
                className="mt-4 p-4 bg-rouge-soft border border-rouge/30 rounded-lg text-rouge text-sm"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="flex-1">{error}</span>
                </div>
                {!loading && formData.theme.trim() && formData.objective.trim() && (
                  <button
                    onClick={generateActivities}
                    className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rouge text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Réessayer
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Loading panel */}
        <AnimatePresence>
          {loading && (
            <motion.div
              ref={loadingRef}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-12 bg-white rounded-xl border border-line p-8 text-center"
              aria-live="polite"
            >
              <Bifurcation mode="pulse" className="w-44 mx-auto mb-5 text-ink" />
              <p className="font-display text-lg font-semibold">{loadingMessage}</p>
              <p className="font-mono text-[11px] uppercase tracking-wider text-inksoft mt-2">
                20 à 40 secondes en général · {elapsed} s écoulée{elapsed > 1 ? 's' : ''}
              </p>
              <div className="mt-5 max-w-md mx-auto h-1 bg-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-bleu rounded-full transition-all duration-1000"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Section */}
        <AnimatePresence>
          {result && !loading && (
            <motion.div
              ref={resultsRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8 scroll-mt-24"
              id="results-print-area"
            >
              <div className="text-center mb-2">
                <p className="font-mono text-xs font-medium uppercase tracking-[0.22em] text-bleu mb-3">
                  Résultat
                </p>
                <h2 className="font-display text-3xl font-bold tracking-tight">Vos variantes pédagogiques</h2>
                <p className="text-inksoft mt-2">Trois chemins adaptés pour un même objectif</p>
                <div className="no-print mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-white text-sm font-semibold hover:opacity-85 transition-opacity"
                  >
                    <Printer className="w-4 h-4" />
                    Imprimer / Enregistrer en PDF
                  </button>
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-line bg-white text-ink text-sm font-semibold hover:border-inkfaint transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-vert" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copié' : 'Copier (Markdown)'}
                  </button>
                </div>
                <p className="no-print font-mono text-[10px] uppercase tracking-wider text-inkfaint mt-3">
                  Dans la boîte d'impression, choisir « Enregistrer au format PDF »
                </p>
              </div>

              {/* Récapitulatif des paramètres (affiché et imprimé avec les fiches) */}
              {genParams && (
                <div className="bg-white rounded-xl border border-line p-6">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-inksoft mb-4">
                    Paramètres de l'activité
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2.5 text-sm">
                    <div>
                      <dt className="font-semibold text-inksoft inline">Thème : </dt>
                      <dd className="text-ink inline">{genParams.theme}</dd>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <dt className="font-semibold text-inksoft inline">Objectif : </dt>
                      <dd className="text-ink inline">{genParams.objective}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-inksoft inline">Public : </dt>
                      <dd className="text-ink inline">{genParams.target || '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-inksoft inline">Durée : </dt>
                      <dd className="text-ink inline">{genParams.duration || '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-inksoft inline">Différenciation : </dt>
                      <dd className="text-ink inline">{DIFF_TYPE_LABEL(genParams.diffType)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-inksoft inline">Format : </dt>
                      <dd className="text-ink inline">{FORMAT_LABEL(genParams.format)}</dd>
                    </div>
                    {genParams.docName && (
                      <div className="sm:col-span-2">
                        <dt className="font-semibold text-inksoft inline">Document de référence : </dt>
                        <dd className="text-ink inline">{genParams.docName}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Sélecteur de variante sur mobile (les 3 cartes restent côte à côte sur grand écran) */}
              <div className="lg:hidden no-print flex rounded-lg border border-line bg-white p-1 gap-1" role="tablist" aria-label="Choix de la variante affichée">
                {(Object.keys(VARIANT_META) as VariantKey[]).map(key => {
                  const active = activeVariant === key;
                  const activeClasses: Record<PenColor, string> = {
                    vert: 'bg-vert text-white',
                    bleu: 'bg-bleu text-white',
                    rouge: 'bg-rouge text-white'
                  };
                  return (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveVariant(key)}
                      className={`flex-1 px-2 py-2.5 rounded-md font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                        active ? activeClasses[VARIANT_META[key].color] : 'text-inksoft hover:bg-paper'
                      }`}
                    >
                      {VARIANT_META[key].short}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {(Object.keys(VARIANT_META) as VariantKey[]).map(key => (
                  <div
                    key={key}
                    className={`variant-card ${activeVariant === key ? 'block' : 'hidden'} lg:block`}
                  >
                    <VariantCard
                      data={result[key]}
                      label={VARIANT_META[key].label}
                      color={VARIANT_META[key].color}
                      description={VARIANT_META[key].description}
                      regenerating={regenerating === key}
                      disabled={loading || regenerating !== null}
                      onRegenerate={() => regenerateVariant(key)}
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-line py-12">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <PenMark className="w-6 mx-auto mb-4 opacity-70" />
          <p className="text-[15px]">
            Un outil conçu par{' '}
            <a
              href="https://rochane.fr"
              target="_blank"
              rel="noopener"
              className="font-display font-bold text-bleu hover:text-bleu-dark underline decoration-2 underline-offset-4 decoration-bleu/30 hover:decoration-bleu-dark transition-colors"
            >
              Rochane Kherbouche
            </a>
            , technopédagogue.
          </p>
          <a
            href="https://rochane.fr"
            target="_blank"
            rel="noopener"
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-bleu/40 bg-white text-bleu text-sm font-semibold hover:bg-bleu hover:text-white transition-colors"
          >
            Découvrir toutes mes activités sur rochane.fr
            <ArrowUpRight className="w-4 h-4" />
          </a>
          <p className="text-sm text-inksoft mt-6">
            Prototype de démonstration, à relire et ajuster par le formateur avant usage.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-inkfaint mt-2">
            © 2026 Assistant de différenciation pédagogique · Sans collecte de données personnelles
          </p>
        </div>
      </footer>
    </div>
  );
}

function VariantCard({ data, label, color, description, regenerating, disabled, onRegenerate }: {
  data: ActivityVariant;
  label: string;
  color: PenColor;
  description: string;
  regenerating: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  const barClasses: Record<PenColor, string> = {
    vert: 'bg-vert',
    bleu: 'bg-bleu',
    rouge: 'bg-rouge'
  };
  const badgeClasses: Record<PenColor, string> = {
    vert: 'bg-vert-soft text-vert',
    bleu: 'bg-bleu-soft text-bleu',
    rouge: 'bg-rouge-soft text-rouge'
  };
  const dotClasses: Record<PenColor, string> = {
    vert: 'bg-vert',
    bleu: 'bg-bleu',
    rouge: 'bg-rouge'
  };

  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={`bg-white rounded-xl border border-line overflow-hidden flex flex-col h-full transition-opacity ${regenerating ? 'opacity-60' : ''}`}
    >
      <div className={`h-1 ${barClasses[color]}`} />
      <div className="p-5 border-b border-line">
        <div className="flex items-start justify-between gap-2">
          <div className={`inline-block px-2.5 py-1 rounded font-mono text-[10px] font-semibold uppercase tracking-[0.12em] mb-2.5 ${badgeClasses[color]}`}>
            {label}
          </div>
          <button
            onClick={onRegenerate}
            disabled={disabled}
            title="Régénérer uniquement cette variante"
            aria-label={`Régénérer la ${label.toLowerCase()}`}
            className="no-print shrink-0 p-1.5 rounded-lg text-inkfaint hover:text-bleu hover:bg-bleu-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {regenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCcw className="w-4 h-4" />
            )}
          </button>
        </div>
        <h3 className="font-display text-lg font-bold leading-snug">{data.title}</h3>
        <p className="text-xs mt-1 text-inksoft">{description}</p>
      </div>

      <div className="p-5 flex-1 space-y-6">
        <div>
          <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-inkfaint mb-2">Consigne</h4>
          <p className="text-sm text-ink leading-relaxed italic">"{data.instruction}"</p>
        </div>

        <div>
          <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-inkfaint mb-3">Déroulement</h4>
          <ul className="space-y-3">
            {data.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-inksoft leading-relaxed">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-paper border border-line flex items-center justify-center font-mono text-[10px] font-semibold text-inksoft">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 bg-paper rounded-lg border border-line">
          <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-inksoft mb-2">Accompagnement attendu</h4>
          <p className="text-sm text-inksoft leading-relaxed">{data.supportLevel}</p>
        </div>

        <div>
          <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-inkfaint mb-3">Critères de réussite</h4>
          <ul className="space-y-2">
            {data.successCriteria.map((criterion, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-inksoft leading-relaxed">
                <div className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${dotClasses[color]}`} />
                {criterion}
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-4 border-t border-line">
          <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-inkfaint mb-2">Pour aller plus loin</h4>
          <p className="text-sm text-inksoft leading-relaxed">{data.extension}</p>
        </div>
      </div>
    </motion.div>
  );
}
