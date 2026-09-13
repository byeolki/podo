/**
 * The text-field recipe.
 *
 * Seventeen variants were expressing one control, disagreeing about the surface
 * (canvas, surface-1, surface-2), the border and the padding — so whether a field
 * read as recessed depended on which card it happened to sit in.
 *
 * It is always the darkest surface: a field should look cut into whatever holds
 * it, and `canvas` is the one value that reads that way on every card the app
 * has. 16px below the small breakpoint is handled globally in `index.css`, since
 * iOS zooms the page for anything smaller.
 */
export const field =
  'rounded-lg border border-border-strong bg-canvas px-3 py-2 text-sm ' +
  'text-ink-primary placeholder:text-ink-faint transition-colors focus:border-accent'

/** For a field that is showing a value nobody can change. */
export const fieldReadOnly =
  'rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-ink-tertiary cursor-not-allowed'

/**
 * A settings tab: each direct child becomes a card.
 *
 * The sections were bare divs on the canvas, so a page of six unrelated forms
 * read as one long column with headings in it — nothing said where "Profile"
 * ended and "Change password" began except the gap. Applied to the tab rather
 * than to each section so the grouping cannot drift as sections are added.
 */
export const settingsSections =
  'space-y-4 [&>div]:rounded-xl [&>div]:border [&>div]:border-border ' +
  '[&>div]:bg-surface-1 [&>div]:p-5'
