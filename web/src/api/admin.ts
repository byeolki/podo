import { api } from './client'

export interface SystemHealth {
  status: string
  version: string
  uptime_seconds: number
  memory: { rss: number; heapTotal: number; heapUsed: number }
  tracks: number
  sources: number
  users: number
  node_version: string
  ai: AiStatus
}

export type AiProviderName = 'openai' | 'claude-code'

export interface AiStatus {
  enabled: boolean
  provider: AiProviderName
  model: string
  chat_enabled: boolean
  /// Whether the selected provider can actually run right now.
  available: boolean
  unavailable_reason: string | null
  /// Most recent real failure; the only thing that reveals e.g. a Claude Code
  /// CLI that is installed but not signed in.
  last_error: string | null
  default_models: Record<AiProviderName, string>
}

export function getAiSettings(): Promise<AiStatus> {
  return api.get('/admin/ai')
}

export function updateAiSettings(patch: Partial<Pick<AiStatus, 'enabled' | 'provider' | 'model' | 'chat_enabled'>>): Promise<AiStatus> {
  return api.put('/admin/ai', patch)
}

export interface User {
  id: string
  name: string
  email: string
  role: string
  created_at: string
}

export interface DiskUsage {
  total_bytes: number
  free_bytes: number
  used_bytes: number
}

export interface StorageInfo {
  upload_dir: { path: string; size_bytes: number }
  artwork_dir: { path: string; size_bytes: number }
  transcode_cache: { path: string; size_bytes: number }
  /** All zeroes when `df` isn't available (e.g. a non-POSIX host). */
  disk: DiskUsage
}

export function getHealth(): Promise<SystemHealth> {
  return api.get('/admin/health/detail')
}

export interface UpdateStatus {
  current: string
  latest: string | null
  update_available: boolean
  release_url: string | null
  published_at: string | null
  notes: string | null
  /** False when the operator set UPDATE_CHECK_ENABLED=false. */
  enabled: boolean
  checked_at: string | null
  error: string | null
}

export function getUpdateStatus(): Promise<UpdateStatus> {
  return api.get('/admin/update')
}

export function recheckUpdate(): Promise<UpdateStatus> {
  return api.post('/admin/update/check', {})
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

export interface ThumbnailRebuildResult {
  examined: number
  rebuilt: number
  /// Covers that were a blank rectangle — what frame-0 extraction produced.
  blank: number
  missing_file: number
  never_generated: number
  /// No video source on disk, so only a re-fetch can give these a cover.
  needs_refetch: number
  needs_refetch_track_ids: string[]
}

export function rebuildThumbnails(): Promise<ThumbnailRebuildResult> {
  return api.post('/admin/library/thumbnails/rebuild')
}

export function getTrafficStats(period: string): Promise<unknown> {
  return api.get(`/admin/stats/traffic?period=${period}`)
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export interface ChatAction {
  type: 'play' | 'open_playlist'
  track_ids?: string[]
  playlist_id?: string
  label?: string
}

export interface ChatReply {
  reply: string
  actions: ChatAction[]
  /// Tools the assistant ran, in order — shown so an answer is inspectable.
  used_tools: string[]
}

export interface AiFeatureStatus {
  /// A provider is configured and usable — gates AI Fill, open to all users.
  available: boolean
  /// The assistant specifically, which is its own switch.
  chat_enabled: boolean
}

export function getChatStatus(): Promise<AiFeatureStatus> {
  return api.get('/ai/status')
}

export function sendChat(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<ChatReply> {
  return api.post('/ai/chat', { messages })
}
