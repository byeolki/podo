import { api } from './client'

export interface LibraryRoot {
  id: string
  path: string
  enabled: boolean
  last_scan_at: string | null
  created_at: string
}

export interface ScanJob {
  id: string
  library_root_id: string
  status: 'running' | 'completed' | 'failed'
  total_files: number
  processed_files: number
  added: number
  updated: number
  removed: number
  error: string | null
  started_at: string
  finished_at: string | null
}

export function getRoots(): Promise<LibraryRoot[]> {
  return api.get('/library/roots')
}

export function addRoot(path: string): Promise<LibraryRoot> {
  return api.post('/library/roots', { path })
}

export function removeRoot(id: string): Promise<void> {
  return api.delete(`/library/roots/${id}`)
}

export function triggerScan(id: string): Promise<{ job_id: string }> {
  return api.post(`/library/roots/${id}/scan`)
}

export function getScanJobs(): Promise<ScanJob[]> {
  return api.get('/library/scans')
}

export type Provider =
  | 'youtube' | 'twitter' | 'soundcloud' | 'bandcamp' | 'vimeo'
  | 'tiktok' | 'instagram' | 'twitch' | 'niconico' | 'bilibili' | 'other'

export interface DownloadJob {
  id: string
  url: string
  provider: Provider
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  completed_items: number
  total_items?: number
  error?: string
  created_at: string
  /** Set when the job is re-fetching an existing track rather than adding one. */
  refresh_track_id?: string
}

export interface UrlInspection {
  url: string
  provider: Provider
  provider_label: string
  is_playlist: boolean
}

/** Classifies a pasted URL so the UI can say what it's about to do. */
export function inspectUrl(url: string): Promise<UrlInspection> {
  return api.get(`/download/inspect?url=${encodeURIComponent(url)}`)
}

export function startDownload(url: string, audio_only = true, allow_playlist?: boolean): Promise<DownloadJob> {
  return api.post('/download', { url, audio_only, ...(allow_playlist !== undefined && { allow_playlist }) })
}

export function getDownloads(): Promise<DownloadJob[]> {
  return api.get('/download')
}

export function getDownload(id: string): Promise<DownloadJob> {
  return api.get(`/download/${id}`)
}

export interface TrackSourceInfo {
  track_id: string
  source_id: string
  source_url: string | null
  provider: Provider | null
  provider_label: string | null
  media_kind: 'audio' | 'video'
  /** False when there is nothing to re-fetch from. */
  refreshable: boolean
  last_refreshed_at: string
}

export function getTrackSource(trackId: string): Promise<TrackSourceInfo> {
  return api.get(`/download/source/${trackId}`)
}

/** Re-downloads a track from the URL it came from, in place. */
export function refreshTrackSource(trackId: string): Promise<DownloadJob> {
  return api.post(`/download/refresh/${trackId}`, {})
}

export interface LocalSearchHit {
  id: string
  name: string
  artist?: string
  type: 'track'
}

export interface YoutubeSearchResult {
  id: string
  title: string
  duration: number | null
  channel: string | null
  thumbnail: string | null
  url: string
}

export interface UnifiedSearchResult {
  local: LocalSearchHit[]
  youtube: YoutubeSearchResult[]
}

export function searchDownload(q: string, limit = 10): Promise<UnifiedSearchResult> {
  return api.get(`/download/search?q=${encodeURIComponent(q)}&limit=${limit}`)
}
