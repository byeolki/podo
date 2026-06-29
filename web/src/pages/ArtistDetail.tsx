import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Users, Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getArtist } from '../api/artists'
import { usePlayerStore } from '../store/player'
import TrackRow from '../components/TrackRow'

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id!),
    enabled: !!id,
  })
  const playTrack = usePlayerStore((s) => s.playTrack)

  if (isLoading) return <div className="p-6 text-[#6b6b6b]">Loading...</div>
  if (!artist) return <div className="p-6 text-[#6b6b6b]">Artist not found</div>

  return (
    <div className="p-6">
      <Link to="/artists" className="flex items-center gap-2 text-sm text-[#a1a1a1] hover:text-white mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Artists
      </Link>

      <div className="flex items-center gap-6 mb-8">
        <div className="w-24 h-24 rounded-full bg-[#222] flex items-center justify-center flex-shrink-0">
          <Users size={36} className="text-[#555]" />
        </div>
        <div>
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wider mb-1">Artist</p>
          <h1 className="text-3xl font-bold">{artist.name}</h1>
          <p className="text-sm text-[#a1a1a1] mt-1">{artist.tracks?.length ?? 0} tracks</p>
        </div>
      </div>

      {artist.tracks && artist.tracks.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => artist.tracks?.[0] && playTrack(artist.tracks[0], artist.tracks)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
          >
            <Play size={14} fill="currentColor" /> Play
          </button>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3">Tracks</h2>
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
