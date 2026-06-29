import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Disc3 } from 'lucide-react'
import { getAlbums } from '../api/albums'
import ArtworkImage from '../components/ArtworkImage'

export default function Albums() {
  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: getAlbums,
  })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Albums</h1>
        <p className="text-sm text-[#a1a1a1] mt-0.5">{albums.length} albums</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-[#181818] animate-pulse" />
          ))}
        </div>
      ) : albums.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <Disc3 size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No albums yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {albums.map((album) => (
            <Link
              key={album.id}
              to={`/albums/${album.id}`}
              className="group p-3 rounded-xl bg-[#181818] hover:bg-[#222] transition-colors"
            >
              <ArtworkImage
                src={null}
                alt={album.title}
                className="w-full aspect-square rounded-lg object-cover mb-3"
              />
              <p className="text-sm font-medium truncate">{album.title}</p>
              {album.year && <p className="text-xs text-[#6b6b6b] mt-0.5">{album.year}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
