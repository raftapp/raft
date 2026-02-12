/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{html,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        raft: {
          50: '#faf5f0',
          100: '#f4e8db',
          200: '#e8cfb6',
          300: '#dab28a',
          400: '#cb905d',
          500: '#c07a42',
          600: '#b26436',
          700: '#944f2e',
          800: '#78422b',
          900: '#623825',
          950: '#351b12',
        },
      },
    },
  },
  plugins: [],
}
