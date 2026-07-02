import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload as UploadIcon, X, Check, Pencil, Trash2, FileAudio, FileVideo, Music, Download } from 'lucide-react'
import {
  uploadFiles as uploadFilesApi,
  listMyFiles,
  renameFile,
  deleteFile,
  type UploadedFile,
} from '../api/upload'
import { formatBytes } from '../api/admin'
import { startDownload, getDownloads } from '../api/library'
import { useAuthStore } from '../store/auth'

const DOWNLOAD_STATUS_STYLE: Record<string, string> = {
  done: 'text-green-400 bg-green-400/10',
  running: 'text-blue-400 bg-blue-400/10',
  failed: 'text-red-400 bg-red-400/10',
  pending: 'text-yellow-400 bg-yellow-400/10',
}

function DownloadSection() {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [audioOnly, setAudioOnly] = useState(true)

  const { data: jobs = [] } = useQuery({ queryKey: ['downloads'], queryFn: getDownloads, refetchInterval: 2000 })

  const downloadMut = useMutation({
    mutationFn: () => startDownload(url, audioOnly),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downloads'] }); setUrl('') },
  })

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-[#a1a1a1] uppercase tracking-wider mb-2">Download from URL</h3>
      <div className="flex gap-2 mb-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          className="flex-1 bg-[#181818] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent font-mono"
        />
        <button
          onClick={() => downloadMut.mutate()}
          disabled={!url || downloadMut.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium disabled:opacity-50"
        >
          <Download size={14} /> Download
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-[#a1a1a1] cursor-pointer mb-3">
        <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} className="accent-accent" />
        Audio only
      </label>

      {jobs.length > 0 && (
        <div className="space-y-1.5">
          {jobs.map((job) => (
            <div key={job.id} className="p-3 rounded-lg bg-[#181818] border border-[#222]">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOWNLOAD_STATUS_STYLE[job.status] ?? 'text-[#6b6b6b] bg-[#222]'}`}>
                  {job.status}
                </span>
                {job.status === 'running' && (
                  <span className="text-xs text-[#a1a1a1]">{job.progress.toFixed(0)}%</span>
                )}
              </div>
              <p className="text-xs font-mono text-[#6b6b6b] truncate">{job.url}</p>
              {job.error && <p className="text-xs text-red-400 mt-0.5">{job.error}</p>}
              {job.status === 'running' && (
                <div className="mt-2 h-1 bg-[#333] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FileRow({ file, onRename, onDelete }: {
  file: UploadedFile
  onRename: (sourceId: string, name: string) => void
  onDelete: (sourceId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(() => {
    const ext = file.filename.lastIndexOf('.')
    return ext > 0 ? file.filename.slice(0, ext) : file.filename
  })
  const ext = file.filename.lastIndexOf('.') > 0 ? file.filename.slice(file.filename.lastIndexOf('.')) : ''
  const isVideo = ['.mp4', '.m4v', '.mkv'].includes(ext.toLowerCase())

  const handleRename = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed + ext !== file.filename) {
      onRename(file.source_id, trimmed + ext)
    }
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#181818] border border-[#222] hover:border-[#333] transition-colors">
      <div className="flex-shrink-0 text-[#555]">
        {isVideo ? <FileVideo size={16} /> : <FileAudio size={16} />}
      </div>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') { setEditing(false); setName(file.filename.slice(0, file.filename.lastIndexOf('.'))) }
              }}
              className="flex-1 bg-[#111] border border-accent rounded px-2 py-0.5 text-sm focus:outline-none"
            />
            <span className="text-sm text-[#555]">{ext}</span>
            <button onClick={handleRename} className="p-1 text-green-400 hover:text-green-300 transition-colors">
              <Check size={13} />
            </button>
            <button onClick={() => setEditing(false)} className="p-1 text-[#555] hover:text-white transition-colors">
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium truncate">{file.track_title || file.filename}</p>
            <p className="text-xs text-[#555] truncate font-mono">{file.filename}</p>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {file.file_size != null && (
          <span className="text-xs text-[#555]">{formatBytes(file.file_size)}</span>
        )}
        {!editing && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditing(true)}
              className="p-1 text-[#555] hover:text-white transition-colors"
              title="Rename"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => onDelete(file.source_id)}
              className="p-1 text-[#555] hover:text-red-400 transition-colors"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface UploadItem {
  id: string
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

export default function Upload() {
  const qc = useQueryClient()
  const role = useAuthStore((s) => s.role)
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: myFiles = [], isLoading } = useQuery({
    queryKey: ['my-files'],
    queryFn: listMyFiles,
  })

  const renameMut = useMutation({
    mutationFn: ({ sourceId, filename }: { sourceId: string; filename: string }) =>
      renameFile(sourceId, filename),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-files'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (sourceId: string) => deleteFile(sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-files'] }),
  })

  const processFiles = useCallback(async (files: File[]) => {
    const ALLOWED = new Set(['.mp3', '.m4a', '.flac', '.aac', '.wav', '.ogg', '.opus', '.mp4', '.m4v', '.mkv'])
    const valid = files.filter((f) => {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
      return ALLOWED.has(ext)
    })
    if (!valid.length) return

    const newItems: UploadItem[] = valid.map((f) => ({
      id: `${Date.now()}_${f.name}`,
      file: f,
      progress: 0,
      status: 'pending',
    }))
    setItems((prev) => [...prev, ...newItems])

    for (const item of newItems) {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'uploading' } : i))
      try {
        await uploadFilesApi([item.file], (pct) => {
          setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, progress: pct } : i))
        })
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'done', progress: 100 } : i))
      } catch (e: unknown) {
        setItems((prev) => prev.map((i) =>
          i.id === item.id ? { ...i, status: 'error', error: (e as Error).message } : i,
        ))
      }
    }
    qc.invalidateQueries({ queryKey: ['my-files'] })
  }, [qc])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    processFiles(files)
  }, [processFiles])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    processFiles(files)
    e.target.value = ''
  }

  const clearDone = () => setItems((prev) => prev.filter((i) => i.status !== 'done'))

  const handleDelete = (sourceId: string) => {
    if (confirm('Delete this file from the library?')) {
      deleteMut.mutate(sourceId)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Upload</h1>
        <p className="text-sm text-[#a1a1a1] mt-0.5">Add music files to your library</p>
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors mb-6 ${
          dragging ? 'border-accent bg-accent/5' : 'border-[#333] hover:border-[#555]'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".mp3,.m4a,.flac,.aac,.wav,.ogg,.opus,.mp4,.m4v,.mkv"
          className="hidden"
          onChange={handleFileInput}
        />
        <UploadIcon size={32} className="mx-auto mb-3 text-[#555]" />
        <p className="text-sm font-medium">Drop files here or click to browse</p>
        <p className="text-xs text-[#555] mt-1">MP3, M4A, FLAC, AAC, WAV, OGG, OPUS, MP4, MKV — max 500MB each</p>
      </div>

      {role === 'admin' && <DownloadSection />}

      {items.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#a1a1a1] uppercase tracking-wider">Uploading</h3>
            <button onClick={clearDone} className="text-xs text-[#555] hover:text-white transition-colors">
              Clear done
            </button>
          </div>
          <div className="space-y-1.5">
            {items.map((item) => (
              <div key={item.id} className="p-3 rounded-lg bg-[#181818] border border-[#222]">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm truncate flex-1">{item.file.name}</span>
                  {item.status === 'done' && <Check size={14} className="text-green-400 flex-shrink-0" />}
                  {item.status === 'error' && <X size={14} className="text-red-400 flex-shrink-0" />}
                  {(item.status === 'pending' || item.status === 'uploading') && (
                    <span className="text-xs text-[#555]">{item.progress}%</span>
                  )}
                </div>
                {item.status === 'uploading' && (
                  <div className="h-1 bg-[#333] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
                {item.status === 'error' && (
                  <p className="text-xs text-red-400">{item.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-[#a1a1a1] uppercase tracking-wider mb-2">My Files</h3>
        {isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-[#181818] animate-pulse" />
            ))}
          </div>
        ) : myFiles.length === 0 ? (
          <div className="text-center py-10 text-[#555]">
            <Music size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No uploaded files yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {myFiles.map((file) => (
              <FileRow
                key={file.source_id}
                file={file}
                onRename={(sourceId, filename) => renameMut.mutate({ sourceId, filename })}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
