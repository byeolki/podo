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

/** Artists are plain names split out of `tracks.artist` — there is no artists table. */
export interface Artist {
  name: string
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

/** Resolves a known set of ids in one request — used by search results. */
export function getTracksByIds(ids: string[]): Promise<Track[]> {
  if (!ids.length) return Promise.resolve([])
  return api.get(`/tracks?ids=${ids.map(encodeURIComponent).join(',')}`)
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
  /** True when the track already had both a title and artist override. */
  skipped: boolean
  result: { title: string | null; artist: string | null; is_cover: boolean; original_artist: string | null } | null
}

export function aiAutofillTracks(trackIds: string[], force = false): Promise<AiFillResult[]> {
  return api.post('/tracks/ai-fill', { track_ids: trackIds, force })
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

/**
 * Splits a track's artist line into the part it leads with and the part that
 * follows the cover marker.
 *
 * For a cover the lead is the artist of the *original* song, not the people
 * performing this version: in a library that is mostly covers, the song's own
 * identity is what you scan a list for, and the performers are the variable part.
 *
 * `artists` is the override-resolved performer list (the `artist` column, which
 * the editor labels "Cover by"), and `original_artist` is who first released it
 * (the editor's "Artist"). Reading those two the other way round is what made the
 * same track read differently on web and on the phone.
 */
export function artistLine(track: {
  artists?: { name: string }[] | null
  is_cover?: boolean
  override?: { original_artist?: string | null } | null
}): { lead: string | null; coverPerformers: string | null } {
  const performers = track.artists?.map((a) => a.name).join(', ') ?? ''
  const originalArtist = track.override?.original_artist ?? null
  const isCover = !!track.is_cover

  if (isCover) {
    // The lead slot is "whose song this is". Falling back to the performer when
    // no original is recorded put the person who covered it there — a track
    // marked as a cover by 윤단, with the original unknown, read as though 윤단
    // were the artist. With nothing to lead with, lead with nothing.
    return {
      lead: originalArtist || null,
      coverPerformers: performers && performers !== originalArtist ? performers : null,
    }
  }
  return { lead: performers || 'Unknown Artist', coverPerformers: null }
}
