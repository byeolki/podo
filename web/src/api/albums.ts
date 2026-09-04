import { api } from './client'
import type { Track } from './tracks'

export interface Album {
  id: string
  title: string
  created_at: string
  updated_at: string
  /** Release year of the album's representative version, when one is known. */
  year: number | null
  /** Album *version* id to pass to `getArtworkUrl`, or null when there's no cover. */
  artwork_id: string | null
}

export interface AlbumVersion {
  id: string
  album_id: string
  version_type: string
  release_year: number | null
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
