/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'system-ui', 'Tahoma', 'sans-serif'] },
      colors: {
        ok: { DEFAULT: '#1f8a5b', soft: '#e3f4ec' },
        near: { DEFAULT: '#b7791f', soft: '#fdf1d8' },
        over: { DEFAULT: '#c0392b', soft: '#fbe4e1' },
        brand: { DEFAULT: '#2f6f8f', soft: '#e4f0f6' },
      },
    },
  },
  plugins: [],
};
