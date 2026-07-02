import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Play, Shuffle, Globe, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'
import { getPlaylist, updatePlaylist } from '../api/playlists'
import { usePlayerStore } from '../store/player'
import TrackRow from '../components/TrackRow'

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')

  const { data: playlist, isLoading } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => getPlaylist(id!),
    enabled: !!id,
  })

  const updateMut = useMutation({
    mutationFn: (data: { name?: string; is_public?: boolean }) => updatePlaylist(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlist', id] })
      qc.invalidateQueries({ queryKey: ['playlists'] })
      setEditing(false)
    },
  })

  const playTrack = usePlayerStore((s) => s.playTrack)

  if (isLoading) return <div className="p-4 sm:p-6 text-[#6b6b6b]">Loading...</div>
  if (!playlist) return <div className="p-4 sm:p-6 text-[#6b6b6b]">Playlist not found</div>

  const tracks = playlist.tracks ?? []

  return (
    <div className="p-4 sm:p-6">
      <Link to="/playlists" className="flex items-center gap-2 text-sm text-[#a1a1a1] hover:text-white mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Playlists
      </Link>

      <div className="mb-6">
        <div className="flex items-start gap-3 mb-1">
          {editing ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-[#222] border border-[#333] rounded-lg px-3 py-1 text-2xl font-bold focus:outline-none focus:border-accent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') updateMut.mutate({ name })
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
              <button onClick={() => updateMut.mutate({ name })} className="px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-sm">Save</button>
              <button onClick={() => setEditing(false)} className="px-3 py-1 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm">Cancel</button>
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold">{playlist.name}</h1>
              <button onClick={() => { setName(playlist.name); setEditing(true) }} className="mt-2 text-[#6b6b6b] hover:text-white">
                <Pencil size={16} />
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm text-[#a1a1a1]">
          <span>{tracks.length} tracks</span>
          <button
            onClick={() => updateMut.mutate({ is_public: !playlist.is_public })}
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            {playlist.is_public ? <><Globe size={12} /> Public</> : <><Lock size={12} /> Private</>}
          </button>
        </div>

        {tracks.length > 0 && (
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => playTrack(tracks[0], tracks)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
            >
              <Play size={14} fill="currentColor" /> Play
            </button>
            <button
              onClick={() => {
                const shuffled = [...tracks].sort(() => Math.random() - 0.5)
                playTrack(shuffled[0], shuffled)
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium transition-colors"
            >
              <Shuffle size={14} /> Shuffle
            </button>
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        {tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} queue={tracks} showNumber showArtist />
        ))}
        {tracks.length === 0 && (
          <p className="text-center py-12 text-[#6b6b6b]">This playlist is empty</p>
        )}
      </div>
    </div>
  )
}
