import { useState } from 'react'
import { RefreshCw, ExternalLink, Check, AlertCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTrackSource, refreshTrackSource, getDownload } from '../api/library'
import type { DownloadJob } from '../api/library'

interface Props {
  trackId: string
  /** Called once a refresh lands, so the modal can bust its artwork cache. */
  onRefreshed?: () => void
}

const POLL_MS = 1500
const POLL_TIMEOUT_MS = 10 * 60 * 1000

/** Resolves when the job stops moving — done, failed, or gone from the job list. */
async function waitForJob(jobId: string): Promise<DownloadJob> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const job = await getDownload(jobId)
    if (job.status === 'done' || job.status === 'failed') return job
    if (Date.now() > deadline) throw new Error('Refresh is taking too long — check the server logs')
  }
}

/**
 * Where a track came from, and a way to pull it again.
 *
 * Re-fetching is how an upstream change reaches an already-imported track: a
 * re-uploaded mix, a restored video, subtitles added after the fact. Without it
 * the only route was deleting the track and downloading it again, which loses
 * the playlists, favorites and play counts attached to it.
 */
export default function TrackSourcePanel({ trackId, onRefreshed }: Props) {
  const queryClient = useQueryClient()
  const [finished, setFinished] = useState<DownloadJob | null>(null)

  const { data: source } = useQuery({
    queryKey: ['track-source', trackId],
    queryFn: () => getTrackSource(trackId),
    // A locally-scanned track has no remote source; that 404 is an answer, not a
    // fault worth retrying.
    retry: false,
    staleTime: 60_000,
  })

  const { mutate: refresh, isPending, error } = useMutation({
    mutationFn: async () => {
      setFinished(null)
      const job = await refreshTrackSource(trackId)
      return waitForJob(job.id)
    },
    onSuccess: (job) => {
      setFinished(job)
      if (job.status === 'done') {
        queryClient.invalidateQueries({ queryKey: ['tracks'] })
        queryClient.invalidateQueries({ queryKey: ['track-source', trackId] })
        onRefreshed?.()
      }
    },
  })

  if (!source) return null

  const failed = finished?.status === 'failed'

  return (
    <div className="pt-5 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-tertiary mb-0.5">
            Source{source.provider_label ? ` · ${source.provider_label}` : ''}
          </p>
          {source.source_url ? (
            <a
              href={source.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 text-xs text-accent-text hover:underline truncate"
              title={source.source_url}
            >
              <span className="truncate">{source.source_url}</span>
              <ExternalLink size={10} className="flex-shrink-0" />
            </a>
          ) : (
            <p className="text-xs text-ink-faint">Scanned from disk — no URL to re-fetch from.</p>
          )}
        </div>

        {source.refreshable && (
          <button
            type="button"
            onClick={() => refresh()}
            disabled={isPending}
            className="flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs text-ink-secondary hover:text-ink-primary transition-colors disabled:opacity-50"
            title="Download this track again from its original URL"
          >
            <RefreshCw size={12} className={isPending ? 'animate-spin' : ''} />
            {isPending ? 'Re-fetching…' : 'Re-fetch'}
          </button>
        )}
      </div>

      {source.refreshable && (
        <p className="text-xs text-ink-faint">
          Pulls the media, thumbnail and subtitles again, replacing this track's file in place.
          Playlists, favorites and play counts are kept.
        </p>
      )}

      {finished?.status === 'done' && (
        <p className="flex items-center gap-1 text-xs text-accent-text">
          <Check size={11} /> Re-fetched. Reopen the track to see the new artwork and lyrics.
        </p>
      )}

      {(failed || error) && (
        <p className="flex items-start gap-1 text-xs text-danger">
          <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
          <span>{finished?.error ?? (error as Error)?.message}</span>
        </p>
      )}
    </div>
  )
}
