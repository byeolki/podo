import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { resolveImported } from '../api/upload'
import { getTracksByIds } from '../api/tracks'
import TrackRow from './TrackRow'
import AiFillButton from './AiFillButton'
import { btn, btnSize } from '../ui/button'

/**
 * The tracks from the upload that just finished, on the page that finished it.
 *
 * Uploading and naming are one task and were two screens: files went in, and the
 * only way back to them was the library, sorted by date, alongside everything
 * else. Everything in a batch tends to need the same correction — these are
 * covers by the same person, or an album's worth of one artist — so having them
 * together is most of the work.
 *
 * Filled by polling, because upload returns paths and the scanner turns those
 * into tracks in the background; rows appear as the import reaches them.
 */
export default function JustUploaded({ paths, onDismiss }: { paths: string[]; onDismiss: () => void }) {
  const [settled, setSettled] = useState(false)

  const { data: resolved } = useQuery({
    queryKey: ['imported', paths],
    queryFn: () => resolveImported(paths),
    enabled: paths.length > 0 && !settled,
    // Stops once every uploaded file has a track, or after the window below.
    refetchInterval: 1500,
  })

  const trackIds = resolved?.track_ids ?? []

  useEffect(() => {
    if (!paths.length) return
    if (trackIds.length >= paths.length) { setSettled(true); return }
    // A file the scanner rejects never arrives, so the poll needs an end of its
    // own rather than waiting on a count that will never be reached.
    const stop = setTimeout(() => setSettled(true), 90_000)
    return () => clearTimeout(stop)
  }, [paths.length, trackIds.length])

  const { data: tracks = [] } = useQuery({
    queryKey: ['tracks', 'imported', trackIds],
    queryFn: () => getTracksByIds(trackIds),
    enabled: trackIds.length > 0,
  })

  if (!paths.length) return null

  const pending = paths.length - trackIds.length

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-semibold">Just uploaded</h2>
          <p className="text-meta text-ink-tertiary mt-0.5" role="status">
            {pending > 0
              ? `${trackIds.length} of ${paths.length} imported — the rest are still being scanned`
              : `${trackIds.length} ${trackIds.length === 1 ? 'track' : 'tracks'} ready to edit`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {trackIds.length > 0 && (
            <AiFillButton
              trackIds={trackIds}
              className={`${btn.secondary} ${btnSize.sm}`}
              iconSize={12}
            />
          )}
          <button type="button" onClick={onDismiss} className={`${btn.ghost} ${btnSize.sm}`}>
            Dismiss
          </button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-6 text-center">
          <Sparkles size={20} className="mx-auto mb-2 text-ink-faint" aria-hidden="true" />
          <p className="text-sm text-ink-tertiary">Waiting for the scanner to pick these up…</p>
        </div>
      ) : (
        <div className="-mx-3 space-y-0.5">
          {tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} queue={tracks} showArtist />
          ))}
        </div>
      )}

      {pending > 0 && tracks.length > 0 && (
        <p className="text-meta text-ink-faint mt-2 px-3">
          {pending} still importing…
        </p>
      )}
    </section>
  )
}
