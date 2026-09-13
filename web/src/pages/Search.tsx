import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon, Users, Disc3 } from 'lucide-react'
import { search } from '../api/search'
import { getTracksByIds, type Track } from '../api/tracks'
import TrackRow from '../components/TrackRow'

export default function Search() {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading } = useQuery({
    queryKey: ['search', debouncedQ],
    queryFn: () => search(debouncedQ),
    enabled: debouncedQ.length >= 2,
  })

  // Search returns hits (id + name), not playable rows. Resolve just those ids
  // rather than downloading the whole library to look them up locally.
  const hitIds = useMemo(() => (data?.tracks ?? []).map((h) => h.id), [data?.tracks])
  const { data: resultTracks = [] } = useQuery<Track[]>({
    queryKey: ['tracks', 'byIds', hitIds],
    queryFn: () => getTracksByIds(hitIds),
    enabled: hitIds.length > 0,
  })

  const hasResults = data && (data.tracks.length + data.artists.length + data.albums.length > 0)

  return (
    <div className="p-4 sm:p-6 lg:px-8">
      <h1 className="text-2xl font-semibold mb-6">Search</h1>

      <div className="relative mb-6">
        <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tracks, artists, albums..."
          className="w-full max-w-lg bg-surface-2 border border-border-strong rounded-xl pl-9 pr-4 py-3 text-sm focus:border-accent transition-colors"
        />
      </div>

      {debouncedQ.length < 2 ? (
        <p className="text-ink-tertiary text-sm">Type at least 2 characters to search</p>
      ) : isLoading ? (
        <p className="text-ink-tertiary text-sm">Searching...</p>
      ) : !hasResults ? (
        <p className="text-ink-tertiary text-sm">No results for "{debouncedQ}"</p>
      ) : (
        <div className="space-y-8">
          {resultTracks.length > 0 && (
            <section>
              <h2 className="text-base font-semibold mb-2">Tracks</h2>
              <div className="space-y-0.5">
                {resultTracks.map((track) => (
                  <TrackRow key={track.id} track={track} queue={resultTracks} />
                ))}
              </div>
            </section>
          )}

          {data.artists.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-base font-semibold mb-3">
                <Users size={16} /> Artists
              </h2>
              <div className="space-y-0.5">
                {/* There is no artist entity to navigate to (artist names live on the
                    track row), so selecting one re-runs the search scoped to that name. */}
                {data.artists.map((hit) => (
                  <button
                    key={hit.id}
                    onClick={() => setQ(hit.name)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 text-left"
                  >
                    <Users size={14} className="text-ink-faint flex-shrink-0" />
                    <span className="text-sm">{hit.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {data.albums.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-base font-semibold mb-3">
                <Disc3 size={16} /> Albums
              </h2>
              <div className="space-y-0.5">
                {data.albums.map((hit) => (
                  <Link
                    key={hit.id}
                    to={`/albums/${hit.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5"
                  >
                    <Disc3 size={14} className="text-ink-faint flex-shrink-0" />
                    <span className="text-sm">{hit.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
