import { api } from './client'
import type { Track } from './tracks'

export interface Playlist {
  id: string
  name: string
  description: string | null
  is_public: boolean
  owner_user_id: string
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

export function deletePlaylist(id: string): Promise<void> {
  return api.delete(`/playlists/${id}`)
}
