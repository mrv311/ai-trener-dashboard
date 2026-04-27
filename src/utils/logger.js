/**
 * Logger Utility
 * Centralizirani logging sustav koji automatski isključuje debug logove u produkciji
 */

const isDev = import.meta.env.DEV;

export const logger = {
  /**
   * Info level - prikazuje se samo u development modu
   */
  info: (...args) => {
    if (isDev) {
      console.log('[INFO]', ...args);
    }
  },

  /**
   * Warning level - prikazuje se uvijek
   */
  warn: (...args) => {
    console.warn('[WARN]', ...args);
  },

  /**
   * Error level - prikazuje se uvijek
   */
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },

  /**
   * Debug level - prikazuje se samo u development modu
   */
  debug: (...args) => {
    if (isDev) {
      console.debug('[DEBUG]', ...args);
    }
  },

  /**
   * Success level - prikazuje se samo u development modu
   */
  success: (...args) => {
    if (isDev) {
      console.log('[SUCCESS] ✅', ...args);
    }
  }
};

export default logger;
