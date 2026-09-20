import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { getArtists } from '../api/artists'
import { getArtworkUrl } from '../api/client'
import ArtworkImage from '../components/ArtworkImage'
import SearchInput from '../components/SearchInput'
import SortMenu from '../components/SortMenu'
import EmptyState from '../ui/EmptyState'

type ArtistSort = 'tracks' | 'az' | 'za'

const SORT_LABELS: Record<ArtistSort, string> = {
  tracks: 'Most tracks',
  az: 'A → Z',
  za: 'Z → A',
}

export default function Artists() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<ArtistSort>('tracks')

  const { data: artists = [], isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: getArtists,
  })

  const visible = useMemo(() => {
    let list = artists
    const t = q.trim().toLowerCase()
    if (t) list = list.filter((a) => a.name.toLowerCase().includes(t))

    return [...list].sort((a, b) => {
      if (sort === 'az') return a.name.localeCompare(b.name)
      if (sort === 'za') return b.name.localeCompare(a.name)
      return b.track_count - a.track_count || a.name.localeCompare(b.name)
    })
  }, [artists, q, sort])

  return (
    <div className="p-4 sm:p-6 lg:px-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-display font-semibold">Artists</h1>
          <p className="text-sm text-ink-secondary mt-0.5">
            {visible.length}{q ? ` / ${artists.length}` : ''} artists
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-5">
        <SearchInput value={q} onChange={setQ} placeholder="Search artists..." className="flex-1 sm:max-w-sm" />
        <div className="sm:ml-auto">
          <SortMenu value={sort} options={SORT_LABELS} onChange={setSort} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-xl bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q ? 'No artists found' : 'No artists yet'}
          hint={q ? undefined : 'Artists appear here as soon as a track carries a credit.'}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visible.map((artist) => (
            <Link
              key={artist.id}
              to={`/artists/${artist.id}`}
              className="group p-3 rounded-xl bg-surface-2 border border-border hover:bg-surface-3 hover:border-border-strong transition-colors duration-150"
            >
              <ArtworkImage
                src={getArtworkUrl(artist.artwork_id)}
                fallbackSrc={getArtworkUrl(artist.thumbnail_track_id)}
                alt={artist.name}
                // Round, so an artist card is never mistaken for an album at a
                // glance — the two grids are otherwise identical.
                className="w-full aspect-square rounded-full object-cover mb-3 transition-transform duration-150 group-hover:scale-[1.02]"
              />
              <p className="text-title font-medium truncate text-center">{artist.name}</p>
              <p className="text-meta text-ink-tertiary mt-0.5 text-center tabular-nums">
                {artist.track_count > 0
                  ? `${artist.track_count} track${artist.track_count === 1 ? '' : 's'}`
                  : `${artist.original_count} covered here`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
