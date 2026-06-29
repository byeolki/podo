import { api } from './client'

export interface Track {
  id: string
  title: string
  track_number: number | null
  disc_number: number | null
  duration: number | null
  added_at: string
  is_cover: boolean
  original_artist_id: string | null
  album_version_id: string | null
  has_video?: boolean
  sources?: Source[]
  artists?: Artist[]
  tags?: Tag[]
}

export interface Source {
  id: string
  track_id: string
  locator: string
  media_kind: 'audio' | 'video'
  format: string | null
  bitrate: number | null
  duration: number | null
  available: boolean
  origin: 'local' | 'ytdlp'
}

export interface Artist {
  id: string
  name: string
  is_custom: boolean
  external_ids: Record<string, string>
}

export interface Tag {
  id: string
  name: string
}

export function getTracks(): Promise<Track[]> {
  return api.get('/tracks')
}

export function getTrack(id: string): Promise<Track & { sources: Source[]; artists: Artist[] }> {
  return api.get(`/tracks/${id}`)
}

export function updateTrackMetadata(id: string, data: { title?: string; track_number?: number; disc_number?: number }): Promise<Track> {
  return api.patch(`/tracks/${id}/metadata`, data)
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '--:--'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
