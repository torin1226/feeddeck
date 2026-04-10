/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          overlay: 'var(--color-surface-overlay)',
          border: 'var(--color-surface-border)',
        },
        accent: {
          DEFAULT: '#f43f5e',
          hover: '#fb7185',
          muted: '#f43f5e33',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
        },
        sfw: {
          DEFAULT: '#f59e0b',
          bg: '#78350f',
        },
        glass: {
          DEFAULT: 'var(--color-glass)',
          heavy: 'var(--color-glass-heavy)',
        },
        highlight: {
          subtle: 'var(--color-highlight-subtle)',
          DEFAULT: 'var(--color-highlight)',
          medium: 'var(--color-highlight-medium)',
          strong: 'var(--color-highlight-strong)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
