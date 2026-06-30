import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Users, Search, X, ChevronDown, UserCircle2 } from 'lucide-react'
import { getArtists } from '../api/artists'

type ArtistFilter = 'all' | 'performers' | 'originals'
type ArtistSort = 'az' | 'za' | 'tracks'

const FILTER_LABELS: Record<ArtistFilter, string> = {
  all: 'All',
  performers: 'Cover performers',
  originals: 'Original artists',
}

const SORT_LABELS: Record<ArtistSort, string> = {
  az: 'A → Z',
  za: 'Z → A',
  tracks: 'Most tracks',
}

export default function Artists() {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<ArtistFilter>('all')
  const [sort, setSort] = useState<ArtistSort>('az')
  const [sortOpen, setSortOpen] = useState(false)

  const { data: artists = [], isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: getArtists,
  })

  const visible = useMemo(() => {
    let list = artists

    if (filter === 'performers') list = list.filter((a) => a.is_performer)
    else if (filter === 'originals') list = list.filter((a) => !a.is_performer)

    const t = q.trim().toLowerCase()
    if (t) list = list.filter((a) => a.name.toLowerCase().includes(t))

    if (sort === 'za') return [...list].sort((a, b) => b.name.localeCompare(a.name))
    if (sort === 'tracks') return [...list].sort((a, b) => (b.track_count ?? 0) - (a.track_count ?? 0))
    return list
  }, [artists, filter, q, sort])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Artists</h1>
          <p className="text-sm text-[#a1a1a1] mt-0.5">{visible.length}{q || filter !== 'all' ? ` / ${artists.length}` : ''} artists</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search artists..."
          className="w-full bg-[#181818] border border-[#2a2a2a] rounded-lg pl-8 pr-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
        />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Filter + Sort bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-1 bg-[#1a1a1a] rounded-lg p-0.5">
          {(Object.keys(FILTER_LABELS) as ArtistFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f ? 'bg-[#2a2a2a] text-white' : 'text-[#777] hover:text-white'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <div className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#222] text-xs text-[#a1a1a1] hover:text-white transition-colors"
          >
            {SORT_LABELS[sort]}
            <ChevronDown size={12} />
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-[#1e1e1e] border border-[#2a2a2a] rounded-lg overflow-hidden shadow-xl z-20">
              {(Object.keys(SORT_LABELS) as ArtistSort[]).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSort(s); setSortOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                    sort === s ? 'text-accent bg-accent/10' : 'text-[#a1a1a1] hover:text-white hover:bg-white/5'
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
            <div key={i} className="h-32 rounded-xl bg-[#181818] animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <Users size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No artists found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visible.map((artist) => (
            <Link
              key={artist.name}
              to={`/artists/${encodeURIComponent(artist.name)}`}
              className="group p-4 rounded-xl bg-[#181818] hover:bg-[#222] transition-colors"
            >
              {artist.image ? (
                <img src={artist.image} alt={artist.name} className="w-full aspect-square rounded-full object-cover mb-3 bg-[#2a2a2a]" />
              ) : (
                <div className="w-full aspect-square rounded-full bg-[#2a2a2a] flex items-center justify-center mb-3">
                  <Users size={32} className="text-[#555]" />
                </div>
              )}
              <p className="text-sm font-medium truncate text-center">{artist.name}</p>
              <p className="text-xs text-[#6b6b6b] text-center mt-0.5">{artist.track_count ?? 0} tracks</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
