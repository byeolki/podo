import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Play, Shuffle } from 'lucide-react'
import { getArtist } from '../api/artists'
import { getArtworkUrl } from '../api/client'
import { usePlayerStore } from '../store/player'
import TrackRow, { TrackListHeader } from '../components/TrackRow'
import ArtworkImage from '../components/ArtworkImage'

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id!),
    enabled: !!id,
  })
  const playTrack = usePlayerStore((s) => s.playTrack)

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:px-8" aria-busy="true">
        <div className="flex items-start gap-6 mb-8">
          <div className="w-40 h-40 rounded-full bg-surface-2 animate-pulse flex-shrink-0" />
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
  if (!artist) return <div className="p-4 sm:p-6 text-ink-tertiary">Artist not found</div>

  const tracks = artist.tracks ?? []
  const originals = artist.original_tracks ?? []
  const artwork = tracks.find((t) => t.album_version_id) ?? originals.find((t) => t.album_version_id)
  const thumbnail = tracks.find((t) => t.thumbnail_path) ?? originals.find((t) => t.thumbnail_path)

  function shuffle() {
    if (!tracks.length) return
    const order = [...tracks]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    playTrack(order[0], order)
  }

  return (
    <div className="p-4 sm:p-6 lg:px-8">
      <Link to="/artists" className="flex items-center gap-2 text-sm text-ink-secondary hover:text-ink-primary mb-6 transition-colors">
        <ArrowLeft size={16} aria-hidden="true" /> Back to Artists
      </Link>

      <div className="flex items-start gap-6 mb-8">
        <ArtworkImage
          src={getArtworkUrl(artwork?.album_version_id ?? null)}
          fallbackSrc={getArtworkUrl(thumbnail?.id ?? null)}
          alt={artist.name}
          className="w-40 h-40 rounded-full flex-shrink-0"
        />
        <div>
          <p className="text-xs text-ink-tertiary uppercase tracking-wider mb-1">Artist</p>
          <h1 className="text-display font-semibold">{artist.name}</h1>
          <p className="text-sm text-ink-secondary mt-1 tabular-nums">
            {tracks.length} track{tracks.length === 1 ? '' : 's'}
            {originals.length > 0 && ` · ${originals.length} covered here`}
          </p>
          {tracks.length > 0 && (
            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => playTrack(tracks[0], tracks)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
              >
                <Play size={14} fill="currentColor" aria-hidden="true" /> Play
              </button>
              <button
                type="button"
                onClick={shuffle}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 border border-border hover:bg-surface-3 hover:border-border-strong text-sm font-medium transition-colors"
              >
                <Shuffle size={14} aria-hidden="true" /> Shuffle
              </button>
            </div>
          )}
        </div>
      </div>

      {tracks.length > 0 && (
        <div className="-mx-3">
          <TrackListHeader />
          <div className="mt-1 space-y-0.5">
            {tracks.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} queue={tracks} showAdded />
            ))}
          </div>
        </div>
      )}

      {originals.length > 0 && (
        <section className="mt-10">
          <h2 className="text-title font-semibold">Their songs, covered here</h2>
          <p className="text-sm text-ink-secondary mt-0.5 mb-3">
            Recorded by someone else in this library.
          </p>
          <div className="-mx-3">
            <TrackListHeader />
            <div className="mt-1 space-y-0.5">
              {originals.map((track, i) => (
                <TrackRow key={track.id} track={track} index={i} queue={originals} showAdded />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
