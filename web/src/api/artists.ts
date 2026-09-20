import { api } from './client'
import type { Track } from './tracks'

export interface ArtistSummary {
  /** Opaque handle for the name; safe in a URL path. */
  id: string
  name: string
  /** Tracks this name is credited on, alone or alongside others. */
  track_count: number
  cover_count: number
  /** Tracks by someone else that this name originally released. */
  original_count: number
  artwork_id: string | null
  thumbnail_track_id: string | null
}

export interface ArtistDetail {
  id: string
  name: string
  tracks: Track[]
  /** Their songs, performed here by someone else. */
  original_tracks: Track[]
}

export function getArtists(): Promise<ArtistSummary[]> {
  return api.get('/artists')
}

export function getArtist(id: string): Promise<ArtistDetail> {
  return api.get(`/artists/${id}`)
}
