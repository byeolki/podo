import { api } from './client'
import type { Track } from './tracks'

export interface Playlist {
  id: string
  name: string
  description: string | null
  is_public: boolean
  owner_user_id: string
  artwork_path: string | null
  created_at: string
  updated_at: string
  tracks?: (Track & { position: number })[]
}

export function getPlaylists(): Promise<Playlist[]> {
  return api.get('/playlists')
}

export function getPublicPlaylists(): Promise<Playlist[]> {
  return api.get('/playlists/public')
}

export function getPlaylist(id: string): Promise<Playlist & { tracks: (Track & { position: number })[] }> {
  return api.get(`/playlists/${id}`)
}

export function createPlaylist(data: { name: string; description?: string; is_public?: boolean }): Promise<Playlist> {
  return api.post('/playlists', data)
}

export function updatePlaylist(id: string, data: { name?: string; description?: string; is_public?: boolean; track_ids?: string[] }): Promise<Playlist> {
  return api.patch(`/playlists/${id}`, data)
}

export function addTracksToPlaylist(id: string, trackIds: string[]): Promise<void> {
  return api.post(`/playlists/${id}/tracks`, { track_ids: trackIds })
}

export function deletePlaylist(id: string): Promise<void> {
  return api.delete(`/playlists/${id}`)
}

export function uploadPlaylistCover(id: string, file: File): Promise<{ artwork_path: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)

    const token = localStorage.getItem('access_token')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1/playlists/${id}/cover`)
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

export function removePlaylistCover(id: string): Promise<void> {
  return api.delete(`/playlists/${id}/cover`)
}

export interface PlaylistSubscription {
  playlist_id: string
  source_url: string
  provider: string
  audio_only: boolean
  interval_minutes: number
  enabled: boolean
  last_synced_at: string | null
  last_status: 'ok' | 'failed' | 'running' | null
  last_error: string | null
  added_count: number
  created_at: string
}

export interface SyncResult {
  checked: number
  added: number
  skipped: number
  failed: number
}

export function getSubscription(id: string): Promise<PlaylistSubscription | null> {
  return api.get(`/playlists/${id}/subscription`)
}

export function setSubscription(
  id: string,
  data: { source_url: string; interval_minutes?: number; audio_only?: boolean; enabled?: boolean },
): Promise<PlaylistSubscription> {
  return api.put(`/playlists/${id}/subscription`, data)
}

export function removeSubscription(id: string): Promise<void> {
  return api.delete(`/playlists/${id}/subscription`)
}

export function syncSubscriptionNow(id: string): Promise<SyncResult> {
  return api.post(`/playlists/${id}/subscription/sync`, {})
}

export interface PlaylistImport {
  playlist_id: string
  name: string
  job_id: string
}

/**
 * Downloads a remote playlist and keeps it as a playlist here. A one-time
 * import — the result is an ordinary playlist with no link back to the source.
 */
export function importPlaylistFromUrl(
  url: string,
  audio_only = true,
): Promise<PlaylistImport> {
  return api.post('/playlists/from-url', { url, audio_only })
}
