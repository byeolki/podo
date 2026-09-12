import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        canvas: '#0a0a0a',
        surface: {
          1: '#141414',
          2: '#1c1c1c',
          3: '#242424',
        },
        border: {
          DEFAULT: '#262626',
          strong: '#333333',
        },
        ink: {
          primary: '#f5f5f0',
          secondary: '#a8a8a2',
          tertiary: '#7a7a74',
          faint: '#52524c',
        },
        // Grape purple, sampled from the logo in docs/podo_lg.png — podo means
        // grape, and the accent is the one place that has to say so. The native
        // client (Muscat, as in Shine Muscat) is deliberately the green one; they
        // are sibling apps, not the same brand.
        accent: {
          DEFAULT: '#8850E0',
          hover: '#7A42D4',
          soft: '#C098F0',
          muted: '#8850E022',
        },
        // Status colours were missing from the token set, so every error and
        // success message in the app reached for a raw palette class instead.
        danger: '#E5484D',
        success: '#46A758',
        warning: '#F5A524',
      },
      boxShadow: {
        glow: '0 0 28px -4px rgba(136, 80, 224, 0.55)',
      },
    },
  },
  plugins: [],
} satisfies Config
