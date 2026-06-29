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

  if (isLoading) return <div className="p-6 text-[#6b6b6b]">Loading...</div>
  if (!album) return <div className="p-6 text-[#6b6b6b]">Album not found</div>

  const allTracks = album.versions?.flatMap((v) => v.tracks ?? []) ?? []

  return (
    <div className="p-6">
      <Link to="/albums" className="flex items-center gap-2 text-sm text-[#a1a1a1] hover:text-white mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Albums
      </Link>

      <div className="flex items-start gap-6 mb-8">
        <ArtworkImage
          src={getArtworkUrl(album.versions?.[0]?.id)}
          alt={album.title}
          className="w-40 h-40 rounded-xl flex-shrink-0"
        />
        <div>
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wider mb-1">Album</p>
          <h1 className="text-3xl font-bold">{album.title}</h1>
          {album.versions?.[0]?.release_year && <p className="text-sm text-[#a1a1a1] mt-1">{album.versions[0].release_year}</p>}
          <p className="text-sm text-[#a1a1a1]">{allTracks.length} tracks</p>
          {allTracks.length > 0 && (
            <button
              onClick={() => playTrack(allTracks[0], allTracks)}
              className="flex items-center gap-2 px-4 py-2 mt-4 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
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
