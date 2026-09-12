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

export default function AiFillButton({ trackIds, onResult, className, iconSize = 14 }: Props) {
  const qc = useQueryClient()
  const { available, reason } = useAiStatus()
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const total = trackIds.length
  const running = done !== null

  async function run() {
    if (!available || running || !total) return
    setError(null)
    setDone(0)
    try {
      for (let i = 0; i < total; i += BATCH) {
        const batch = trackIds.slice(i, i + BATCH)
        const results = await aiAutofillTracks(batch)
        if (onResult && results[0]?.result) onResult(results[0].result)
        setDone(Math.min(i + batch.length, total))
      }
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
        onClick={run}
        disabled={!available || running || !total}
        title={reason ?? 'Guess title, artist and cover details from the filename'}
        className={className ?? 'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'}
      >
        <Sparkles size={iconSize} />
        {running ? (total > 1 ? `Filling ${done} / ${total}` : 'Filling…') : 'AI Fill'}
      </button>

      {running && total > 1 && (
        <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${Math.round(((done ?? 0) / total) * 100)}%` }}
          />
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
