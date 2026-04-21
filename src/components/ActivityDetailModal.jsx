import React, { useState } from 'react';
import { X, Download, Activity, Heart, Zap, Clock, TrendingUp, BarChart2 } from 'lucide-react';
import { downloadActivityFitFile } from '../services/intervalsApi';

const formatDur = (mins) => {
  if (!mins) return '-';
  const h = Math.floor(mins / 60);
  return `${h > 0 ? h + 'h ' : ''}${String(Math.floor(mins % 60)).padStart(2, '0')}m`;
};

export default function ActivityDetailModal({ activity, isOpen, onClose }) {
  const [isDownloading, setIsDownloading] = useState(false);

  if (!isOpen || !activity) return null;

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      // Ovdje trebamo userId i API ključ iz localStorage-a jer modal ih možda nema kao propse
      // Ako postoje sigurnije alternative u arhitekturi, trebali bi pratiti taj uzorak
      const profileStr = localStorage.getItem('userProfile');
      let intervalsId = '';
      let intervalsKey = '';
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        intervalsId = profile.intervalsId;
        intervalsKey = profile.intervalsApiKey;
      }
      
      if (!intervalsId || !intervalsKey) throw new Error("Nedostaju Intervals.icu podaci za prijavu.");
      
      const realActivityId = activity.actId || activity.id.toString().replace('act-', '');
      await downloadActivityFitFile(intervalsId, intervalsKey, realActivityId);
    } catch (error) {
      alert(error.message);
    } finally {
      setIsDownloading(false);
    }
  };

  const actualTss = activity.tss || activity.icu_training_load || 0;
  const plannedTss = activity.plannedTss || 0;
  const actualDur = activity.duration || 0;
  const plannedDur = activity.plannedDuration || 0;

  // Compliance calculations
  let tssColor = "text-zinc-100";
  let tssBgColor = "bg-zinc-800/50";
  if (plannedTss > 0) {
    const ratio = actualTss / plannedTss;
    if (ratio >= 0.95 && ratio <= 1.05) {
      tssColor = "text-emerald-400";
      tssBgColor = "bg-emerald-500/10 border-emerald-500/20";
    } else if (ratio >= 0.8 && ratio <= 1.2) {
      tssColor = "text-amber-400";
      tssBgColor = "bg-amber-500/10 border-amber-500/20";
    } else {
      tssColor = "text-rose-400";
      tssBgColor = "bg-rose-500/10 border-rose-500/20";
    }
  }

  // Same for duration
  let durColor = "text-zinc-100";
  let durBgColor = "bg-zinc-800/50";
  if (plannedDur > 0) {
    const ratio = actualDur / plannedDur;
    if (ratio >= 0.95 && ratio <= 1.05) {
      durColor = "text-emerald-400";
      durBgColor = "bg-emerald-500/10 border-emerald-500/20";
    } else if (ratio >= 0.8 && ratio <= 1.2) {
      durColor = "text-amber-400";
      durBgColor = "bg-amber-500/10 border-amber-500/20";
    } else {
      durColor = "text-rose-400";
      durBgColor = "bg-rose-500/10 border-rose-500/20";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-5 border-b border-zinc-800/80 bg-zinc-950/50">
          <div>
            <h2 className="text-xl font-black text-zinc-100 leading-tight flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500" />
              {activity.title || "Detalji aktivnosti"}
            </h2>
            <p className="text-sm font-medium text-zinc-500 mt-1">{activity.date}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-rose-500/20 rounded-lg transition-colors border border-transparent hover:border-rose-500/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          {/* Glavne Metrike - Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><Zap className="w-3 h-3 text-amber-400" /> NP</span>
              <span className="text-xl font-black text-zinc-100">{activity.np || activity.normalized_power || '-'} <span className="text-xs text-zinc-600 font-medium lowercase">W</span></span>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><BarChart2 className="w-3 h-3 text-sky-400" /> Avg Pwr</span>
              <span className="text-xl font-bold text-zinc-200">{activity.average_power || activity.avgPower || '-'} <span className="text-xs text-zinc-600 font-medium lowercase">W</span></span>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3 text-orange-400" /> Max Pwr</span>
              <span className="text-xl font-bold text-zinc-200">{activity.max_power || activity.maxPower || '-'} <span className="text-xs text-zinc-600 font-medium lowercase">W</span></span>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><Heart className="w-3 h-3 text-rose-500" /> Avg HR</span>
              <span className="text-xl font-bold text-zinc-200">{activity.average_heartrate || activity.averageHr || '-'} <span className="text-xs text-zinc-600 font-medium lowercase">bpm</span></span>
            </div>
          </div>

          {/* Usporedba Planned vs Actual */}
          <div>
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3 border-b border-zinc-800 pb-2">Plan vs Realizacija</h3>
            <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/30">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-zinc-900/50 border-b border-zinc-800/80 text-zinc-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Metrika</th>
                    <th className="px-4 py-3 font-semibold">Planirano</th>
                    <th className="px-4 py-3 font-semibold">Ostvareno</th>
                    <th className="px-4 py-3 font-semibold">Status (Score)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  <tr className="hover:bg-zinc-900/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-zinc-300 flex items-center gap-2"><Clock className="w-4 h-4 text-zinc-500" /> Trajanje</td>
                    <td className="px-4 py-3 text-zinc-400">{plannedDur ? formatDur(plannedDur) : '-'}</td>
                    <td className="px-4 py-3 font-semibold text-zinc-200">{actualDur ? formatDur(actualDur) : '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${durBgColor} ${durColor}`}>
                         {plannedDur ? `${Math.round((actualDur/plannedDur)*100)}%` : 'N/A'}
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-zinc-900/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-zinc-300 flex items-center gap-2"><Activity className="w-4 h-4 text-zinc-500" /> TSS</td>
                    <td className="px-4 py-3 text-zinc-400">{plannedTss || '-'}</td>
                    <td className="px-4 py-3 font-semibold text-zinc-200">{actualTss || actualTss === 0 ? actualTss : '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${tssBgColor} ${tssColor}`}>
                         {plannedTss ? `${Math.round((actualTss/plannedTss)*100)}%` : 'N/A'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex justify-end p-5 border-t border-zinc-800/80 bg-zinc-950/50 gap-3">
          <button 
            type="button" 
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm text-zinc-300 bg-zinc-800/50 hover:bg-zinc-700/50 hover:text-white transition-all border border-zinc-700/50"
          >
            Zatvori
          </button>
          
          <button
            onClick={handleDownload}
            disabled={isDownloading || (!activity.id && !activity.actId)}
            className="px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDownloading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <Download className="w-4 h-4" />
            )}
            Preuzmi .FIT datoteku
          </button>
        </div>
      </div>
    </div>
  );
}
