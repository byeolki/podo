import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Play } from 'lucide-react'
import { getAlbum } from '../api/albums'
import { getArtworkUrl } from '../api/client'
import { usePlayerStore } from '../store/player'
import TrackRow from '../components/TrackRow'
import ArtworkImage from '../components/ArtworkImage'

export default function AlbumDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: album, isLoading } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id!),
    enabled: !!id,
  })
  const playTrack = usePlayerStore((s) => s.playTrack)

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6" aria-busy="true">
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
  if (!album) return <div className="p-4 sm:p-6 text-ink-tertiary">Album not found</div>

  const allTracks = album.versions?.flatMap((v) => v.tracks ?? []) ?? []
  const coverVersion = album.versions?.find((v) => v.artwork_path) ?? album.versions?.[0]

  return (
    <div className="p-4 sm:p-6">
      <Link to="/albums" className="flex items-center gap-2 text-sm text-ink-secondary hover:text-white mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Albums
      </Link>

      <div className="flex items-start gap-6 mb-8">
        <ArtworkImage
          src={getArtworkUrl(coverVersion?.artwork_path ? coverVersion.id : null)}
          fallbackSrc={allTracks.find((t) => t.thumbnail_path) ? getArtworkUrl(allTracks.find((t) => t.thumbnail_path)!.id) : null}
          alt={album.title}
          className="w-40 h-40 rounded-xl flex-shrink-0"
        />
        <div>
          <p className="text-xs text-ink-tertiary uppercase tracking-wider mb-1">Album</p>
          <h1 className="text-3xl font-bold">{album.title}</h1>
          {coverVersion?.release_year && <p className="text-sm text-ink-secondary mt-1">{coverVersion.release_year}</p>}
          <p className="text-sm text-ink-secondary">{allTracks.length} tracks</p>
          {allTracks.length > 0 && (
            <button
              onClick={() => playTrack(allTracks[0], allTracks)}
              className="flex items-center gap-2 px-4 py-2 mt-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
            >
              <Play size={14} fill="currentColor" /> Play
            </button>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
        {allTracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} queue={allTracks} showNumber showArtist />
        ))}
      </div>
    </div>
  )
}
