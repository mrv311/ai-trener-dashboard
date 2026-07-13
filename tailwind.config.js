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
          DEFAULT: '#3b82f6', // Fresh Blue
          dark: '#2563eb',
          glow: 'rgba(59, 130, 246, 0.2)',
        },
        orange: {
          // Vraćamo pravu, svježu narančastu boju za dinamičan sportski izgled
          400: '#fb923c',
          500: '#f97316', 
          600: '#ea580c',
          900: '#fff7ed', // Vrlo svijetla narančasta za pozadine (bivša tamna pozadina)
        },
        red: {
          400: '#ef4444', 
          500: '#dc2626', 
        },
        zinc: {
          // INVERZIJA: 950 je sada svijetla pozadina, a 50-100 su tamni tekst
          // Svijetla pozadina (bivša tamna baza)
          950: '#f8fafc', // Glavna podloga (vrlo svijetlo plavkasto-siva)
          900: '#ffffff', // Modali i kartice (čista bijela)
          
          // Obrubi i hover stanja (bivši tamni obrubi)
          800: '#e2e8f0', // Obrubi kartica
          700: '#f1f5f9', // Hover stanja (lagano sivo)
          
          600: '#cbd5e1',
          500: '#94a3b8',
          400: '#64748b',
          
          // Tamni tekst (bivši svijetli tekst)
          300: '#475569',
          200: '#334155',
          100: '#1e293b', // Glavni tekst
          50:  '#0f172a', // Najtamniji tekst (naslovi)
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        // Modernija i laganija sjena za light mode
        'orange-glow': '0 10px 25px -5px rgba(249, 115, 22, 0.2), 0 8px 10px -6px rgba(249, 115, 22, 0.1)',
        'soft-card': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
      }
    },
  },
  plugins: [],
}