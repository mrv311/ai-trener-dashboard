import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, RefreshCw, Send, MessageSquare, AlertCircle, Bot } from 'lucide-react';
import {
  analyzeWorkoutWithGemini,
  askWorkoutFollowUp,
  buildActivityCacheKey,
  getCachedWorkoutAnalysis,
  saveCachedWorkoutAnalysis
} from '../../services/geminiService';
import AIMarkdown from './AIMarkdown';

export default function WorkoutAIAnalysisPanel({
  activity,
  metrics = {},
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  userId = null,
  onAddWorkoutToCalendar,
  onStartWorkoutInTrainer,
  compact = false
}) {
  const cacheKey = buildActivityCacheKey(activity);

  const [analysisText, setAnalysisText] = useState('');
  const [qaHistory, setQaHistory] = useState([]);
  const [userNote, setUserNote] = useState('');
  const [followUpInput, setFollowUpInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cached = getCachedWorkoutAnalysis(cacheKey);
    if (cached?.analysisText) {
      setAnalysisText(cached.analysisText);
      setQaHistory(Array.isArray(cached.qaHistory) ? cached.qaHistory : []);
      setUserNote(cached.userNote || '');
    } else {
      setAnalysisText('');
      setQaHistory([]);
      setUserNote('');
    }
    setError(null);
  }, [cacheKey]);

  const handleGenerateAnalysis = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeWorkoutWithGemini({
        activity,
        metrics,
        athleteProfile,
        liveWorkouts,
        wellnessData,
        userNote,
        userId
      });
      setAnalysisText(result);
      setQaHistory([]);
      saveCachedWorkoutAnalysis(cacheKey, {
        analysisText: result,
        qaHistory: [],
        userNote
      });
    } catch (err) {
      setError(err.message || 'Došlo je do greške pri AI analizi.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAskFollowUp = async (e) => {
    if (e) e.preventDefault();
    const q = followUpInput.trim();
    if (!q || isAsking) return;

    setIsAsking(true);
    setError(null);
    const prevHistory = [...qaHistory];
    const optimisticHistory = [...prevHistory, { role: 'user', text: q }];
    setQaHistory(optimisticHistory);
    setFollowUpInput('');

    try {
      const answer = await askWorkoutFollowUp({
        activity,
        initialAnalysis: analysisText,
        qaHistory: prevHistory,
        question: q,
        athleteProfile,
        liveWorkouts,
        wellnessData,
        userId
      });
      const finalHistory = [...optimisticHistory, { role: 'model', text: answer }];
      setQaHistory(finalHistory);
      saveCachedWorkoutAnalysis(cacheKey, {
        analysisText,
        qaHistory: finalHistory,
        userNote
      });
    } catch (err) {
      setError(err.message || 'Greška pri slanju potpitanja.');
      setQaHistory(prevHistory);
      setFollowUpInput(q);
    } finally {
      setIsAsking(false);
    }
  };

  const ftp = Number(metrics.ftp || athleteProfile?.ftp || 270);

  return (
    <div className={`w-full text-left bg-gradient-to-br from-cyan-950/25 via-zinc-900/90 to-zinc-950 border border-cyan-500/25 rounded-2xl ${compact ? 'p-4' : 'p-5'} shadow-[0_0_25px_rgba(34,211,238,0.06)]`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-zinc-100 tracking-tight flex items-center gap-2">
              ErgVibe AI Trener Analiza
              <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                Gemini 3.8 AI Trener
              </span>
            </h3>
            <p className="text-[11px] text-zinc-400">
              Analiza prema Coggan metrikama (EF, Decoupling, NP), trenutnom opterećenju i povijesti vožnji
            </p>
          </div>
        </div>

        {analysisText && !isAnalyzing && (
          <button
            type="button"
            onClick={handleGenerateAnalysis}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
            title="Ponovno generiraj AI analizu"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Ponovi analizu
          </button>
        )}
      </div>

      {/* Stanje prije generiranja */}
      {!analysisText && !isAnalyzing && (
        <div className="space-y-3 mt-2">
          <input
            type="text"
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            placeholder="Opcionalno: kakav je bio subjektivni osjećaj? (npr. RPE 7/10, teške noge, vruće u sobi...)"
            className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-cyan-500/60 focus:outline-none transition-colors"
          />
          <button
            type="button"
            onClick={handleGenerateAnalysis}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs md:text-sm bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 shadow-[0_4px_15px_rgba(34,211,238,0.25)] transition-all"
          >
            <Sparkles className="w-4 h-4" /> Analiziraj trening s AI Trenerom
          </button>
        </div>
      )}

      {/* Loading state */}
      {isAnalyzing && (
        <div className="py-8 flex flex-col items-center justify-center text-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-200">AI Trener analizira trening i fiziološke parametre...</p>
            <p className="text-xs text-zinc-500 mt-0.5">Analiza snage, Efficiency Factora, Aerobic Decouplinga i oporavka</p>
          </div>
        </div>
      )}

      {/* Greška */}
      {error && (
        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Prikaz gotove analize + Q&A */}
      {analysisText && !isAnalyzing && (
        <div className="mt-3 pt-3 border-t border-zinc-800/80 space-y-4">
          <AIMarkdown
            text={analysisText}
            ftp={ftp}
            onAddWorkoutToCalendar={onAddWorkoutToCalendar}
            onStartWorkoutInTrainer={onStartWorkoutInTrainer}
          />

          {/* Povijest potpitanja */}
          {qaHistory.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-zinc-800/80">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-cyan-400" /> Razgovor o ovom treningu
              </div>
              {qaHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3.5 rounded-xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-100 ml-4 sm:ml-10'
                      : 'bg-zinc-950/70 border border-zinc-800/80 text-zinc-200 mr-2 sm:mr-6'
                  }`}
                >
                  {msg.role === 'model' ? (
                    <div className="flex items-start gap-2.5">
                      <Bot className="w-4 h-4 text-cyan-400 shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <AIMarkdown
                          text={msg.text}
                          ftp={ftp}
                          onAddWorkoutToCalendar={onAddWorkoutToCalendar}
                          onStartWorkoutInTrainer={onStartWorkoutInTrainer}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs md:text-sm font-medium">{msg.text}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Forma za dodatno pitanje */}
          <form onSubmit={handleAskFollowUp} className="flex items-center gap-2 pt-2">
            <input
              type="text"
              value={followUpInput}
              onChange={(e) => setFollowUpInput(e.target.value)}
              disabled={isAsking}
              placeholder="Postavi potpitanje treneru o ovoj vožnji (npr. zašto je decoupling bio takav, što sutra voziti?)"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-cyan-500 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isAsking || !followUpInput.trim()}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-zinc-950 font-black text-xs flex items-center gap-1.5 transition-colors shrink-0"
            >
              {isAsking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Pitaj
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
