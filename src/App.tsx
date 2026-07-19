/// <reference types="vite/client" />
import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  RefreshCcw,
  Lightbulb,
  Loader2,
  AlertCircle,
  BookOpen,
  Users,
  Clock,
  Layers,
  Layout,
  Target,
  Check,
  Printer,
  Copy,
  FileUp,
  FileText,
  X,
  Loader,
  ChevronDown
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
    description: 'Ajuste la quantité de directives données. Les élèves guidés ont des étapes très détaillées, tandis que les élèves autonomes doivent planifier eux-mêmes leur démarche.'
  },
  {
    id: 'complexite',
    label: 'Niveau de complexité',
    description: 'Modifie la difficulté cognitive de la tâche. Les élèves en difficulté traitent des concepts simples, tandis que les élèves avancés analysent, synthétisent ou évaluent des concepts complexes.'
  },
  {
    id: 'etayage',
    label: 'Niveau d’étayage (scaffolding)',
    description: 'Varie les outils d\'aide fournis. Les élèves ayant besoin de soutien reçoivent des glossaires, des modèles ou des amorces de phrases, qui sont retirés pour les autres.'
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

const VARIANT_META: Record<VariantKey, { label: string; description: string; color: 'emerald' | 'indigo' | 'amber' }> = {
  guided: { label: 'Version très guidée', description: 'Hautement étayée et rassurante', color: 'emerald' },
  standard: { label: 'Version standard', description: 'Équilibrée et autonome', color: 'indigo' },
  challenge: { label: 'Version défi', description: 'Exigeante et ouverte', color: 'amber' }
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
        if (s.result) setResult(s.result);
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

      setResult(data);
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
      setResult(prev => (prev ? { ...prev, [variant]: data } : prev));
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

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Layers className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Assistant de différenciation pédagogique
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Concevoir des parcours d'apprentissage inclusifs
              </p>
            </div>
          </div>
          <button
            onClick={loadExample}
            className="hidden sm:flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors px-3 py-1.5 rounded-full bg-indigo-50"
          >
            <Lightbulb className="w-4 h-4" />
            Charger un exemple
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Intro Section */}
        <section className="mb-10 text-center max-w-2xl mx-auto">
          <h2 className="text-3xl font-extrabold text-slate-900 mb-3">
            Personnalisez vos activités en un clic
          </h2>
          <p className="text-slate-600 leading-relaxed">
            Cet outil aide les formateurs à créer 3 versions différenciées d'une même activité à partir d'un objectif commun, sans collecter de données personnelles.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Note : Cet outil génère des variantes pédagogiques à partir de paramètres génériques. Il ne traite aucune donnée personnelle et ne remplace pas le jugement du formateur.</span>
          </div>
        </section>

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-12">
          <div className="p-6 sm:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-5">
                <div>
                  <label htmlFor="theme" className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-slate-400" />
                    Thème de l’activité <span className="text-red-500" aria-hidden="true">*</span>
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
                    className={`w-full px-4 py-2.5 rounded-xl border focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50 ${
                      fieldErrors.theme ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'
                    }`}
                  />
                  {fieldErrors.theme && (
                    <p className="mt-1 text-xs text-red-600">Ce champ est obligatoire.</p>
                  )}
                </div>

                <div>
                  <label htmlFor="objective" className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <Target className="w-4 h-4 text-slate-400" />
                    Objectif pédagogique <span className="text-red-500" aria-hidden="true">*</span>
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
                    className={`w-full px-4 py-2.5 rounded-xl border focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50 resize-none ${
                      fieldErrors.objective ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'
                    }`}
                  />
                  {fieldErrors.objective && (
                    <p className="mt-1 text-xs text-red-600">Ce champ est obligatoire.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="target" className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-400" />
                      Public cible
                    </label>
                    <input
                      id="target"
                      type="text"
                      name="target"
                      value={formData.target}
                      onChange={handleInputChange}
                      placeholder="Ex: Demandeurs d'emploi"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50"
                    />
                  </div>
                  <div>
                    <label htmlFor="duration" className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      Durée
                    </label>
                    <input
                      id="duration"
                      type="text"
                      name="duration"
                      value={formData.duration}
                      onChange={handleInputChange}
                      placeholder="Ex: 30 min"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50"
                    />
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-5">
                <div>
                  <span className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <RefreshCcw className="w-4 h-4 text-slate-400" />
                    Type de différenciation
                  </span>
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
                          className={`w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                            selected
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 ring-1 ring-indigo-200'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{type.label}</span>
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all shrink-0 ${
                              selected
                              ? 'bg-indigo-600 border-indigo-600'
                              : 'border-slate-300 bg-slate-50'
                            }`}>
                              {selected && <Check className="w-3 h-3 text-white" />}
                            </div>
                          </div>
                          {selected && (
                            <p className="mt-1.5 text-xs text-indigo-700/80 leading-relaxed font-normal">
                              {type.description}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="format" className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <Layout className="w-4 h-4 text-slate-400" />
                    Format souhaité
                  </label>
                  <div className="relative">
                    <select
                      id="format"
                      name="format"
                      value={formData.format}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50 appearance-none cursor-pointer"
                    >
                      {FORMATS.map(f => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Document de référence (optionnel) */}
            <div className="mt-8 pt-6 border-t border-slate-100">
              <span className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" />
                Document de référence (optionnel)
              </span>
              <p className="text-xs text-slate-500 mb-3">
                Chargez un document (cours, support, fiche) : l'IA s'appuiera sur son contenu pour différencier les activités.
              </p>

              {!docName ? (
                <label className={`flex flex-col items-center justify-center gap-2 w-full px-4 py-6 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                  extracting
                    ? 'border-indigo-200 bg-indigo-50/40 cursor-wait'
                    : 'border-slate-200 bg-slate-50/50 hover:border-indigo-300 hover:bg-indigo-50/30'
                }`}>
                  {extracting ? (
                    <>
                      <Loader className="w-6 h-6 text-indigo-500 animate-spin" />
                      <span className="text-sm font-medium text-slate-600">Extraction du texte en cours…</span>
                    </>
                  ) : (
                    <>
                      <FileUp className="w-6 h-6 text-slate-400" />
                      <span className="text-sm font-medium text-slate-600">Cliquez pour choisir un fichier (PDF, TXT, Markdown)</span>
                      <span className="text-xs text-slate-400">Le fichier reste dans votre navigateur, il n'est pas stocké.</span>
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
                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-emerald-100 p-2 rounded-lg shrink-0">
                      <FileText className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{docName}</p>
                      <p className="text-xs text-slate-500">
                        {docPages > 0 && `${docPages} page${docPages > 1 ? 's' : ''} · `}
                        {docText.length.toLocaleString('fr-FR')} caractères extraits
                        {docTruncated && ' (tronqué)'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearDocument}
                    className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Retirer le document"
                    aria-label="Retirer le document"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {docTruncated && (
                <p className="mt-2 text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Document volumineux : seuls les {MAX_DOC_CHARS.toLocaleString('fr-FR')} premiers caractères seront utilisés.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="mt-10 flex flex-col sm:flex-row gap-4 pt-6 border-t border-slate-100">
              <button
                onClick={generateActivities}
                disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 group"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Sparkles className="w-5 h-5 group-hover:scale-110 transition-transform" />
                )}
                {loading ? 'Génération en cours…' : result ? 'Régénérer les variantes' : 'Générer les variantes'}
              </button>
              <button
                onClick={resetForm}
                disabled={loading}
                className="px-6 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
              >
                Réinitialiser
              </button>
              <button
                onClick={loadExample}
                disabled={loading}
                className="sm:hidden px-6 py-3.5 rounded-xl border border-indigo-100 text-indigo-600 font-bold bg-indigo-50 disabled:opacity-50"
              >
                Charger un exemple
              </button>
            </div>

            {error && (
              <div
                ref={errorRef}
                role="alert"
                className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="flex-1">{error}</span>
                </div>
                {!loading && formData.theme.trim() && formData.objective.trim() && (
                  <button
                    onClick={generateActivities}
                    className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors"
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
              className="mb-12 bg-white rounded-2xl border border-indigo-100 shadow-sm p-8 text-center"
              aria-live="polite"
            >
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-4" />
              <p className="text-slate-800 font-semibold">{loadingMessage}</p>
              <p className="text-sm text-slate-500 mt-1">
                La génération prend généralement 20 à 40 secondes ({elapsed} s écoulée{elapsed > 1 ? 's' : ''}).
              </p>
              <div className="mt-4 max-w-md mx-auto h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-1000"
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
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-slate-900">Vos variantes pédagogiques</h3>
                <p className="text-slate-500">Trois approches adaptées pour un même objectif</p>
                <div className="no-print mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm"
                  >
                    <Printer className="w-4 h-4" />
                    Imprimer / Enregistrer en PDF
                  </button>
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copié' : 'Copier (Markdown)'}
                  </button>
                </div>
                <p className="no-print text-xs text-slate-400 mt-2">
                  Astuce : dans la boîte d'impression, choisis « Enregistrer au format PDF ».
                </p>
              </div>

              {/* Récapitulatif des paramètres (affiché et imprimé avec les fiches) */}
              {genParams && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Paramètres de l'activité</h4>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                    <div>
                      <dt className="font-semibold text-slate-500 inline">Thème : </dt>
                      <dd className="text-slate-800 inline">{genParams.theme}</dd>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <dt className="font-semibold text-slate-500 inline">Objectif : </dt>
                      <dd className="text-slate-800 inline">{genParams.objective}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500 inline">Public : </dt>
                      <dd className="text-slate-800 inline">{genParams.target || '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500 inline">Durée : </dt>
                      <dd className="text-slate-800 inline">{genParams.duration || '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500 inline">Différenciation : </dt>
                      <dd className="text-slate-800 inline">{DIFF_TYPE_LABEL(genParams.diffType)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500 inline">Format : </dt>
                      <dd className="text-slate-800 inline">{FORMAT_LABEL(genParams.format)}</dd>
                    </div>
                    {genParams.docName && (
                      <div className="sm:col-span-2">
                        <dt className="font-semibold text-slate-500 inline">Document de référence : </dt>
                        <dd className="text-slate-800 inline">{genParams.docName}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Sélecteur de variante sur mobile (les 3 cartes restent côte à côte sur grand écran) */}
              <div className="lg:hidden no-print flex rounded-xl border border-slate-200 bg-white p-1 gap-1" role="tablist" aria-label="Choix de la variante affichée">
                {(Object.keys(VARIANT_META) as VariantKey[]).map(key => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={activeVariant === key}
                    onClick={() => setActiveVariant(key)}
                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-bold transition-colors ${
                      activeVariant === key
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {VARIANT_META[key].label.replace('Version ', '')}
                  </button>
                ))}
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
      <footer className="mt-20 border-t border-slate-200 py-10 bg-white">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <p className="text-sm text-slate-500 font-medium">
            Prototype de démonstration, à relire et ajuster par le formateur avant usage.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            © 2026 Assistant de différenciation pédagogique • Sans collecte de données personnelles
          </p>
        </div>
      </footer>
    </div>
  );
}

function VariantCard({ data, label, color, description, regenerating, disabled, onRegenerate }: {
  data: ActivityVariant;
  label: string;
  color: 'emerald' | 'indigo' | 'amber';
  description: string;
  regenerating: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  const colorClasses = {
    emerald: 'border-emerald-200 bg-emerald-50/30 text-emerald-700',
    indigo: 'border-indigo-200 bg-indigo-50/30 text-indigo-700',
    amber: 'border-amber-200 bg-amber-50/30 text-amber-700'
  };

  const badgeClasses = {
    emerald: 'bg-emerald-100 text-emerald-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    amber: 'bg-amber-100 text-amber-700'
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full transition-opacity ${regenerating ? 'opacity-60' : ''}`}
    >
      <div className={`p-5 border-b ${colorClasses[color]}`}>
        <div className="flex items-start justify-between gap-2">
          <div className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 ${badgeClasses[color]}`}>
            {label}
          </div>
          <button
            onClick={onRegenerate}
            disabled={disabled}
            title="Régénérer uniquement cette variante"
            aria-label={`Régénérer la ${label.toLowerCase()}`}
            className="no-print shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-white/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {regenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCcw className="w-4 h-4" />
            )}
          </button>
        </div>
        <h4 className="text-lg font-bold text-slate-900 leading-tight">{data.title}</h4>
        <p className="text-xs mt-1 opacity-80 font-medium">{description}</p>
      </div>

      <div className="p-6 flex-1 space-y-6">
        <div>
          <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Consigne</h5>
          <p className="text-sm text-slate-700 leading-relaxed italic">"{data.instruction}"</p>
        </div>

        <div>
          <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Déroulement</h5>
          <ul className="space-y-3">
            {data.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-600">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
          <h5 className="text-xs font-bold text-slate-500 mb-2">Accompagnement attendu</h5>
          <p className="text-sm text-slate-600">{data.supportLevel}</p>
        </div>

        <div>
          <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Critères de réussite</h5>
          <ul className="space-y-2">
            {data.successCriteria.map((criterion, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                {criterion}
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Pour aller plus loin</h5>
          <p className="text-sm text-slate-600 leading-relaxed">{data.extension}</p>
        </div>
      </div>
    </motion.div>
  );
}
