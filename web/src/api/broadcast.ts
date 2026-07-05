import { api } from './client'

export interface RadioToken {
  id: string
  playlist_id: string
  token: string
  created_by?: string | null
  created_by_name?: string | null
  playlist_name?: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  last_played_at: string | null
}

export function createRadioToken(playlistId: string, expiresInDays?: number): Promise<RadioToken> {
  return api.post(`/playlists/${playlistId}/radio-tokens`, expiresInDays ? { expires_in_days: expiresInDays } : {})
}

export function getRadioTokens(playlistId: string): Promise<RadioToken[]> {
  return api.get(`/playlists/${playlistId}/radio-tokens`)
}

export function revokeRadioToken(playlistId: string, id: string): Promise<void> {
  return api.delete(`/playlists/${playlistId}/radio-tokens/${id}`)
}

export function getAllRadioTokens(): Promise<RadioToken[]> {
  return api.get('/admin/radio-tokens')
}

export function adminRevokeRadioToken(id: string): Promise<void> {
  return api.delete(`/admin/radio-tokens/${id}`)
}

export function getRadioStreamUrl(token: string, format: 'mp3' | 'aac' | 'opus' = 'mp3', shuffle = false): string {
  const base = `${window.location.origin}/api/v1/broadcast/${token}.${format}`
  return shuffle ? `${base}?shuffle=1` : base
}
