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
        // Every step is text somewhere — `ink-faint` alone appears in 84 places,
        // almost all of them words — so every step clears 4.5:1 against `canvas`
        // and against the surfaces those words sit on. The old ramp bottomed out
        // at #52524c: 2.5:1, which put durations, timestamps and half the
        // supporting copy in the app below the floor.
        ink: {
          /** Titles and anything read first. 18.1:1 */
          primary: '#f5f5f0',
          /** Artist lines, subtitles, body copy. 8.3:1 */
          secondary: '#a8a8a2',
          /** Counts, timestamps, section meta. 6.5:1 */
          tertiary: '#94948e',
          /** The quietest step that is still text. 5.3:1 on canvas, 4.6:1 on surface-2. */
          faint: '#85857f',
        },
        // Grape purple, sampled from the logo in docs/podo_lg.png — podo means
        // grape, and the accent is the one place that has to say so. The native
        // client (Muscat, as in Shine Muscat) is deliberately the green one; they
        // are sibling apps, not the same brand.
        accent: {
          /** Fills and borders. White on it is 4.9:1; as *text* it is only 4.0:1. */
          DEFAULT: '#8850E0',
          hover: '#7A42D4',
          /** The accent for text — the active title, the cover label. 6.4:1. */
          text: '#A87CEC',
          soft: '#C098F0',
          muted: '#8850E022',
        },
        // Status colours were missing from the token set, so every error and
        // success message in the app reached for a raw palette class instead.
        danger: '#E5484D',
        success: '#46A758',
        warning: '#F5A524',
      },
      fontSize: {
        // The list is the product, so its two lines get named sizes rather than
        // borrowing `text-sm`/`text-xs` and drifting apart per screen.
        title: ['0.9375rem', { lineHeight: '1.35', letterSpacing: '-0.006em' }],
        meta: ['0.8125rem', { lineHeight: '1.4' }],
        display: ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        glow: '0 0 28px -4px rgba(136, 80, 224, 0.55)',
        // Depth is layered shadow; a border is for structure. Both were being
        // done with borders, which is why panels read as outlines rather than as
        // sitting above the page.
        raised: '0 1px 2px rgba(0,0,0,0.4), 0 2px 6px -2px rgba(0,0,0,0.5)',
        overlay: '0 8px 16px -6px rgba(0,0,0,0.6), 0 24px 48px -12px rgba(0,0,0,0.7)',
      },
    },
  },
  plugins: [],
} satisfies Config
