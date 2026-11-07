/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        short: { raw: '(max-height: 820px)' },
        vshort: { raw: '(max-height: 680px)' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Chakra Petch"', '"Rajdhani"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Dinamički primarni akcent — zadano Acid Volt (#a3e635) s logotipa kazete
        volt: {
          DEFAULT: 'rgb(var(--accent-400) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          950: 'rgb(var(--accent-950) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--accent-400) / <alpha-value>)',
          dark: 'rgb(var(--accent-500) / <alpha-value>)',
          glow: 'rgb(var(--accent-400) / 0.16)',
        },
        // CARBON GRAPHITE paleta — čisti mat karbonski tonovi bez hladne plave magle
        zinc: {
          950: '#09090b', // Najdublja mat karbonska baza (body)
          900: '#111215', // Glavni cockpit paneli, sidebar, modali
          850: '#16181d', // Povišene kartice i telemetrijski podovi
          800: '#23252c', // Precizni 1px tehnički obrubi
          700: '#32353f', // Aktivni obrubi i hover stanja
          600: '#4b505d', // Prigušene oznake i skale
          500: '#757b8a', // Tehničke labele (visoka čitljivost)
          400: '#a0a6b5', // Sekundarni tekst
          300: '#d0d4de', // Primarni tekst kartica
          200: '#e7e9ef', // Svijetli brojčani prikazi
          100: '#f4f5f8', // Naglašeni naslovi
          50:  '#fafafa', // Vršni kontrast
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-flywheel': 'spin 8s linear infinite',
      },
      boxShadow: {
        'volt-glow': '0 8px 24px -6px rgb(var(--accent-400) / 0.28), 0 2px 8px -2px rgb(var(--accent-400) / 0.18)',
        'hardware': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05), 0 4px 14px -2px rgba(0, 0, 0, 0.55)',
        'soft-card': '0 4px 12px -2px rgba(0, 0, 0, 0.45), 0 2px 6px -2px rgba(0, 0, 0, 0.35)',
      }
    },
  },
  plugins: [],
}
