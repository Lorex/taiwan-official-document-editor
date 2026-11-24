/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./frontend/public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        ink: '#1f2329',
        bar: '#1f2329',
        accent: '#3b5bdb',
      },
    },
  },
  plugins: [],
};
