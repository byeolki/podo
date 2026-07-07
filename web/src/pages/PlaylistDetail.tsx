import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Play, Shuffle, Globe, Lock, Pencil, Radio, Camera, X } from 'lucide-react'
import { useState, useRef } from 'react'
import { getPlaylist, updatePlaylist, uploadPlaylistCover, removePlaylistCover } from '../api/playlists'
import { getArtworkUrl } from '../api/client'
import { usePlayerStore } from '../store/player'
import { useAuthStore } from '../store/auth'
import ArtworkImage from '../components/ArtworkImage'
import TrackRow from '../components/TrackRow'
import RadioModal from '../components/RadioModal'

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.userId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [radioOpen, setRadioOpen] = useState(false)
  const [coverBust, setCoverBust] = useState(0)
  const coverInputRef = useRef<HTMLInputElement>(null)

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

  const coverMut = useMutation({
    mutationFn: (file: File) => uploadPlaylistCover(id!, file),
    onSuccess: () => {
      setCoverBust((v) => v + 1)
      qc.invalidateQueries({ queryKey: ['playlist', id] })
      qc.invalidateQueries({ queryKey: ['playlists'] })
    },
  })

  const removeCoverMut = useMutation({
    mutationFn: () => removePlaylistCover(id!),
    onSuccess: () => {
      setCoverBust((v) => v + 1)
      qc.invalidateQueries({ queryKey: ['playlist', id] })
      qc.invalidateQueries({ queryKey: ['playlists'] })
    },
  })

  const playTrack = usePlayerStore((s) => s.playTrack)

  if (isLoading) return <div className="p-4 sm:p-6 text-[#6b6b6b]">Loading...</div>
  if (!playlist) return <div className="p-4 sm:p-6 text-[#6b6b6b]">Playlist not found</div>

  const tracks = playlist.tracks ?? []
  const isOwner = playlist.owner_user_id === userId
  const artworkUrl = playlist.artwork_path ? `${getArtworkUrl(playlist.id)}?v=${coverBust}` : null

  return (
    <div className="p-4 sm:p-6">
      <Link to="/playlists" className="flex items-center gap-2 text-sm text-[#a1a1a1] hover:text-white mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Playlists
      </Link>

      <div className="mb-6 flex items-start gap-5">
        <div className="relative w-28 h-28 sm:w-36 sm:h-36 flex-shrink-0 group">
          <ArtworkImage
            src={artworkUrl}
            alt={playlist.name}
            className="w-full h-full rounded-xl object-cover bg-[#222]"
          />
          {isOwner && (
            <>
              <button
                onClick={() => coverInputRef.current?.click()}
                disabled={coverMut.isPending}
                className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/50 text-transparent group-hover:text-white transition-all disabled:opacity-50"
                title="Change cover"
              >
                <Camera size={22} />
              </button>
              {playlist.artwork_path && (
                <button
                  onClick={() => removeCoverMut.mutate()}
                  className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-[#222] border border-[#333] text-[#a1a1a1] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove cover"
                >
                  <X size={12} />
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) coverMut.mutate(file)
                  e.target.value = ''
                }}
              />
            </>
          )}
        </div>

        <div className="flex-1 min-w-0">
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
              {isOwner && (
                <button
                  onClick={() => setRadioOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm font-medium transition-colors"
                >
                  <Radio size={14} /> Radio URL
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
        {tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} queue={tracks} showNumber showArtist />
        ))}
        {tracks.length === 0 && (
          <p className="text-center py-12 text-[#6b6b6b]">This playlist is empty</p>
        )}
      </div>

      {radioOpen && <RadioModal playlistId={id!} onClose={() => setRadioOpen(false)} />}
    </div>
  )
}
