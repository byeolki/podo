import { api } from './client'

export interface SearchResults {
  tracks: Array<{ id: string; name: string; type: 'track'; artist?: string }>
  artists: Array<{ id: string; name: string; type: 'artist' }>
  albums: Array<{ id: string; name: string; type: 'album' }>
}

export function search(q: string): Promise<SearchResults> {
  return api.get(`/search?q=${encodeURIComponent(q)}`)
}
