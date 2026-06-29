import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        surface: {
          1: '#181818',
          2: '#222222',
          3: '#2a2a2a',
        },
        border: '#333333',
        accent: {
          DEFAULT: '#a855f7',
          hover: '#9333ea',
          muted: '#7c3aed20',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
