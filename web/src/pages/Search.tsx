import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon, Users, Disc3 } from 'lucide-react'
import { search } from '../api/search'
import { getTracks, type Track } from '../api/tracks'
import TrackRow from '../components/TrackRow'

export default function Search() {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data: allTracks = [] } = useQuery<Track[]>({ queryKey: ['tracks'], queryFn: () => getTracks() })
  const { data, isLoading } = useQuery({
    queryKey: ['search', debouncedQ],
    queryFn: () => search(debouncedQ),
    enabled: debouncedQ.length >= 2,
  })

  const trackMap = useMemo(() => new Map(allTracks.map((t) => [t.id, t])), [allTracks])

  const resultTracks = useMemo(
    () => (data?.tracks ?? []).map((h) => trackMap.get(h.id)).filter(Boolean) as typeof allTracks,
    [data?.tracks, trackMap],
  )

  const hasResults = data && (data.tracks.length + data.artists.length + data.albums.length > 0)

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Search</h1>

      <div className="relative mb-6">
        <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6b6b]" />
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tracks, artists, albums..."
          className="w-full max-w-lg bg-[#181818] border border-[#333] rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {debouncedQ.length < 2 ? (
        <p className="text-[#6b6b6b] text-sm">Type at least 2 characters to search</p>
      ) : isLoading ? (
        <p className="text-[#6b6b6b] text-sm">Searching...</p>
      ) : !hasResults ? (
        <p className="text-[#6b6b6b] text-sm">No results for "{debouncedQ}"</p>
      ) : (
        <div className="space-y-8">
          {resultTracks.length > 0 && (
            <section>
              <h2 className="text-base font-semibold mb-2">Tracks</h2>
              <div className="space-y-0.5">
                {resultTracks.map((track) => (
                  <TrackRow key={track.id} track={track} queue={resultTracks} hideCoverLabel />
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
                {data.artists.map((hit) => (
                  <Link
                    key={hit.id}
                    to={`/artists/${hit.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5"
                  >
                    <Users size={14} className="text-[#555] flex-shrink-0" />
                    <span className="text-sm">{hit.name}</span>
                  </Link>
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
                    <Disc3 size={14} className="text-[#555] flex-shrink-0" />
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
