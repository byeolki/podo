import { api } from './client'
import type { Track } from './tracks'

export interface PlayHistory {
  id: string
  track_id: string
  source_id: string | null
  played_at: string
  played_duration: number
  /** Override-resolved, joined server-side so the list is renderable on its own. */
  title: string
  artist: string | null
  album_version_id: string | null
  thumbnail_path: string | null
}

export interface Stats {
  period: string
  total_listen_duration: number
  top_tracks: Array<{ track_id: string; count: number; total_duration: number }>
}

export function getHistory(): Promise<PlayHistory[]> {
  return api.get('/history')
}

export function recordPlay(track_id: string, played_duration: number): Promise<{ id: string }> {
  return api.post('/history', {
    track_id,
    played_at: new Date().toISOString(),
    played_duration,
  })
}

export function getStats(): Promise<Stats> {
  return api.get('/stats/me')
}

export function getFavorites(): Promise<{ track: Track }[]> {
  return api.get('/favorites')
}

export function addFavorite(track_id: string): Promise<{ favorited: boolean }> {
  return api.put(`/favorites/${track_id}`)
}

export function removeFavorite(track_id: string): Promise<{ favorited: boolean }> {
  return api.delete(`/favorites/${track_id}`)
}
