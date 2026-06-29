import { api } from './client'
import type { Track } from './tracks'

export interface Artist {
  id: string
  name: string
  is_custom: boolean
  external_ids: Record<string, string>
  created_at: string
  tracks?: Track[]
}

export function getArtists(): Promise<Artist[]> {
  return api.get('/artists')
}

export function getArtist(id: string): Promise<Artist & { tracks: Track[]; covers: Track[] }> {
  return api.get(`/artists/${id}`)
}

export function createArtist(name: string): Promise<Artist> {
  return api.post('/artists', { name, is_custom: true })
}

export function updateArtist(id: string, data: { name?: string }): Promise<Artist> {
  return api.patch(`/artists/${id}`, data)
}
