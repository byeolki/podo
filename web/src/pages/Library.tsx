import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Shuffle } from 'lucide-react'
import { getTracks } from '../api/tracks'
import { usePlayerStore } from '../store/player'
import TrackRow from '../components/TrackRow'

export default function Library() {
  const [limit, setLimit] = useState(100)
  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ['tracks', limit],
    queryFn: () => getTracks(limit),
  })

  const { setQueue, play } = usePlayerStore()

  function playAll() {
    setQueue(tracks, 0)
    play()
  }

  function shuffle() {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5)
    setQueue(shuffled, 0)
    play()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Library</h1>
          <p className="text-sm text-[#a1a1a1] mt-0.5">{tracks.length} tracks</p>
        </div>
        {tracks.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={playAll}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
            >
              <Play size={14} fill="currentColor" /> Play all
            </button>
            <button
              onClick={shuffle}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium transition-colors"
            >
              <Shuffle size={14} /> Shuffle
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-[#181818] animate-pulse" />
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <p className="text-lg font-medium">No tracks yet</p>
          <p className="text-sm mt-1">Add a library root in Admin to get started</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} queue={tracks} showNumber />
          ))}
        </div>
      )}

      {tracks.length >= limit && (
        <div className="text-center mt-6">
          <button
            onClick={() => setLimit((l) => l + 100)}
            className="px-4 py-2 text-sm text-[#a1a1a1] hover:text-white border border-[#333] rounded-lg transition-colors"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
