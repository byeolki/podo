import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Radio as RadioIcon, Play, ListMusic } from 'lucide-react'
import { getStation } from '../api/radio'
import { createPlaylist, addTracksToPlaylist } from '../api/playlists'
import { usePlayerStore } from '../store/player'
import type { Track } from '../api/tracks'
import TrackRow from '../components/TrackRow'
import MyRadioUrls from '../components/MyRadioUrls'

export default function Radio() {
  const qc = useQueryClient()
  const [tracks, setTracks] = useState<Track[]>([])
  const [seedArtist, setSeedArtist] = useState('')
  const [mixName, setMixName] = useState('')
  const { setQueue, play } = usePlayerStore()

  const stationMut = useMutation({
    mutationFn: () =>
      getStation({ count: 50, seed_artist_name: seedArtist.trim() || undefined }),
    onSuccess: (data) => setTracks(data),
  })

  // Saved from the station that's actually on screen, not by re-running the seed:
  // `POST /radio/mix` would generate a fresh (randomised) selection, so the saved
  // playlist wouldn't match what the user just listened to.
  const mixMut = useMutation({
    mutationFn: async () => {
      const playlist = await createPlaylist({
        name: mixName.trim() || `Mix · ${new Date().toLocaleDateString()}`,
        description: seedArtist.trim() ? `Radio station seeded from ${seedArtist.trim()}` : 'Auto-generated mix',
      })
      await addTracksToPlaylist(playlist.id, tracks.map((t) => t.id))
      return playlist
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
      setMixName('')
    },
  })

  function playStation() {
    if (tracks.length) {
      setQueue(tracks, 0)
      play()
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:px-8">
      <h1 className="text-2xl font-semibold mb-6">Radio</h1>

      {/* Two unrelated things were both called "Radio": a station generated on
          the fly, and the permanent stream URLs minted per playlist. Only the
          first was on this page, so the second was reachable only from the admin
          tab in Settings. */}
      <MyRadioUrls />

      <div className="mb-4">
        <h2 className="text-base font-semibold">Station</h2>
        <p className="text-xs text-ink-tertiary mt-0.5">A shuffled selection from your library, seeded by an artist.</p>
      </div>

      <div className="flex gap-3 mb-8 flex-wrap">
        <input
          type="text"
          value={seedArtist}
          onChange={(e) => setSeedArtist(e.target.value)}
          placeholder="Artist name (blank = whole library)"
          className="bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-sm focus:border-accent w-60"
          onKeyDown={(e) => e.key === 'Enter' && stationMut.mutate()}
        />
        <button
          onClick={() => stationMut.mutate()}
          disabled={stationMut.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <RadioIcon size={14} /> Generate Station
        </button>

        {tracks.length > 0 && (
          <>
            <button
              onClick={playStation}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm font-medium transition-colors"
            >
              <Play size={14} fill="currentColor" /> Play
            </button>
            <div className="flex gap-2">
              <input
                type="text"
                value={mixName}
                onChange={(e) => setMixName(e.target.value)}
                placeholder="Mix name (optional)"
                className="bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-sm focus:border-accent w-48"
              />
              <button
                onClick={() => mixMut.mutate()}
                disabled={mixMut.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm font-medium disabled:opacity-50 transition-colors"
              >
                <ListMusic size={14} /> Save as Playlist
              </button>
            </div>
          </>
        )}
      </div>

      {stationMut.isPending && (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      )}

      {mixMut.isError && (
        <p className="text-sm text-danger mb-4">{(mixMut.error as Error).message}</p>
      )}

      {tracks.length > 0 && (
        <div>
          <p className="text-sm text-ink-secondary mb-3">{tracks.length} tracks</p>
          <div className="space-y-0.5">
            {tracks.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} queue={tracks} showNumber showArtist />
            ))}
          </div>
        </div>
      )}

      {!stationMut.isPending && tracks.length === 0 && (
        <div className="text-center py-20 text-ink-tertiary">
          <RadioIcon size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No station yet</p>
          <p className="text-sm mt-1">Click "Generate Station" to start</p>
        </div>
      )}
    </div>
  )
}
