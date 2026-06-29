import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { getArtists } from '../api/artists'

export default function Artists() {
  const { data: artists = [], isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: getArtists,
  })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Artists</h1>
        <p className="text-sm text-[#a1a1a1] mt-0.5">{artists.length} artists</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-[#181818] animate-pulse" />
          ))}
        </div>
      ) : artists.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <Users size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No artists yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {artists.map((artist) => (
            <Link
              key={artist.id}
              to={`/artists/${artist.id}`}
              className="group p-4 rounded-xl bg-[#181818] hover:bg-[#222] transition-colors"
            >
              <div className="w-full aspect-square rounded-full bg-[#2a2a2a] flex items-center justify-center mb-3">
                <Users size={32} className="text-[#555]" />
              </div>
              <p className="text-sm font-medium truncate text-center">{artist.name}</p>
              {artist.is_custom && (
                <p className="text-xs text-[#6b6b6b] text-center mt-0.5">Custom</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
