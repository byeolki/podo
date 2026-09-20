import { api } from './client'

export interface UploadedFile {
  source_id: string
  track_id: string
  track_title: string
  filename: string
  path: string
  file_size: number | null
  added_at: string | null
  added_by_name: string | null
  source_url: string | null
}

export interface UploadResult {
  uploaded: Array<{ filename: string; path?: string; error?: string }>
}

/**
 * The tracks the given uploaded paths have become so far. The scanner imports in
 * the background, so this is polled until it stops growing.
 */
export function resolveImported(paths: string[]): Promise<{ track_ids: string[] }> {
  return api.post('/upload/imported', { paths })
}

/**
 * What a proxy in front of the server will accept in one request.
 *
 * Cloudflare's free plan rejects a body over 100MB at the edge, before the
 * request ever reaches podo — so no server setting can raise it and the server
 * never learns the upload was attempted. Checked here so an oversized file fails
 * in the file picker rather than after pushing a hundred megabytes up a phone
 * connection to be told no.
 */
const PROXY_BODY_LIMIT = 100 * 1024 * 1024

/** Turns a proxy's HTML error page into a sentence. */
function describeUploadFailure(status: number, body: string): string {
  if (status === 413 || /413 Payload Too Large/i.test(body)) {
    return 'Too large for the server\u2019s proxy — Cloudflare\u2019s free plan rejects anything over 100MB before it reaches podo.'
  }
  // An HTML error page is a proxy talking, not the server; quoting the markup at
  // someone helps nobody.
  if (/^\s*<(!doctype|html)/i.test(body)) {
    return `The server\u2019s proxy refused the upload (HTTP ${status}).`
  }
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] }
    const message = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message
    if (message) return message
  } catch {
    // not JSON either — fall through to the raw text
  }
  return body.trim() || `Upload failed (HTTP ${status}).`
}

/**
 * Sends one file in pieces, so no single request can reach the proxy's limit.
 *
 * The limit is applied at the edge — the server never sees the request and no
 * setting on it can raise the ceiling — so splitting the file is the only way a
 * browser can put a large one through. Each part is an ordinary small upload;
 * the server appends them and scans the result.
 */
async function uploadInChunks(file: File, onProgress?: (pct: number) => void): Promise<UploadResult> {
  const begun = await api.post<{ upload_id: string; chunk_size: number }>(
    '/upload/chunked', { filename: file.name },
  )
  const size = begun.chunk_size || 8 * 1024 * 1024
  try {
    for (let sent = 0; sent < file.size; sent += size) {
      const form = new FormData()
      form.append('chunk', file.slice(sent, Math.min(sent + size, file.size)))
      await api.postForm(`/upload/chunked/${begun.upload_id}`, form)
      onProgress?.(Math.round((Math.min(sent + size, file.size) / file.size) * 100))
    }
    const done = await api.post<{ path: string }>(`/upload/chunked/${begun.upload_id}/finish`)
    return { uploaded: [{ filename: file.name, path: done.path }] }
  } catch (e) {
    // Leaving the parts behind would hold disk on the server until they aged out.
    await api.delete(`/upload/chunked/${begun.upload_id}`).catch(() => {})
    throw e
  }
}

export function uploadFiles(files: File[], onProgress?: (pct: number) => void): Promise<UploadResult> {
  // Chunked automatically rather than refused: the size is the server's problem
  // to solve, not something to hand back to whoever is holding the file.
  const large = files.find((f) => f.size > PROXY_BODY_LIMIT)
  if (large) {
    if (files.length > 1) {
      return Promise.reject(new Error('Send large files one at a time.'))
    }
    return uploadInChunks(large, onProgress)
  }
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)

    const token = localStorage.getItem('access_token')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v1/upload')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(describeUploadFailure(xhr.status, xhr.responseText ?? '')))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

export function listMyFiles(): Promise<UploadedFile[]> {
  return api.get('/upload/files')
}

export function renameFile(sourceId: string, filename: string): Promise<void> {
  return api.patch(`/upload/files/${sourceId}`, { filename })
}

export function deleteFile(sourceId: string): Promise<void> {
  return api.delete(`/upload/files/${sourceId}`)
}

export function listAllFiles(): Promise<UploadedFile[]> {
  return api.get('/admin/files')
}

export function adminRenameFile(sourceId: string, filename: string): Promise<void> {
  return api.patch(`/admin/files/${sourceId}`, { filename })
}

export function adminDeleteFile(sourceId: string): Promise<void> {
  return api.delete(`/admin/files/${sourceId}`)
}
