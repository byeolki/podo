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

export interface DownloadJob {
  id: string
  url: string
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  completed_items: number
  total_items?: number
  error?: string
  created_at: string
}

export function startDownload(url: string, audio_only = true): Promise<DownloadJob> {
  return api.post('/download', { url, audio_only })
}

export function getDownloads(): Promise<DownloadJob[]> {
  return api.get('/download')
}
