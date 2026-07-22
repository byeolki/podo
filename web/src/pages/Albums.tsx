import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Disc3, Search, X, ChevronDown } from 'lucide-react'
import { getAlbums } from '../api/albums'
import ArtworkImage from '../components/ArtworkImage'

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
  const [sortOpen, setSortOpen] = useState(false)

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

      {/* Search bar */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search albums..."
          className="w-full bg-surface-2 border border-border rounded-lg pl-8 pr-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
        />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Sort bar */}
      <div className="flex justify-end mb-5">
        <div className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2 text-xs text-ink-secondary hover:text-white transition-colors"
          >
            {SORT_LABELS[sort]}
            <ChevronDown size={12} />
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-surface-3 border border-border rounded-lg overflow-hidden shadow-xl z-20">
              {(Object.keys(SORT_LABELS) as AlbumSort[]).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSort(s); setSortOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                    sort === s ? 'text-accent bg-accent/10' : 'text-ink-secondary hover:text-white hover:bg-white/5'
                  }`}
                >
                  {SORT_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </div>
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
                src={null}
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
