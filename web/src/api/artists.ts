import { api } from './client'
import type { Track } from './tracks'

export interface LastFmInfo {
  image?: string
  tags?: string[]
}

export interface Artist {
  name: string
  track_count?: number
  is_performer?: boolean
  image?: string | null
  tracks?: Track[]
  lastfm?: LastFmInfo | null
}

export function getArtists(): Promise<Artist[]> {
  return api.get('/artists')
}

export function getArtist(name: string): Promise<Artist & { tracks: Track[]; lastfm: LastFmInfo | null }> {
  return api.get(`/artists/${encodeURIComponent(name)}`)
}
