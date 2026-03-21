/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0a0a0b',
          raised: '#141416',
          overlay: '#1c1c1f',
          border: '#2a2a2e',
        },
        accent: {
          DEFAULT: '#e50914',
          hover: '#f6121d',
          muted: '#e5091433',
        },
        text: {
          primary: '#e5e5e5',
          secondary: '#a1a1a6',
          muted: '#6b6b70',
        },
        sfw: {
          DEFAULT: '#f59e0b',
          bg: '#78350f',
        }
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
