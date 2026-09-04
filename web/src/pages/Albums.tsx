import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Disc3 } from 'lucide-react'
import { getAlbums } from '../api/albums'
import { getArtworkUrl } from '../api/client'
import ArtworkImage from '../components/ArtworkImage'
import SearchInput from '../components/SearchInput'
import SortMenu from '../components/SortMenu'

type AlbumSort = 'az' | 'za' | 'year_desc' | 'year_asc'

const SORT_LABELS: Record<AlbumSort, string> = {
  az: 'A → Z',
  za: 'Z → A',
  year_desc: 'Newest',
  year_asc: 'Oldest',
}

export default function Albums() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<AlbumSort>('az')

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: getAlbums,
  })

  const visible = useMemo(() => {
    let list = albums
    const t = q.trim().toLowerCase()
    if (t) list = list.filter((a) => a.title.toLowerCase().includes(t))

    return [...list].sort((a, b) => {
      if (sort === 'za') return b.title.localeCompare(a.title)
      if (sort === 'year_desc') return (b.year ?? 0) - (a.year ?? 0)
      if (sort === 'year_asc') return (a.year ?? 9999) - (b.year ?? 9999)
      return a.title.localeCompare(b.title)
    })
  }, [albums, q, sort])

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Albums</h1>
          <p className="text-sm text-ink-secondary mt-0.5">{visible.length}{q ? ` / ${albums.length}` : ''} albums</p>
        </div>
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Search albums..." className="mb-3" />

      <div className="flex justify-end mb-5">
        <SortMenu value={sort} options={SORT_LABELS} onChange={setSort} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 text-ink-tertiary">
          <Disc3 size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No albums found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visible.map((album) => (
            <Link
              key={album.id}
              to={`/albums/${album.id}`}
              className="group p-3 rounded-xl bg-surface-2 hover:bg-surface-2 transition-colors"
            >
              <ArtworkImage
                src={getArtworkUrl(album.artwork_id)}
                alt={album.title}
                className="w-full aspect-square rounded-lg object-cover mb-3"
              />
              <p className="text-sm font-medium truncate">{album.title}</p>
              {album.year && <p className="text-xs text-ink-tertiary mt-0.5">{album.year}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
