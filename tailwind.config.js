/** @type {import('tailwindcss').Config} */
// Colours come from the Layan design system (DESIGN_SYSTEM.md). Every class maps to a CSS variable defined
// in src/index.css, so day and night colours switch in one place. Stored as RGB triplets so opacity
// modifiers (bg-white/95) keep working.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Rubik', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        num: ['Rubik', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '16px', '2xl': '24px' },
      boxShadow: { sm: 'var(--shadow-card)' },
      colors: {
        white: v('surface'),
        slate: {
          50: v('surface-2'), 100: v('border'), 200: v('border'), 300: v('border-strong'), 400: v('text-3'),
          500: v('text-2'), 600: v('text-2'), 700: v('text'), 800: v('text'), 900: v('toast'),
        },
        brand: { DEFAULT: v('primary-strong'), soft: v('primary-soft'), light: v('primary'), muted: v('primary-muted'), num: v('num') },
        warm: { soft: v('accent-soft') },
        // medical colours: DEFAULT is the readable text colour, soft is the chip background
        ok: { DEFAULT: v('st-in-text'), soft: v('st-in-soft'), fill: v('st-in') },
        near: { DEFAULT: v('st-high-text'), soft: v('st-high-soft'), fill: v('st-high') },
        over: { DEFAULT: v('st-low-text'), soft: v('st-low-soft'), fill: v('st-low') },
      },
    },
  },
  plugins: [],
};
