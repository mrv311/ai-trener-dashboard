/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Montserrat je odličan izbor za sportske metrike (čitljivost brojeva)
        sans: ['Montserrat', 'sans-serif'],
      },
      colors: {
        // Centraliziramo brand boje za lakšu promjenu u cijeloj aplikaciji
        brand: {
          DEFAULT: '#f97316', // orange-500
          dark: '#ea580c',    // orange-600
          glow: 'rgba(249, 115, 22, 0.4)',
        },
        zinc: {
          950: '#09090b', // Ultra dark za dashboard pozadinu
        }
      },
      animation: {
        // Dodajemo custom pulsiranje za "Live" trening ili "Connecting" status
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        // Definiramo tvoj specifični 'orange glow' kao utility klasu
        'orange-glow': '0 0 15px rgba(249, 115, 22, 0.4)',
      }
    },
  },
  plugins: [
    // Preporuka: dodaj tailwind-scrollbar ako želiš sakriti ružne default scrollbare u Sidebar-u
    // require('tailwind-scrollbar'),
  ],
}