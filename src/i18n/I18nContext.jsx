import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  getCurrentLanguage,
  setCurrentLanguage,
  subscribeLanguage,
  getLocale,
  tr,
  translateCategory,
  translateStepName,
  translateWorkoutDescription
} from './i18nCore.js';

export {
  getCurrentLanguage,
  setCurrentLanguage,
  getLocale,
  tr,
  translateCategory,
  translateStepName,
  translateWorkoutDescription
} from './i18nCore.js';

const I18nContext = createContext({
  lang: 'en',
  isEn: true,
  isHr: false,
  locale: 'en-US',
  setLang: () => {},
  toggleLang: () => {},
  tr: (hr, en, vars) => tr(hr, en, vars, 'en'),
  tCat: (cat) => translateCategory(cat, 'en'),
  tStep: (name) => translateStepName(name, 'en'),
  tDesc: (title, desc) => translateWorkoutDescription(title, desc, 'en')
});

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => getCurrentLanguage());

  useEffect(() => subscribeLanguage(setLangState), []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute(
        'content',
        lang === 'en'
          ? 'ErgVibe — Cycling telemetry, smart FTMS ERG trainer, training planning, and AI physiological analytics.'
          : 'ErgVibe — Biciklistička telemetrija, pametni FTMS ERG trenažer, planiranje treninga i AI fiziološka analitika.'
      );
    }
  }, [lang]);

  const setLang = useCallback((nextLang) => {
    setCurrentLanguage(nextLang);
  }, []);

  const toggleLang = useCallback(() => {
    setCurrentLanguage(getCurrentLanguage() === 'en' ? 'hr' : 'en');
  }, []);

  const value = useMemo(
    () => ({
      lang,
      isEn: lang === 'en',
      isHr: lang === 'hr',
      locale: getLocale(lang),
      setLang,
      toggleLang,
      tr: (hr, en, vars) => tr(hr, en, vars, lang),
      tCat: (cat) => translateCategory(cat, lang),
      tStep: (name) => translateStepName(name, lang),
      tDesc: (title, desc) => translateWorkoutDescription(title, desc, lang)
    }),
    [lang, setLang, toggleLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
