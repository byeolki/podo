import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Radio as RadioIcon, Play, ListMusic } from 'lucide-react'
import { getStation, createMix } from '../api/radio'
import { usePlayerStore } from '../store/player'
import type { Track } from '../api/tracks'
import TrackRow from '../components/TrackRow'

export default function Radio() {
  const qc = useQueryClient()
  const [tracks, setTracks] = useState<Track[]>([])
  const [mixName, setMixName] = useState('')
  const { setQueue, play } = usePlayerStore()

  const stationMut = useMutation({
    mutationFn: () => getStation({ count: 50 }),
    onSuccess: (data) => setTracks(data),
  })

  const mixMut = useMutation({
    mutationFn: () => createMix({ name: mixName || undefined, count: tracks.length || 50 }),
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
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Radio</h1>
        <p className="text-sm text-[#a1a1a1] mt-0.5">Auto-generated station based on your library</p>
      </div>

      <div className="flex gap-3 mb-8 flex-wrap">
        <button
          onClick={() => stationMut.mutate()}
          disabled={stationMut.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <RadioIcon size={14} /> Generate Station
        </button>

        {tracks.length > 0 && (
          <>
            <button
              onClick={playStation}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium transition-colors"
            >
              <Play size={14} fill="currentColor" /> Play
            </button>
            <div className="flex gap-2">
              <input
                type="text"
                value={mixName}
                onChange={(e) => setMixName(e.target.value)}
                placeholder="Mix name (optional)"
                className="bg-[#181818] border border-[#333] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent w-48"
              />
              <button
                onClick={() => mixMut.mutate()}
                disabled={mixMut.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium disabled:opacity-50 transition-colors"
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
            <div key={i} className="h-12 rounded-lg bg-[#181818] animate-pulse" />
          ))}
        </div>
      )}

      {tracks.length > 0 && (
        <div>
          <p className="text-sm text-[#a1a1a1] mb-3">{tracks.length} tracks</p>
          <div className="space-y-0.5">
            {tracks.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} queue={tracks} showNumber showArtist />
            ))}
          </div>
        </div>
      )}

      {!stationMut.isPending && tracks.length === 0 && (
        <div className="text-center py-20 text-[#6b6b6b]">
          <RadioIcon size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No station yet</p>
          <p className="text-sm mt-1">Click "Generate Station" to start</p>
        </div>
      )}
    </div>
  )
}
