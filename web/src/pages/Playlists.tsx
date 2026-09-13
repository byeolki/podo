import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListMusic, Plus, Trash2, Globe, Lock } from 'lucide-react'
import { getPlaylists, getPublicPlaylists, createPlaylist, deletePlaylist } from '../api/playlists'
import { getArtworkUrl } from '../api/client'
import ArtworkImage from '../components/ArtworkImage'
import SearchInput from '../components/SearchInput'
import SortMenu from '../components/SortMenu'
import { useAuthStore } from '../store/auth'
import { btn, btnSize } from '../ui/button'
import EmptyState from '../ui/EmptyState'

type PlaylistFilter = 'mine' | 'all'
type PlaylistSort = 'az' | 'za' | 'newest'

const FILTER_LABELS: Record<PlaylistFilter, string> = {
  mine: 'Mine',
  all: 'All public',
}

const SORT_LABELS: Record<PlaylistSort, string> = {
  az: 'A → Z',
  za: 'Z → A',
  newest: 'Newest',
}

export default function Playlists() {
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.userId)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<PlaylistFilter>('mine')
  const [sort, setSort] = useState<PlaylistSort>('az')

  const { data: myPlaylists = [] } = useQuery({
    queryKey: ['playlists', 'mine'],
    queryFn: getPlaylists,
  })

  const { data: publicPlaylists = [] } = useQuery({
    queryKey: ['playlists', 'public'],
    queryFn: getPublicPlaylists,
    enabled: filter === 'all',
  })

  const createMut = useMutation({
    mutationFn: () => createPlaylist({ name: newName, is_public: isPublic }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
      setNewName('')
      setShowCreate(false)
    },
  })

  const deleteMut = useMutation({
    mutationFn: deletePlaylist,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  })

  const source = filter === 'mine' ? myPlaylists : publicPlaylists

  const visible = useMemo(() => {
    let list = source
    const t = q.trim().toLowerCase()
    if (t) list = list.filter((p) => p.name.toLowerCase().includes(t))

    return [...list].sort((a, b) => {
      if (sort === 'za') return b.name.localeCompare(a.name)
      if (sort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return a.name.localeCompare(b.name)
    })
  }, [source, q, sort])

  return (
    <div className="p-4 sm:p-6 lg:px-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-display font-semibold">Playlists</h1>
          <p className="text-sm text-ink-secondary mt-0.5">{visible.length}{q ? ` / ${source.length}` : ''} playlists</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className={`${btn.primary} ${btnSize.md}`}
        >
          <Plus size={14} /> New playlist
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 p-4 rounded-xl bg-surface-2 border border-border-strong">
          <h3 className="text-sm font-semibold mb-3">New Playlist</h3>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Playlist name"
              className="flex-1 bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-sm focus:border-accent"
              onKeyDown={(e) => e.key === 'Enter' && newName && createMut.mutate()}
            />
            <button
              onClick={() => createMut.mutate()}
              disabled={!newName || createMut.isPending}
              className={`${btn.primary} ${btnSize.md}`}
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className={`${btn.secondary} ${btnSize.md}`}
            >
              Cancel
            </button>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm text-ink-secondary cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-accent" />
            Make public
          </label>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search playlists..." className="flex-1 sm:max-w-sm" />
        <div className="flex items-center gap-2 sm:ml-auto">
        <div className="flex items-center gap-1 bg-surface-2 border border-border rounded-lg p-0.5">
          {(Object.keys(FILTER_LABELS) as PlaylistFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f ? 'bg-surface-3 text-ink-primary shadow-raised' : 'text-ink-tertiary hover:text-ink-primary'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <SortMenu value={sort} options={SORT_LABELS} onChange={setSort} menuWidthClass="w-32" />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ListMusic}
          title="No playlists"
          hint={filter === 'mine' ? 'Create one to get started' : 'No public playlists found'}
        />
      ) : (
        <div className="space-y-1">
          {visible.map((pl) => {
            const isOwner = pl.owner_user_id === userId
            return (
              <div key={pl.id} className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.06] focus-within:bg-white/[0.06] transition-colors duration-150">
                {pl.artwork_path ? (
                  <ArtworkImage
                    src={getArtworkUrl(pl.id)}
                    alt={pl.name}
                    className="w-12 h-12 rounded-md object-cover flex-shrink-0 bg-surface-2"
                  />
                ) : (
                  <div className="artwork-edge w-12 h-12 rounded-md bg-surface-2 flex items-center justify-center flex-shrink-0">
                    <ListMusic size={18} className="text-ink-faint" aria-hidden="true" />
                  </div>
                )}
                <Link to={`/playlists/${pl.id}`} className="flex-1 min-w-0">
                  <p className="text-title font-medium truncate group-hover:text-accent-text transition-colors">{pl.name}</p>
                  <p className="text-meta text-ink-tertiary flex items-center gap-1 mt-0.5">
                    {pl.is_public ? <Globe size={10} /> : <Lock size={10} />}
                    {pl.is_public ? 'Public' : 'Private'}
                    {filter === 'all' && !isOwner && <span className="ml-1 opacity-60">· by others</span>}
                  </p>
                </Link>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => deleteMut.mutate(pl.id)}
                    aria-label={`Delete ${pl.name}`}
                    className="p-1.5 text-ink-tertiary hover:text-danger transition-[opacity,color,background-color,border-color,scale] opacity-0 pointer-events-none
                               group-hover:opacity-100 group-hover:pointer-events-auto
                               group-focus-within:opacity-100 group-focus-within:pointer-events-auto
                               [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
