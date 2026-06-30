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
}

export interface UploadResult {
  uploaded: Array<{ filename: string; path?: string; error?: string }>
}

export function uploadFiles(files: File[], onProgress?: (pct: number) => void): Promise<UploadResult> {
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
        reject(new Error(xhr.responseText || `HTTP ${xhr.status}`))
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
