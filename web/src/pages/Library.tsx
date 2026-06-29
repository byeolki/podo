import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Shuffle, Sparkles, X } from 'lucide-react'
import { getTracks, aiAutofillTracks } from '../api/tracks'
import { usePlayerStore } from '../store/player'
import TrackRow from '../components/TrackRow'

export default function Library() {
  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ['tracks'],
    queryFn: getTracks,
  })

  const { setQueue, play } = usePlayerStore()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  const { mutate: runAiFill, isPending: aiFilling } = useMutation({
    mutationFn: (ids: string[]) => aiAutofillTracks(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      setSelectedIds(new Set())
    },
  })

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const clearSelection = () => setSelectedIds(new Set())

  function playAll() {
    setQueue(tracks, 0)
    play()
  }

  function shuffle() {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5)
    setQueue(shuffled, 0)
    play()
  }

  const hasSelection = selectedIds.size > 0

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Library</h1>
          <p className="text-sm text-[#a1a1a1] mt-0.5">{tracks.length} tracks</p>
        </div>
        {tracks.length > 0 && !hasSelection && (
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
        {hasSelection && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#a1a1a1]">{selectedIds.size} selected</span>
            <button
              onClick={() => runAiFill([...selectedIds])}
              disabled={aiFilling}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Sparkles size={14} />
              {aiFilling ? 'Filling…' : 'AI Fill'}
            </button>
            <button
              onClick={clearSelection}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm transition-colors"
            >
              <X size={14} /> Cancel
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
            <TrackRow
              key={track.id}
              track={track}
              index={i}
              queue={tracks}
              showNumber
              selected={selectedIds.has(track.id)}
              onSelect={toggleSelect}
              selectionActive={hasSelection}
            />
          ))}
        </div>
      )}
    </div>
  )
}
