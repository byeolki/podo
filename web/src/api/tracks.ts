import { api } from './client'

export interface TrackOverride {
  title: string | null
  artist: string | null
  original_artist: string | null
  is_cover: boolean | null
  video_locator: string | null
  track_number: number | null
  disc_number: number | null
  alternate_titles: string | null
  volume_db: number | null
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
  thumbnail_path: string | null
  has_video?: boolean
  play_count: number
  favorite_count: number
  is_favorited: boolean
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

export type SortOption = 'newest' | 'oldest' | 'popular' | 'plays'
export type FilterOption = 'all' | 'mine' | 'favorites'

export function getTracks(params?: { sort?: SortOption; filter?: FilterOption }): Promise<Track[]> {
  const qs = new URLSearchParams()
  if (params?.sort) qs.set('sort', params.sort)
  if (params?.filter) qs.set('filter', params.filter)
  const query = qs.toString()
  return api.get(`/tracks${query ? `?${query}` : ''}`)
}

export function getTrack(id: string): Promise<Track & { sources: Source[]; artists: Artist[] }> {
  return api.get(`/tracks/${id}`)
}

export function recordPlay(id: string): Promise<void> {
  return api.post(`/tracks/${id}/play`, {})
}

export function toggleFavorite(id: string): Promise<{ favorited: boolean }> {
  return api.post(`/tracks/${id}/favorite`, {})
}

export interface TrackMetadataInput {
  title?: string
  artist?: string
  original_artist?: string
  is_cover?: boolean
  video_locator?: string
  track_number?: number
  disc_number?: number
  alternate_titles?: string
  volume_db?: number
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

export function deleteTracks(trackIds: string[]): Promise<{ deleted: number }> {
  return api.post('/tracks/delete', { track_ids: trackIds })
}

export function uploadTrackThumbnail(id: string, file: File): Promise<{ thumbnail_path: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)

    const token = localStorage.getItem('access_token')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1/tracks/${id}/thumbnail`)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(xhr.responseText || `HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

export function removeTrackThumbnail(id: string): Promise<void> {
  return api.delete(`/tracks/${id}/thumbnail`)
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '--:--'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
