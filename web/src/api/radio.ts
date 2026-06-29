import { api } from './client'
import type { Track } from './tracks'
import type { Playlist } from './playlists'

export function getStation(params: { seed_track_id?: string; seed_artist_id?: string; count?: number }): Promise<Track[]> {
  const q = new URLSearchParams()
  if (params.seed_track_id) q.set('seed_track_id', params.seed_track_id)
  if (params.seed_artist_id) q.set('seed_artist_id', params.seed_artist_id)
  if (params.count) q.set('count', String(params.count))
  return api.get(`/radio?${q}`)
}

export function createMix(data: { name?: string; seed_track_id?: string; seed_artist_id?: string; count?: number }): Promise<Playlist> {
  return api.post('/radio/mix', data)
}
