import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Link2, Unlink, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  getSubscription, setSubscription, removeSubscription, syncSubscriptionNow,
} from '../api/playlists'

interface Props {
  playlistId: string
  onClose: () => void
}

const INTERVALS = [
  { minutes: 60, label: 'Every hour' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 720, label: 'Every 12 hours' },
  { minutes: 1440, label: 'Once a day' },
  { minutes: 10080, label: 'Once a week' },
]

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function PlaylistSyncPanel({ playlistId, onClose }: Props) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [interval, setIntervalMinutes] = useState(360)
  const [audioOnly, setAudioOnly] = useState(true)

  const { data: subscription, isLoading } = useQuery({
    queryKey: ['playlist-subscription', playlistId],
    queryFn: () => getSubscription(playlistId),
  })

  useEffect(() => {
    if (!subscription) return
    setUrl(subscription.source_url)
    setIntervalMinutes(subscription.interval_minutes)
    setAudioOnly(subscription.audio_only)
  }, [subscription])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['playlist-subscription', playlistId] })
    qc.invalidateQueries({ queryKey: ['playlist', playlistId] })
  }

  const saveMut = useMutation({
    mutationFn: () => setSubscription(playlistId, {
      source_url: url.trim(),
      interval_minutes: interval,
      audio_only: audioOnly,
    }),
    onSuccess: invalidate,
  })

  const syncMut = useMutation({
    mutationFn: () => syncSubscriptionNow(playlistId),
    onSuccess: invalidate,
  })

  const unlinkMut = useMutation({
    mutationFn: () => removeSubscription(playlistId),
    onSuccess: () => { invalidate(); setUrl('') },
  })

  const error = (saveMut.error ?? syncMut.error ?? unlinkMut.error) as Error | undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-surface-2 border border-border rounded-xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Link2 size={15} className="text-accent" /> Auto-sync
          </span>
          <p className="text-xs text-ink-tertiary mt-1">
            Keep this playlist in step with a playlist on YouTube, SoundCloud,
            Bandcamp — anything yt-dlp can read. New items are downloaded and
            appended; nothing here is ever deleted.
          </p>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label htmlFor="playlistSyncPanel-playlist-url" className="block text-xs text-ink-tertiary mb-1.5">Playlist URL</label>
            <input
              id="playlistSyncPanel-playlist-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=..."
              className="w-full bg-surface-1 border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="playlistSyncPanel-check-for-new-items" className="block text-xs text-ink-tertiary mb-1.5">Check for new items</label>
            <select
              id="playlistSyncPanel-check-for-new-items"
              value={interval}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="w-full bg-surface-1 border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              {INTERVALS.map((option) => (
                <option key={option.minutes} value={option.minutes}>{option.label}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(e) => setAudioOnly(e.target.checked)}
              className="accent-accent"
            />
            Audio only
          </label>

          {isLoading ? (
            <div className="h-12 rounded-lg bg-surface-1 animate-pulse" />
          ) : subscription ? (
            <div className="p-3 rounded-lg bg-surface-1 border border-border text-xs space-y-1">
              <div className="flex items-center gap-1.5">
                {subscription.last_status === 'failed' ? (
                  <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
                ) : (
                  <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />
                )}
                <span className="text-ink-secondary">
                  {subscription.last_status === 'running'
                    ? 'Syncing now…'
                    : subscription.last_synced_at
                      ? `Last synced ${relativeTime(subscription.last_synced_at)}`
                      : 'Not synced yet'}
                </span>
              </div>
              <p className="text-ink-faint">{subscription.added_count} tracks added so far</p>
              {subscription.last_error && (
                <p className="text-red-400 break-words">{subscription.last_error}</p>
              )}
            </div>
          ) : null}

          {syncMut.data && (
            <p className="text-xs text-green-400">
              +{syncMut.data.added} added · {syncMut.data.skipped} already here
              {syncMut.data.failed > 0 ? ` · ${syncMut.data.failed} failed` : ''}
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error.message}</p>}
        </div>

        <div className="border-t border-border px-4 py-3 flex gap-2">
          <button
            onClick={() => saveMut.mutate()}
            disabled={!url.trim() || saveMut.isPending}
            className="flex-1 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {saveMut.isPending ? 'Saving…' : subscription ? 'Update' : 'Link playlist'}
          </button>
          {subscription && (
            <>
              <button
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
                title="Sync now"
                className="px-3 py-2 rounded-lg bg-surface-1 hover:bg-surface-3 text-ink-secondary hover:text-white disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={14} className={syncMut.isPending ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => unlinkMut.mutate()}
                disabled={unlinkMut.isPending}
                title="Stop syncing"
                className="px-3 py-2 rounded-lg bg-surface-1 hover:bg-surface-3 text-ink-secondary hover:text-red-400 disabled:opacity-50 transition-colors"
              >
                <Unlink size={14} />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-surface-1 hover:bg-surface-3 text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
