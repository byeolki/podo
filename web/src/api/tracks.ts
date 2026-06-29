import { api } from './client'

export interface TrackOverride {
  title: string | null
  artist: string | null
  original_artist: string | null
  is_cover: boolean | null
  video_locator: string | null
  track_number: number | null
  disc_number: number | null
  updated_at: string
  updated_by: string | null
}

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
  override?: TrackOverride | null
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

export interface TrackMetadataInput {
  title?: string
  artist?: string
  original_artist?: string
  is_cover?: boolean
  video_locator?: string
  track_number?: number
  disc_number?: number
}

export function updateTrackMetadata(id: string, data: TrackMetadataInput): Promise<Track> {
  return api.patch(`/tracks/${id}/metadata`, data)
}

export interface AiFillResult {
  track_id: string
  applied: boolean
  result: { title: string | null; artist: string | null; is_cover: boolean; original_artist: string | null } | null
}

export function aiAutofillTracks(trackIds: string[]): Promise<AiFillResult[]> {
  return api.post('/tracks/ai-fill', { track_ids: trackIds })
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '--:--'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
