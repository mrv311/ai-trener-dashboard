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
          DEFAULT: '#B2BD7E', // Muted Olive
          dark: '#9ba763',    // Darker Muted Olive
          glow: 'rgba(178, 189, 126, 0.4)',
        },
        orange: {
          400: '#749C75', // Sage Green
          500: '#B2BD7E', // Muted Olive
          600: '#9ba763', // Darker Muted Olive
          900: '#2A2030', // Very Dark Grape
        },
        red: {
          400: '#6A5D7B', // Dusty Lavender
          500: '#6A5D7B',
        },
        zinc: {
          50: '#ffffff',
          100: '#ffffff', // Pure White (Main text for max contrast)
          200: '#f4f0f7', // Light tinted white
          300: '#e5deeb', 
          400: '#c5b8d0', // Light Grape (Secondary text)
          500: '#a392b2', // Mid Grape
          600: '#9b8ba9', // Muted Grape (Inactive text, ensuring it's light enough to read on dark backgrounds)
          700: '#6A5D7B', // Dusty Lavender (Hover states, active elements)
          800: '#5D4A66', // Vintage Grape (Borders, subtle cards)
          900: '#403247', // Dark Grape (Cards, Sidebars)
          950: '#2A2030', // Very Dark Grape (Main app background)
        }
      },
      animation: {
        // Dodajemo custom pulsiranje za "Live" trening ili "Connecting" status
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        // Definiramo tvoj specifični glow kao utility klasu (Muted Olive boja)
        'orange-glow': '0 0 15px rgba(178, 189, 126, 0.4)',
      }
    },
  },
  plugins: [
    // Preporuka: dodaj tailwind-scrollbar ako želiš sakriti ružne default scrollbare u Sidebar-u
    // require('tailwind-scrollbar'),
  ],
}