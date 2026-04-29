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
        // BOJA 1: Prigušeni akcent (Muted Accent) - Zamjenjuje neon zelenu
        // Koristi se za ključne podatke, grafove i primarne gumbe, bez "vrištanja"
        brand: {
          DEFAULT: '#738794', // Muted Slate/Steel (Prilagodi točnom HEX-u s tvoje slike)
          dark: '#586a75',
          glow: 'rgba(115, 135, 148, 0.2)', // Drastično smanjen intenzitet sjene
        },
        orange: {
          400: '#8ba2b3',
          500: '#738794', // Pregaženo: Mapirano na Boju 1
          600: '#586a75',
          900: '#1a1d21', // Pregaženo: Mapirano na pozadinu
        },
        red: {
          400: '#e57373', // Muted Red 400
          500: '#ef5350', // Muted Red 500
        },
        zinc: {
          // BOJA 2: Svijetli tekst (Off-White/Light Gray) - Nije apsolutno bijela radi smanjenja kontrasta
          50: '#f8f9fa',
          100: '#e9ecef',
          200: '#dee2e6',
          300: '#ced4da',

          // BOJA 3: Srednja površina (Surface/Borders) - Za kartice, tablice i neaktivne elemente
          400: '#adb5bd',
          500: '#6c757d',
          600: '#495057',
          700: '#343a40', // Hover stanja
          800: '#212529', // Obrubi kartica

          // BOJA 4: Tamna baza (Deep Base) - Glavna pozadina
          900: '#1a1d21', // Surface pozadine (Modali)
          950: '#121417', // Glavna podloga (Prilagodi točnom tamnom HEX-u s tvoje slike)
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        // Umjesto neonskog sjaja, koristimo suptilnu dubinu
        'orange-glow': '0 4px 12px rgba(0, 0, 0, 0.3)',
      }
    },
  },
  plugins: [],
}