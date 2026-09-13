import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Play, Shuffle, Globe, Lock, Pencil, Radio, Camera, X, Heart, RefreshCw } from 'lucide-react'
import { useState, useRef } from 'react'
import { getPlaylist, updatePlaylist, uploadPlaylistCover, removePlaylistCover } from '../api/playlists'
import { getArtworkUrl } from '../api/client'
import { usePlayerStore } from '../store/player'
import { useAuthStore } from '../store/auth'
import ArtworkImage from '../components/ArtworkImage'
import TrackRow, { TrackListHeader } from '../components/TrackRow'
import RadioModal from '../components/RadioModal'
import PlaylistSyncPanel from '../components/PlaylistSyncPanel'
import { btn, btnSize } from '../ui/button'

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.userId)
  const isAdmin = useAuthStore((s) => s.role === 'admin')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [radioOpen, setRadioOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
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

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:px-8" aria-busy="true">
        <div className="flex items-start gap-5 mb-6">
          <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl bg-surface-2 animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-3 pt-2">
            <div className="h-8 w-1/2 rounded bg-surface-2 animate-pulse" />
            <div className="h-4 w-1/4 rounded bg-surface-2 animate-pulse" />
          </div>
        </div>
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }
  if (!playlist) return <div className="p-4 sm:p-6 text-ink-tertiary">Playlist not found</div>

  const allTracks = playlist.tracks ?? []
  // Filtering here (rather than server-side) keeps the toggle instant and means
  // the queue you play is exactly the list you're looking at.
  const favoriteTracks = allTracks.filter((t) => t.is_favorited)
  const tracks = favoritesOnly ? favoriteTracks : allTracks
  const isOwner = playlist.owner_user_id === userId
  const artworkUrl = playlist.artwork_path ? `${getArtworkUrl(playlist.id)}?v=${coverBust}` : null

  return (
    <div className="p-4 sm:p-6 lg:px-8">
      <Link to="/playlists" className="flex items-center gap-2 text-sm text-ink-secondary hover:text-ink-primary mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Playlists
      </Link>

      <div className="mb-6 flex items-start gap-5">
        <div className="relative w-28 h-28 sm:w-36 sm:h-36 flex-shrink-0 group">
          <ArtworkImage
            src={artworkUrl}
            alt={playlist.name}
            className="w-full h-full rounded-xl object-cover bg-surface-2"
          />
          {isOwner && (
            <>
              <button
                onClick={() => coverInputRef.current?.click()}
                disabled={coverMut.isPending}
                className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/50 text-transparent group-hover:text-ink-primary transition-[opacity,color,background-color,border-color,scale] disabled:opacity-50"
                title="Change cover"
              >
                <Camera size={22} />
              </button>
              {playlist.artwork_path && (
                <button
                  onClick={() => removeCoverMut.mutate()}
                  className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-surface-2 border border-border-strong text-ink-secondary hover:text-ink-primary transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
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
                  className="bg-surface-2 border border-border-strong rounded-lg px-3 py-1 text-2xl font-bold focus:border-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') updateMut.mutate({ name })
                    if (e.key === 'Escape') setEditing(false)
                  }}
                />
                <button onClick={() => updateMut.mutate({ name })} className="px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm">Save</button>
                <button onClick={() => setEditing(false)} className={`${btn.secondary} ${btnSize.sm}`}>Cancel</button>
              </div>
            ) : (
              <>
                <h1 className="text-display font-semibold">{playlist.name}</h1>
                <button onClick={() => { setName(playlist.name); setEditing(true) }} className="mt-2 text-ink-tertiary hover:text-ink-primary">
                  <Pencil size={16} />
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm text-ink-secondary">
            <span>{tracks.length} tracks</span>
            {favoriteTracks.length > 0 && (
              <button
                onClick={() => setFavoritesOnly((v) => !v)}
                title={favoritesOnly ? 'Show every track' : 'Play only tracks you favorited'}
                className={`flex items-center gap-1 transition-colors ${
                  favoritesOnly ? 'text-danger' : 'hover:text-ink-primary'
                }`}
              >
                <Heart size={12} fill={favoritesOnly ? 'currentColor' : 'none'} />
                {favoritesOnly ? 'Favorites only' : `${favoriteTracks.length} favorited`}
              </button>
            )}
            <button
              onClick={() => updateMut.mutate({ is_public: !playlist.is_public })}
              className="flex items-center gap-1 hover:text-ink-primary transition-colors"
            >
              {playlist.is_public ? <><Globe size={12} /> Public</> : <><Lock size={12} /> Private</>}
            </button>
          </div>

          {tracks.length > 0 && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => playTrack(tracks[0], tracks)}
                className={`${btn.primary} ${btnSize.md}`}
              >
                <Play size={14} fill="currentColor" /> Play
              </button>
              <button
                onClick={() => {
                  const shuffled = [...tracks].sort(() => Math.random() - 0.5)
                  playTrack(shuffled[0], shuffled)
                }}
                className={`${btn.secondary} ${btnSize.md}`}
              >
                <Shuffle size={14} /> Shuffle
              </button>
              {isOwner && (
                <button
                  onClick={() => setRadioOpen(true)}
                  className={`${btn.secondary} ${btnSize.md}`}
                >
                  <Radio size={14} /> Radio URL
                </button>
              )}
              {isOwner && isAdmin && (
                <button
                  onClick={() => setSyncOpen(true)}
                  title="Keep this playlist in step with a YouTube/SoundCloud/… playlist"
                  className={`${btn.secondary} ${btnSize.md}`}
                >
                  <RefreshCw size={14} /> Auto-sync
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="-mx-3">
        <TrackListHeader />
        <div className="mt-1 space-y-0.5">
        {tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} queue={tracks} showNumber showArtist showAdded />
        ))}
        </div>
        {tracks.length === 0 && (
          <p className="text-center py-12 text-ink-tertiary">
            {favoritesOnly ? 'No favorited tracks in this playlist' : 'This playlist is empty'}
          </p>
        )}
      </div>

      {radioOpen && <RadioModal playlistId={id!} onClose={() => setRadioOpen(false)} />}
      {syncOpen && <PlaylistSyncPanel playlistId={id!} onClose={() => setSyncOpen(false)} />}
    </div>
  )
}
