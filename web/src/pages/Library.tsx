import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Shuffle, X, Trash2, CheckSquare, Square, ListPlus, Music } from 'lucide-react'
import { getTracks, deleteTracks } from '../api/tracks'
import type { SortOption, FilterOption } from '../api/tracks'
import { usePlayerStore } from '../store/player'
import TrackRow, { TrackListHeader } from '../components/TrackRow'
import AiFillButton from '../components/AiFillButton'
import AddToPlaylistModal from '../components/AddToPlaylistModal'
import SearchInput from '../components/SearchInput'
import SortMenu from '../components/SortMenu'
import { btn, btnSize } from '../ui/button'
import EmptyState from '../ui/EmptyState'

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
        tr.override?.alternate_titles,
        tr.artists?.map((a) => a.name).join(' '),
      ].filter(Boolean).join(' ').toLowerCase()
      return title.includes(t) || parts.includes(t)
    })
  }, [tracks, q])

  const { setQueue, play } = usePlayerStore()
  const queryClient = useQueryClient()

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

  // Selection acts on what's visible, so both of these follow the search filter.
  const selectAllVisible = () => setSelectedIds(new Set(filteredTracks.map((t) => t.id)))
  const deselectAll = () => setSelectedIds(new Set())

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const allSelected = filteredTracks.length > 0 && selectedIds.size === filteredTracks.length
  const hasSelection = selectedIds.size > 0
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false)

  return (
    <div className="p-4 sm:p-6 lg:px-8">
      {playlistModalOpen && (
        <AddToPlaylistModal
          trackIds={[...selectedIds]}
          onClose={() => setPlaylistModalOpen(false)}
        />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-display font-semibold">Library</h1>
          <p className="text-meta text-ink-tertiary mt-1">{filteredTracks.length}{q ? ` / ${tracks.length}` : ''} tracks</p>
        </div>

        {!selectionMode && tracks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectionMode(true)}
              className={`${btn.secondary} ${btnSize.md}`}
            >
              <CheckSquare size={14} /> Select
            </button>
            <button
              onClick={() => { setQueue(filteredTracks, 0); play() }}
              className={`${btn.primary} ${btnSize.md}`}
            >
              <Play size={14} fill="currentColor" /> Play all
            </button>
            <button
              onClick={() => { const s = [...filteredTracks].sort(() => Math.random() - 0.5); setQueue(s, 0); play() }}
              className={`${btn.secondary} ${btnSize.md}`}
            >
              <Shuffle size={14} /> Shuffle
            </button>
          </div>
        )}

        {selectionMode && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={allSelected ? deselectAll : selectAllVisible}
              className={`${btn.secondary} ${btnSize.md}`}
            >
              {allSelected ? <Square size={14} /> : <CheckSquare size={14} />}
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>

            <span className="text-sm text-ink-tertiary">{hasSelection ? `${selectedIds.size} selected` : 'None'}</span>

            {hasSelection && (
              <>
                <button
                  onClick={() => setPlaylistModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm font-medium transition-colors"
                >
                  <ListPlus size={14} /> Add to playlist
                </button>
                <AiFillButton trackIds={[...selectedIds]} />
                <button
                  onClick={() => {
                    if (confirm(`Delete ${selectedIds.size} track(s) from library?`)) {
                      runDelete([...selectedIds])
                    }
                  }}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-danger text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            )}

            <button
              onClick={exitSelection}
              className={`${btn.secondary} ${btnSize.md}`}
            >
              <X size={14} /> Cancel
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search tracks..." className="flex-1 sm:max-w-sm" />
        <div className="flex items-center gap-2 sm:ml-auto">
        <div className="flex items-center gap-1 bg-surface-2 border border-border rounded-lg p-0.5">
          {(Object.keys(FILTER_LABELS) as FilterOption[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setSelectedIds(new Set()) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f ? 'bg-surface-3 text-ink-primary shadow-raised' : 'text-ink-tertiary hover:text-ink-primary'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <SortMenu value={sort} options={SORT_LABELS} onChange={setSort} menuWidthClass="w-40" />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={Music}
          title="No tracks"
          hint={filter === 'favorites' ? "You haven't favorited any tracks yet" : filter === 'mine' ? 'No tracks added by you' : 'Add a library root in Settings to get started'}
        />
      ) : (
        <div className="-mx-3">
          <TrackListHeader />
          <div className="mt-1 space-y-0.5">
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
              showAdded
            />
          ))}
          </div>
        </div>
      )}
    </div>
  )
}
