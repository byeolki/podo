import { api } from './client'

export interface SystemHealth {
  status: string
  uptime_seconds: number
  memory: { rss: number; heapTotal: number; heapUsed: number }
  tracks: number
  sources: number
  users: number
  node_version: string
}

export interface User {
  id: string
  name: string
  email: string
  role: string
  created_at: string
}

export interface StorageInfo {
  upload_dir: { path: string; size_bytes: number }
  artwork_dir: { path: string; size_bytes: number }
  transcode_cache: { path: string; size_bytes: number }
}

export function getHealth(): Promise<SystemHealth> {
  return api.get('/admin/health/detail')
}

export function getUsers(): Promise<User[]> {
  return api.get('/admin/users')
}

export function getStorage(): Promise<StorageInfo> {
  return api.get('/admin/storage')
}

export function clearTranscodeCache(): Promise<{ cleared: number }> {
  return api.delete('/admin/cache/transcode')
}

export function verifyIntegrity(): Promise<{ missing_count: number; missing_files: string[] }> {
  return api.post('/admin/library/verify')
}

export function getTrafficStats(period: string): Promise<unknown> {
  return api.get(`/admin/stats/traffic?period=${period}`)
}

export interface ArtistAlias {
  id: string
  name: string
  alias: string
  created_at: string
}

export function getAliases(): Promise<ArtistAlias[]> {
  return api.get('/admin/aliases')
}

export function addAlias(name: string, alias: string): Promise<ArtistAlias> {
  return api.post('/admin/aliases', { name, alias })
}

export function removeAlias(id: string): Promise<{ deleted: boolean }> {
  return api.delete(`/admin/aliases/${id}`)
}

export interface AliasSuggestion {
  canonical: string
  aliases: string[]
}

export function lookupAliases(name: string): Promise<AliasSuggestion[]> {
  return api.get(`/admin/aliases/lookup?name=${encodeURIComponent(name)}`)
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
