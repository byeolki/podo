import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Shuffle, Sparkles, X, ChevronDown, Trash2, CheckSquare, Square, Search, ListPlus } from 'lucide-react'
import { getTracks, aiAutofillTracks, deleteTracks } from '../api/tracks'
import type { SortOption, FilterOption } from '../api/tracks'
import { usePlayerStore } from '../store/player'
import TrackRow from '../components/TrackRow'
import AddToPlaylistModal from '../components/AddToPlaylistModal'

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  popular: 'Most Favorited',
  plays: 'Most Played',
}

const FILTER_LABELS: Record<FilterOption, string> = {
  all: 'All',
  mine: 'Mine',
  favorites: 'Favorites',
}

export default function Library() {
  const [sort, setSort] = useState<SortOption>('newest')
  const [filter, setFilter] = useState<FilterOption>('all')
  const [sortOpen, setSortOpen] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ['tracks', sort, filter],
    queryFn: () => getTracks({ sort, filter }),
  })

  const filteredTracks = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return tracks
    return tracks.filter((tr) => {
      const title = tr.title?.toLowerCase() ?? ''
      const parts = [
        tr.override?.artist,
        tr.override?.original_artist,
        tr.artists?.map((a) => a.name).join(' '),
      ].filter(Boolean).join(' ').toLowerCase()
      return title.includes(t) || parts.includes(t)
    })
  }, [tracks, q])

  const { setQueue, play } = usePlayerStore()
  const queryClient = useQueryClient()

  const { mutate: runAiFill, isPending: aiFilling } = useMutation({
    mutationFn: (ids: string[]) => aiAutofillTracks(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tracks'] }),
  })

  const { mutate: runDelete, isPending: deleting } = useMutation({
    mutationFn: (ids: string[]) => deleteTracks(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      setSelectedIds(new Set())
      setSelectionMode(false)
    },
  })

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const selectAll = () => setSelectedIds(new Set(tracks.map((t) => t.id)))
  const deselectAll = () => setSelectedIds(new Set())

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const allSelected = filteredTracks.length > 0 && selectedIds.size === filteredTracks.length
  const hasSelection = selectedIds.size > 0
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false)

  return (
    <div className="p-4 sm:p-6">
      {playlistModalOpen && (
        <AddToPlaylistModal
          trackIds={[...selectedIds]}
          onClose={() => setPlaylistModalOpen(false)}
        />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Library</h1>
          <p className="text-sm text-[#a1a1a1] mt-0.5">{filteredTracks.length}{q ? ` / ${tracks.length}` : ''} tracks</p>
        </div>

        {!selectionMode && tracks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectionMode(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium transition-colors"
            >
              <CheckSquare size={14} /> Select
            </button>
            <button
              onClick={() => { setQueue(filteredTracks, 0); play() }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
            >
              <Play size={14} fill="currentColor" /> Play all
            </button>
            <button
              onClick={() => { const s = [...filteredTracks].sort(() => Math.random() - 0.5); setQueue(s, 0); play() }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium transition-colors"
            >
              <Shuffle size={14} /> Shuffle
            </button>
          </div>
        )}

        {selectionMode && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={allSelected ? deselectAll : () => setSelectedIds(new Set(filteredTracks.map((t) => t.id)))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm transition-colors"
            >
              {allSelected ? <Square size={14} /> : <CheckSquare size={14} />}
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>

            <span className="text-sm text-[#555]">{hasSelection ? `${selectedIds.size} selected` : 'None'}</span>

            {hasSelection && (
              <>
                <button
                  onClick={() => setPlaylistModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium transition-colors"
                >
                  <ListPlus size={14} /> Add to playlist
                </button>
                <button
                  onClick={() => runAiFill([...selectedIds])}
                  disabled={aiFilling}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Sparkles size={14} />
                  {aiFilling ? 'Filling…' : 'AI Fill'}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete ${selectedIds.size} track(s) from library?`)) {
                      runDelete([...selectedIds])
                    }
                  }}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            )}

            <button
              onClick={exitSelection}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm transition-colors"
            >
              <X size={14} /> Cancel
            </button>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tracks..."
          className="w-full bg-[#181818] border border-[#2a2a2a] rounded-lg pl-8 pr-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
        />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Filter + Sort bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 bg-[#1a1a1a] rounded-lg p-0.5">
          {(Object.keys(FILTER_LABELS) as FilterOption[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setSelectedIds(new Set()) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f ? 'bg-[#2a2a2a] text-white' : 'text-[#777] hover:text-white'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <div className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#222] text-xs text-[#a1a1a1] hover:text-white transition-colors"
          >
            {SORT_LABELS[sort]}
            <ChevronDown size={12} />
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-[#1e1e1e] border border-[#2a2a2a] rounded-lg overflow-hidden shadow-xl z-20">
              {(Object.keys(SORT_LABELS) as SortOption[]).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSort(s); setSortOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                    sort === s ? 'text-accent bg-accent/10' : 'text-[#a1a1a1] hover:text-white hover:bg-white/5'
                  }`}
                >
                  {SORT_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-[#181818] animate-pulse" />
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <p className="text-lg font-medium">No tracks</p>
          <p className="text-sm mt-1">
            {filter === 'favorites' ? "You haven't favorited any tracks yet" : filter === 'mine' ? 'No tracks added by you' : 'Add a library root in Admin to get started'}
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {filteredTracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              index={i}
              queue={filteredTracks}
              showNumber
              selected={selectedIds.has(track.id)}
              onSelect={toggleSelect}
              selectionActive={selectionMode}
            />
          ))}
        </div>
      )}
    </div>
  )
}
