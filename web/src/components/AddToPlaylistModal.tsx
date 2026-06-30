import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, ListMusic, Check } from 'lucide-react'
import { getPlaylists, createPlaylist, addTracksToPlaylist } from '../api/playlists'

interface Props {
  trackIds: string[]
  onClose: () => void
}

export default function AddToPlaylistModal({ trackIds, onClose }: Props) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [doneId, setDoneId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
  })

  const { mutate: addTo, isPending: adding } = useMutation({
    mutationFn: (playlistId: string) => addTracksToPlaylist(playlistId, trackIds),
    onSuccess: (_, playlistId) => {
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] })
      setDoneId(playlistId)
      setTimeout(onClose, 800)
    },
  })

  const { mutate: createAndAdd, isPending: creatingAndAdding } = useMutation({
    mutationFn: async (name: string) => {
      const pl = await createPlaylist({ name })
      await addTracksToPlaylist(pl!.id, trackIds)
      return pl!.id
    },
    onSuccess: (playlistId) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] })
      setDoneId(playlistId)
      setTimeout(onClose, 800)
    },
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    createAndAdd(name)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl w-80 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
          <span className="text-sm font-semibold">Add {trackIds.length} track{trackIds.length !== 1 ? 's' : ''} to playlist</span>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-56 overflow-y-auto">
          {playlists.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-[#555]">No playlists yet</p>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => !adding && !doneId && addTo(pl.id)}
                disabled={adding || !!doneId}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left disabled:opacity-60"
              >
                <ListMusic size={14} className="text-[#555] flex-shrink-0" />
                <span className="text-sm truncate flex-1">{pl.name}</span>
                {doneId === pl.id && <Check size={14} className="text-green-400 flex-shrink-0" />}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-[#2a2a2a] px-4 py-3">
          {creating ? (
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Playlist name"
                className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!newName.trim() || creatingAndAdding}
                className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors disabled:opacity-50"
              >
                {creatingAndAdding ? '…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-2 py-1.5 rounded-lg text-[#555] hover:text-white transition-colors"
              >
                <X size={13} />
              </button>
            </form>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 text-sm text-[#a1a1a1] hover:text-white transition-colors"
            >
              <Plus size={14} /> New playlist
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
