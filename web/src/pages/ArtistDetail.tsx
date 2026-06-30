import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Users, Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getArtist } from '../api/artists'
import { usePlayerStore } from '../store/player'
import TrackRow from '../components/TrackRow'

export default function ArtistDetail() {
  const { name } = useParams<{ name: string }>()
  const decodedName = name ? decodeURIComponent(name) : ''
  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', decodedName],
    queryFn: () => getArtist(decodedName),
    enabled: !!decodedName,
  })
  const playTrack = usePlayerStore((s) => s.playTrack)

  if (isLoading) return <div className="p-6 text-[#6b6b6b]">Loading...</div>
  if (!artist) return <div className="p-6 text-[#6b6b6b]">Artist not found</div>

  const image = artist.lastfm?.image
  const tags = artist.lastfm?.tags

  return (
    <div className="p-6">
      <Link to="/artists" className="flex items-center gap-2 text-sm text-[#a1a1a1] hover:text-white mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Artists
      </Link>

      <div className="flex items-start gap-6 mb-8">
        {image ? (
          <img src={image} alt={artist.name} className="w-28 h-28 rounded-full object-cover flex-shrink-0 bg-[#222]" />
        ) : (
          <div className="w-28 h-28 rounded-full bg-[#222] flex items-center justify-center flex-shrink-0">
            <Users size={40} className="text-[#555]" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wider mb-1">Artist</p>
          <h1 className="text-3xl font-bold mb-2">{artist.name}</h1>
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-[#222] text-[#a1a1a1]">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {artist.tracks && artist.tracks.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => artist.tracks?.[0] && playTrack(artist.tracks[0], artist.tracks)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
          >
            <Play size={14} fill="currentColor" /> Play all
          </button>
        </div>
      )}

      <h2 className="text-base font-semibold mb-2">{artist.tracks?.length ?? 0} Tracks</h2>
      {artist.tracks?.length === 0 ? (
        <p className="text-[#6b6b6b] text-sm">No tracks</p>
      ) : (
        <div className="space-y-0.5">
          {artist.tracks?.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} queue={artist.tracks} showNumber />
          ))}
        </div>
      )}
    </div>
  )
}
