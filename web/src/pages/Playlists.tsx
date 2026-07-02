import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListMusic, Plus, Trash2, Globe, Lock, Search, X, ChevronDown } from 'lucide-react'
import { getPlaylists, getPublicPlaylists, createPlaylist, deletePlaylist } from '../api/playlists'
import { useAuthStore } from '../store/auth'

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
  const [sortOpen, setSortOpen] = useState(false)

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
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Playlists</h1>
          <p className="text-sm text-[#a1a1a1] mt-0.5">{visible.length}{q ? ` / ${source.length}` : ''} playlists</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
        >
          <Plus size={14} /> New playlist
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 p-4 rounded-xl bg-[#181818] border border-[#333]">
          <h3 className="text-sm font-semibold mb-3">New Playlist</h3>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Playlist name"
              className="flex-1 bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              onKeyDown={(e) => e.key === 'Enter' && newName && createMut.mutate()}
            />
            <button
              onClick={() => createMut.mutate()}
              disabled={!newName || createMut.isPending}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm"
            >
              Cancel
            </button>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm text-[#a1a1a1] cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-accent" />
            Make public
          </label>
        </div>
      )}

      {/* Search bar */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search playlists..."
          className="w-full bg-[#181818] border border-[#2a2a2a] rounded-lg pl-8 pr-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
        />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Filter + Sort bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 bg-[#1a1a1a] rounded-lg p-0.5">
          {(Object.keys(FILTER_LABELS) as PlaylistFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
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
            <div className="absolute right-0 top-full mt-1 w-32 bg-[#1e1e1e] border border-[#2a2a2a] rounded-lg overflow-hidden shadow-xl z-20">
              {(Object.keys(SORT_LABELS) as PlaylistSort[]).map((s) => (
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

      {visible.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <ListMusic size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No playlists</p>
          <p className="text-sm mt-1">{filter === 'mine' ? 'Create one to get started' : 'No public playlists found'}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((pl) => {
            const isOwner = pl.owner_user_id === userId
            return (
              <div key={pl.id} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/5 group">
                <div className="w-10 h-10 rounded-lg bg-[#222] flex items-center justify-center flex-shrink-0">
                  <ListMusic size={16} className="text-[#555]" />
                </div>
                <Link to={`/playlists/${pl.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate hover:text-accent transition-colors">{pl.name}</p>
                  <p className="text-xs text-[#6b6b6b] flex items-center gap-1">
                    {pl.is_public ? <Globe size={10} /> : <Lock size={10} />}
                    {pl.is_public ? 'Public' : 'Private'}
                    {filter === 'all' && !isOwner && <span className="ml-1 opacity-60">· by others</span>}
                  </p>
                </Link>
                {isOwner && (
                  <button
                    onClick={() => deleteMut.mutate(pl.id)}
                    className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-[#6b6b6b] hover:text-red-400 transition-all"
                  >
                    <Trash2 size={14} />
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
