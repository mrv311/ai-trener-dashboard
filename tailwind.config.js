/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Montserrat', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#22d3ee', // Electric Cyan
          dark: '#06b6d4',
          glow: 'rgba(34, 211, 238, 0.15)',
        },
        orange: {
          // Accent — sada cyan/teal tonovi umjesto narančaste
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          900: '#0c1929', // Duboka pozadina za akcent kartice
        },
        red: {
          400: '#fb7185',
          500: '#f43f5e',
        },
        zinc: {
          // MIDNIGHT OCEAN paleta — tamnoplavi tonovi umjesto čiste sive
          950: '#0a0e1a', // Najdublja baza (body)
          900: '#111827', // Kartice, sidebar, modali
          
          // Obrubi i hover stanja
          800: '#1e293b', // Obrubi kartica — vidljivi na tamnoj bazi
          700: '#243b53', // Hover stanja, istaknuti obrubi
          
          600: '#334155', // Prigušeni elementi
          500: '#64748b', // Sekundarni tekst (i dalje čitljiv!)
          400: '#94a3b8', // Glavni sekundarni tekst — odličan kontrast
          300: '#cbd5e1', // Istaknuti tekst
          200: '#e2e8f0', // Glavni tekst — ice white
          100: '#f1f5f9', // Naglašeni naslovi
          50:  '#f8fafc', // Najsvjetliji (rijetko korišten)
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        // Cyan glow umjesto narančastog
        'orange-glow': '0 10px 25px -5px rgba(34, 211, 238, 0.25), 0 8px 10px -6px rgba(34, 211, 238, 0.15)',
        'soft-card': '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 2px 6px -2px rgba(0, 0, 0, 0.3)',
      }
    },
  },
  plugins: [],
}