import { api } from './client'
import type { Track } from './tracks'
import type { Playlist } from './playlists'

/**
 * Stations are seeded by artist *name*, not id — there is no artists table, so
 * `tracks.artist` (and the `original_artist` override) is matched as free text.
 */
export interface StationParams {
  seed_track_id?: string
  seed_artist_name?: string
  count?: number
  /** Track ids to keep out of the result, e.g. what's already queued. */
  exclude?: string[]
}

export function getStation(params: StationParams): Promise<Track[]> {
  const q = new URLSearchParams()
  if (params.seed_track_id) q.set('seed_track_id', params.seed_track_id)
  if (params.seed_artist_name) q.set('seed_artist_name', params.seed_artist_name)
  if (params.count) q.set('count', String(params.count))
  if (params.exclude?.length) q.set('exclude', params.exclude.join(','))
  return api.get(`/radio?${q}`)
}

export function createMix(data: {
  name?: string
  seed_track_id?: string
  seed_artist_name?: string
  count?: number
}): Promise<Playlist> {
  return api.post('/radio/mix', data)
}
