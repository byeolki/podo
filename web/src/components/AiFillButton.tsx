import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { aiAutofillTracks } from '../api/tracks'
import { useAiStatus } from '../hooks/useAiStatus'

interface Props {
  trackIds: string[]
  /** Applied to the form the editor is holding, for the single-track case. */
  onResult?: (result: Record<string, unknown>) => void
  className?: string
  iconSize?: number
}

/**
 * Fills track metadata from filenames.
 *
 * Sent in small batches rather than one request, because the server fills them
 * one at a time and a selection of forty otherwise looks frozen for a minute
 * with nothing to show for it. Each batch that lands moves the bar.
 */
const BATCH = 3

interface Outcome {
  filled: number
  skipped: number
  failed: number
}

export default function AiFillButton({ trackIds, onResult, className, iconSize = 14 }: Props) {
  const qc = useQueryClient()
  const { available, reason } = useAiStatus()
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const total = trackIds.length
  const running = done !== null
  // Everything the server considered already complete. Offering a forced re-run
  // is the whole point: the button previously reported nothing in this case, so
  // a press that skipped every track was indistinguishable from a broken button.
  const canForce = !!outcome && outcome.skipped > 0

  async function run(force: boolean) {
    if (!available || running || !total) return
    setError(null)
    setOutcome(null)
    setDone(0)
    const tally: Outcome = { filled: 0, skipped: 0, failed: 0 }
    try {
      for (let i = 0; i < total; i += BATCH) {
        const batch = trackIds.slice(i, i + BATCH)
        const results = await aiAutofillTracks(batch, force)
        for (const r of results) {
          if (r.applied) tally.filled++
          else if (r.skipped) tally.skipped++
          else tally.failed++
        }
        if (onResult && results[0]?.result) onResult(results[0].result)
        setDone(Math.min(i + batch.length, total))
      }
      setOutcome(tally)
      qc.invalidateQueries({ queryKey: ['tracks'] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDone(null)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => run(canForce)}
        disabled={!available || running || !total}
        title={reason ?? 'Guess title, artist and cover details from the filename'}
        className={className ?? 'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'}
      >
        <Sparkles size={iconSize} aria-hidden="true" />
        {running
          ? (total > 1 ? `Filling ${done} / ${total}` : 'Filling…')
          : canForce ? 'Fill again' : 'AI Fill'}
      </button>

      {running && total > 1 && (
        <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
          <div
            className="h-full bg-accent transition-[opacity,color,background-color,border-color,scale] duration-300"
            style={{ width: `${Math.round(((done ?? 0) / total) * 100)}%` }}
          />
        </div>
      )}
      {outcome && !running && (
        <p role="status" className="text-xs text-ink-tertiary">
          {summarize(outcome)}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function summarize({ filled, skipped, failed }: Outcome): string {
  const parts: string[] = []
  if (filled) parts.push(`${filled} filled`)
  if (skipped) parts.push(`${skipped} already complete`)
  if (failed) parts.push(`${failed} with nothing to go on`)
  if (!parts.length) return 'Nothing to fill'
  const tail = skipped ? ' — press again to redo them' : ''
  return parts.join(' · ') + tail
}
