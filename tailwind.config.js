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
          DEFAULT: '#1e3a8a',
          hover: '#3b82f6',
          muted: '#1e3a8a33',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
        },
        sfw: {
          DEFAULT: '#f59e0b',
          bg: '#78350f',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      // ---------- Typography Scale ----------
      // Named sizes replacing arbitrary text-[Npx] values across the codebase.
      // micro(10) < caption(11) < label(12) < body(13) < subhead(14) < title(18) < display(26) < headline(28)
      fontSize: {
        'micro': ['10px', { lineHeight: '1.4' }],
        'caption': ['11px', { lineHeight: '1.45' }],
        'label': ['12px', { lineHeight: '1.5' }],
        'body-sm': ['13px', { lineHeight: '1.5' }],
        'subhead': ['14px', { lineHeight: '1.4' }],
        'title': ['18px', { lineHeight: '1.3' }],
        'display': ['26px', { lineHeight: '1.2' }],
        'headline': ['28px', { lineHeight: '1.2' }],
      },
      // ---------- Design Token System ----------
      // Standardized z-index scale. Use these instead of arbitrary z-[] values.
      // base(0) < content(10) < sticky(20) < overlay(30) < header(40) < modal(50) < toast(60) < system(70)
      zIndex: {
        'base': '0',
        'content': '10',
        'sticky': '20',
        'overlay': '30',
        'header': '40',
        'modal': '50',
        'toast': '60',
        'system': '70',
      },
      // Elevation shadows: cinematic depth hierarchy for dark UI
      boxShadow: {
        'card': '0 2px 8px rgba(0,0,0,0.3)',
        'card-hover': '0 12px 32px rgba(0,0,0,0.4)',
        'float': '0 8px 40px rgba(0,0,0,0.6)',
        'modal': '0 24px 64px rgba(0,0,0,0.7)',
        'glow-accent': '0 0 24px rgba(30,58,138,0.4), 0 8px 32px rgba(30,58,138,0.25)',
        'inner-subtle': 'inset 0 1px 0 rgba(255,255,255,0.04)',
        // Glass material shadows — map to CSS custom properties so they
        // respect both dark and light mode without duplication.
        'glass': 'var(--glass-shadow)',
        'glass-glow': 'var(--glass-glow-accent)',
        'glass-highlight': 'inset 0 1px 0 var(--glass-highlight)',
      },
      // Card corner radius tokens
      borderRadius: {
        'card': '10px',
        'card-lg': '14px',
        'pill': '9999px',
      },
      // Standardized widths for cards and containers
      width: {
        'card': '200px',
        'card-lg': '230px',
        'card-sm': '160px',
      },
      height: {
        'card-thumb': '113px',
        'card-thumb-lg': '130px',
      },
      // Animation timing presets
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'cinematic': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        'fast': '150ms',
        'normal': '250ms',
        'slow': '500ms',
      },
      // Shimmer animation for loading skeletons
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'shimmer': 'shimmer 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [
    // Variant for pointer: fine (non-touch devices) — used by CategoryRow nav arrows
    function({ addVariant }) {
      addVariant('pointer-fine', '@media (pointer: fine)')
    },
  ],
}
