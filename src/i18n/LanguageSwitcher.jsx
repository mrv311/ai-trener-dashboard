import React from 'react';
import { Globe } from 'lucide-react';
import { useI18n } from './I18nContext';

/**
 * Kompaktan, taktički HR | EN prebacivač jezika za Sidebar, Header i AuthPage.
 */
export default function LanguageSwitcher({ compact = false, className = '' }) {
  const { lang, setLang, toggleLang } = useI18n();

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleLang}
        title={lang === 'en' ? 'Switch language to Croatian (HR)' : 'Prebaci jezik na engleski (EN)'}
        aria-label={lang === 'en' ? 'Switch language to Croatian' : 'Switch language to English'}
        className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 hover:bg-zinc-800 text-[11px] font-mono font-bold tracking-wider text-zinc-200 transition-colors ${className}`}
      >
        <Globe className="w-3.5 h-3.5 text-lime-400 shrink-0" />
        <span>{lang.toUpperCase()}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Language"
      className={`inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950/90 p-0.5 ${className}`}
    >
      <Globe className="w-3.5 h-3.5 text-zinc-500 ml-1.5 mr-1 shrink-0" />
      <button
        type="button"
        onClick={() => setLang('en')}
        className={`px-2 py-1 rounded-md text-[11px] font-mono font-bold tracking-wider transition-all ${
          lang === 'en'
            ? 'bg-lime-400 text-zinc-950 shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang('hr')}
        className={`px-2 py-1 rounded-md text-[11px] font-mono font-bold tracking-wider transition-all ${
          lang === 'hr'
            ? 'bg-lime-400 text-zinc-950 shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        HR
      </button>
    </div>
  );
}
