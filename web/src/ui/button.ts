/**
 * The button recipes, in one place.
 *
 * Twenty-five distinct class strings were expressing four roles across 120
 * buttons, so a padding or a hover colour differed depending on which screen you
 * were on. Naming the roles is what stops that happening again; the values
 * themselves are unremarkable.
 */
// Every variant carries a border, transparent where the design has none: without
// it a filled button stands 2px shorter than a bordered one beside it, and a
// toolbar mixing the two never lines up.
const base =
  'press inline-flex items-center justify-center gap-2 rounded-lg font-medium border ' +
  'transition-[scale,background-color,border-color,color] duration-150 ' +
  'disabled:opacity-40 disabled:pointer-events-none'

export const btn = {
  /** The one action a screen is for. At most one per view. */
  primary: `${base} border-transparent bg-accent text-white shadow-raised hover:bg-accent-hover`,
  /** Everything else with a box around it. */
  secondary: `${base} bg-surface-2 border-border hover:bg-surface-3 hover:border-border-strong`,
  /** No box until you touch it — toolbars, rows, anywhere a border would add noise. */
  ghost: `${base} border-transparent text-ink-secondary hover:text-ink-primary hover:bg-white/[0.06]`,
  /** Destructive. Tinted rather than filled, so it doesn't compete with primary. */
  danger: `${base} bg-danger/10 text-danger border-danger/30 hover:bg-danger/20`,
} as const

export const btnSize = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  /** Square, for an icon on its own; clears the 24px minimum target. */
  icon: 'h-9 w-9 p-0',
} as const
