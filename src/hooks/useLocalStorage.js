import { useState, useEffect } from 'react';

export function useLocalStorage(key, initialValue) {
  const [state, setState] = useState({
    key,
    value: (() => {
      try {
        const item = window.localStorage.getItem(key);
        if (item !== null) {
          try { return JSON.parse(item); } catch { return item; }
        }
        return initialValue;
      } catch { return initialValue; }
    })()
  });

  let currentValue = state.value;

  // Sinkrono ažuriranje ako se promijeni ključ (sprječava race conditione)
  if (key !== state.key) {
    let newValue = initialValue;
    try {
      const item = window.localStorage.getItem(key);
      if (item !== null) {
        try { newValue = JSON.parse(item); } catch { newValue = item; }
      }
    } catch {}
    setState({ key, value: newValue });
    currentValue = newValue;
  }

  const setValue = (val) => setState((prev) => ({ key: prev.key, value: typeof val === 'function' ? val(prev.value) : val }));

  useEffect(() => {
    try {
      const valueToStore = typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue);
      window.localStorage.setItem(key, valueToStore);
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, currentValue]);

  return [currentValue, setValue];
}
