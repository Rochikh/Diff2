import React, { useState } from 'react';
import { 
  Sparkles, 
  RefreshCcw, 
  Lightbulb, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  BookOpen,
  Users,
  Clock,
  Layers,
  Layout,
  Target,
  Check,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";

interface ActivityVariant {
  title: string;
  instruction: string;
  steps: string[];
  supportLevel: string;
  successCriteria: string[];
  extension: string;
}

interface GenerationResult {
  guided: ActivityVariant;
  standard: ActivityVariant;
  challenge: ActivityVariant;
}

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

export default function App() {
  const [formData, setFormData] = useState({
    theme: '',
    objective: '',
    target: '',
    duration: '',
    diffType: 'autonomie',
    format: 'individuel'
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const loadExample = () => {
    setFormData({
      theme: 'Rédiger un mail professionnel',
      objective: 'Écrire un message clair, structuré et poli',
      target: 'Adultes en formation',
      duration: '15 minutes',
      diffType: 'autonomie',
      format: 'individuel'
    });
  };

  const resetForm = () => {
    setFormData({
      theme: '',
      objective: '',
      target: '',
      duration: '',
      diffType: 'autonomie',
      format: 'individuel'
    });
    setResult(null);
    setError(null);
  };

  const generateActivities = async () => {
    if (loading) return;
    
    if (!formData.theme || !formData.objective) {
      setError('Veuillez remplir au moins le thème et l\'objectif.');
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      setError('Clé API Gemini manquante. Veuillez configurer votre environnement.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `En tant qu'expert en pédagogie, génère 3 variantes différenciées d'une activité d'apprentissage basées sur les paramètres suivants :
      - Thème : ${formData.theme}
      - Objectif pédagogique : ${formData.objective}
      - Public cible : ${formData.target}
      - Durée estimée : ${formData.duration}
      - Type de différenciation : ${formData.diffType}
      - Format souhaité : ${formData.format}

      Règles pédagogiques :
      - Garde le même objectif pédagogique pour les 3 versions.
      - Varie uniquement le niveau d'étayage, d'autonomie ou de complexité selon le type de différenciation choisi (${formData.diffType}).
      - Version très guidée : hautement étayée, explicite, rassurante.
      - Version standard : équilibrée, utilisable en conditions ordinaires.
      - Version défi : plus ouverte, exigeante, ou demandant un transfert de compétences.
      - Évite le jargon inutile et les clichés éducatifs vagues.
      - Les sorties doivent être concrètes et directement utilisables.
      - Ne mentionne pas la taxonomie de Bloom.

      Chaque variante doit inclure :
      - Titre
      - Consigne
      - Déroulement en étapes
      - Niveau d'accompagnement attendu
      - Critères de réussite
      - Variante possible pour aller plus loin`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              guided: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  instruction: { type: Type.STRING },
                  steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                  supportLevel: { type: Type.STRING },
                  successCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
                  extension: { type: Type.STRING },
                },
                required: ["title", "instruction", "steps", "supportLevel", "successCriteria", "extension"],
              },
              standard: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  instruction: { type: Type.STRING },
                  steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                  supportLevel: { type: Type.STRING },
                  successCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
                  extension: { type: Type.STRING },
                },
                required: ["title", "instruction", "steps", "supportLevel", "successCriteria", "extension"],
              },
              challenge: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  instruction: { type: Type.STRING },
                  steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                  supportLevel: { type: Type.STRING },
                  successCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
                  extension: { type: Type.STRING },
                },
                required: ["title", "instruction", "steps", "supportLevel", "successCriteria", "extension"],
              },
            },
            required: ["guided", "standard", "challenge"],
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("Réponse vide du modèle.");
      
      const data = JSON.parse(text);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue. Veuillez réessayer.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-slate-400" />
                    Thème de l’activité
                  </label>
                  <input
                    type="text"
                    name="theme"
                    value={formData.theme}
                    onChange={handleInputChange}
                    placeholder="Ex: La gestion du temps, Excel niveau 1..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <Target className="w-4 h-4 text-slate-400" />
                    Objectif pédagogique
                  </label>
                  <textarea
                    name="objective"
                    value={formData.objective}
                    onChange={handleInputChange}
                    rows={3}
                    placeholder="Ex: Être capable de structurer un argumentaire de vente..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-400" />
                      Public cible
                    </label>
                    <input
                      type="text"
                      name="target"
                      value={formData.target}
                      onChange={handleInputChange}
                      placeholder="Ex: Demandeurs d'emploi"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      Durée
                    </label>
                    <input
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
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <RefreshCcw className="w-4 h-4 text-slate-400" />
                    Type de différenciation
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {DIFF_TYPES.map(type => (
                      <div key={type.id} className="relative group/tooltip">
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, diffType: type.id }))}
                          className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between group cursor-pointer ${
                            formData.diffType === type.id 
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 ring-1 ring-indigo-200' 
                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{type.label}</span>
                            <Info className="w-4 h-4 text-slate-400 hover:text-indigo-500 transition-colors" />
                          </div>
                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all shrink-0 ${
                            formData.diffType === type.id 
                            ? 'bg-indigo-600 border-indigo-600' 
                            : 'border-slate-300 bg-slate-50'
                          }`}>
                            {formData.diffType === type.id && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </button>
                        
                        {/* Tooltip */}
                        <div className="absolute left-0 bottom-full mb-2 w-72 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all z-10 pointer-events-none">
                          <div className="font-semibold mb-1">{type.label}</div>
                          <div className="text-slate-300 leading-relaxed">{type.description}</div>
                          {/* Arrow */}
                          <div className="absolute left-6 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-2">
                    <Layout className="w-4 h-4 text-slate-400" />
                    Format souhaité
                  </label>
                  <select
                    name="format"
                    value={formData.format}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none bg-slate-50/50 appearance-none"
                  >
                    {FORMATS.map(f => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                </div>
              </div>
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
                Générer les variantes
              </button>
              <button
                onClick={resetForm}
                className="px-6 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
              >
                Réinitialiser
              </button>
              <button 
                onClick={loadExample}
                className="sm:hidden px-6 py-3.5 rounded-xl border border-indigo-100 text-indigo-600 font-bold bg-indigo-50"
              >
                Charger un exemple
              </button>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Results Section */}
        <AnimatePresence>
          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-slate-900">Vos variantes pédagogiques</h3>
                <p className="text-slate-500">Trois approches adaptées pour un même objectif</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <VariantCard 
                  type="guided" 
                  data={result.guided} 
                  label="Version très guidée" 
                  color="emerald" 
                  description="Hautement étayée et rassurante"
                />
                <VariantCard 
                  type="standard" 
                  data={result.standard} 
                  label="Version standard" 
                  color="indigo" 
                  description="Équilibrée et autonome"
                />
                <VariantCard 
                  type="challenge" 
                  data={result.challenge} 
                  label="Version défi" 
                  color="amber" 
                  description="Exigeante et ouverte"
                />
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

function VariantCard({ data, label, color, description }: { 
  data: ActivityVariant; 
  label: string; 
  color: 'emerald' | 'indigo' | 'amber';
  description: string;
  type: string;
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
      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col"
    >
      <div className={`p-5 border-b ${colorClasses[color]}`}>
        <div className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 ${badgeClasses[color]}`}>
          {label}
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
