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
