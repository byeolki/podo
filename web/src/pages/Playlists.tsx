import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListMusic, Plus, Trash2, Globe, Lock } from 'lucide-react'
import { getPlaylists, createPlaylist, deletePlaylist } from '../api/playlists'

export default function Playlists() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [isPublic, setIsPublic] = useState(false)

  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Playlists</h1>
          <p className="text-sm text-[#a1a1a1] mt-0.5">{playlists.length} playlists</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
        >
          <Plus size={14} /> New playlist
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 rounded-xl bg-[#181818] border border-[#333]">
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

      {playlists.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <ListMusic size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No playlists</p>
          <p className="text-sm mt-1">Create one to get started</p>
        </div>
      ) : (
        <div className="space-y-1">
          {playlists.map((pl) => (
            <div key={pl.id} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/5 group">
              <div className="w-10 h-10 rounded-lg bg-[#222] flex items-center justify-center flex-shrink-0">
                <ListMusic size={16} className="text-[#555]" />
              </div>
              <Link to={`/playlists/${pl.id}`} className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate hover:text-accent transition-colors">{pl.name}</p>
                <p className="text-xs text-[#6b6b6b]">
                  {pl.is_public ? (
                    <span className="flex items-center gap-1"><Globe size={10} /> Public</span>
                  ) : (
                    <span className="flex items-center gap-1"><Lock size={10} /> Private</span>
                  )}
                </p>
              </Link>
              <button
                onClick={() => deleteMut.mutate(pl.id)}
                className="opacity-0 group-hover:opacity-100 text-[#6b6b6b] hover:text-red-400 transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
