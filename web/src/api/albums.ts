import { api } from './client'
import type { Track } from './tracks'

export interface Album {
  id: string
  title: string
  primary_artist_id: string | null
  year: number | null
  created_at: string
}

export interface AlbumVersion {
  id: string
  album_id: string
  label: string | null
  year: number | null
  artwork_path: string | null
  tracks?: Track[]
}

export interface AlbumDetail extends Album {
  versions: AlbumVersion[]
}

export function getAlbums(): Promise<Album[]> {
  return api.get('/albums')
}

export function getAlbum(id: string): Promise<AlbumDetail> {
  return api.get(`/albums/${id}`)
}
