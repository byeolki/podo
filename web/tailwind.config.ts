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
        // Shine Muscat green — the app's single accent color, shared with the
        // native client (MuscatKit's DesignSystem.appAccent) for brand parity.
        accent: {
          DEFAULT: '#b8d148',
          hover: '#a3bc3d',
          soft: '#c8dc72',
          muted: '#b8d14822',
        },
      },
      boxShadow: {
        glow: '0 0 28px -4px rgba(184, 209, 72, 0.5)',
      },
    },
  },
  plugins: [],
} satisfies Config
