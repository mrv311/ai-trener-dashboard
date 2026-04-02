/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Ovdje Tailwindu kažemo: Kad god vidiš 'font-sans', koristi Inter!
        sans: ['Montserrat', 'sans-serif'],
      },
    },
  },
  plugins: [],
}