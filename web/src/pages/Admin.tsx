import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Folder, Plus, Trash2, RefreshCw, Download, Users, Activity,
  HardDrive, Shield, X, Pencil, Check, FileAudio, FileVideo, Files, type LucideIcon,
} from 'lucide-react'
import {
  getHealth, getUsers, getStorage, clearTranscodeCache, verifyIntegrity, formatBytes,
} from '../api/admin'
import { getRoots, addRoot, removeRoot, triggerScan, getScanJobs, startDownload, getDownloads } from '../api/library'
import { createInvite } from '../api/auth'
import { listAllFiles, adminRenameFile, adminDeleteFile, type UploadedFile } from '../api/upload'

type Tab = 'library' | 'downloads' | 'users' | 'health' | 'files'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'text-green-400 bg-green-400/10',
    running: 'text-blue-400 bg-blue-400/10',
    failed: 'text-red-400 bg-red-400/10',
    pending: 'text-yellow-400 bg-yellow-400/10',
    done: 'text-green-400 bg-green-400/10',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? 'text-[#6b6b6b] bg-[#222]'}`}>
      {status}
    </span>
  )
}

function LibraryTab() {
  const qc = useQueryClient()
  const [newPath, setNewPath] = useState('')

  const { data: roots = [] } = useQuery({ queryKey: ['library-roots'], queryFn: getRoots })
  const { data: scans = [] } = useQuery({ queryKey: ['scan-jobs'], queryFn: getScanJobs, refetchInterval: 3000 })

  const addMut = useMutation({
    mutationFn: () => addRoot(newPath),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-roots'] }); setNewPath('') },
  })
  const removeMut = useMutation({
    mutationFn: removeRoot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library-roots'] }),
  })
  const scanMut = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-jobs'] }),
  })
  const verifyMut = useMutation({ mutationFn: verifyIntegrity })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-3">Library Roots</h3>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="/path/to/music"
            className="flex-1 bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && newPath && addMut.mutate()}
          />
          <button
            onClick={() => addMut.mutate()}
            disabled={!newPath || addMut.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium disabled:opacity-50"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        <div className="space-y-1.5">
          {roots.map((root) => (
            <div key={root.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#181818] border border-[#222]">
              <Folder size={16} className="text-[#555] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate font-mono">{root.path}</p>
                <p className="text-xs text-[#6b6b6b]">
                  {root.last_scan_at ? `Last scanned ${new Date(root.last_scan_at).toLocaleDateString()}` : 'Never scanned'}
                </p>
              </div>
              <button
                onClick={() => scanMut.mutate(root.id)}
                disabled={scanMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-xs text-[#a1a1a1] transition-colors"
              >
                <RefreshCw size={12} className={scanMut.isPending ? 'animate-spin' : ''} /> Scan
              </button>
              <button
                onClick={() => removeMut.mutate(root.id)}
                className="text-[#6b6b6b] hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {roots.length === 0 && (
            <p className="text-sm text-[#6b6b6b] text-center py-6">No library roots configured</p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">Integrity</h3>
          <button
            onClick={() => verifyMut.mutate()}
            disabled={verifyMut.isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-xs text-[#a1a1a1] transition-colors"
          >
            <Shield size={12} /> Verify Library
          </button>
        </div>
        {verifyMut.data && (
          <div className="p-3 rounded-lg bg-[#181818] border border-[#222] text-sm">
            <p className={verifyMut.data.missing_count > 0 ? 'text-red-400' : 'text-green-400'}>
              {verifyMut.data.missing_count === 0 ? 'All files OK' : `${verifyMut.data.missing_count} files missing`}
            </p>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold mb-3">Recent Scans</h3>
        <div className="space-y-1.5">
          {scans.slice(0, 10).map((scan) => (
            <div key={scan.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#181818] border border-[#222]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <StatusBadge status={scan.status} />
                  <span className="text-xs text-[#6b6b6b]">{new Date(scan.started_at).toLocaleString()}</span>
                </div>
                <p className="text-xs text-[#a1a1a1]">
                  {scan.processed_files}/{scan.total_files} files · +{scan.added} added · +{scan.updated} updated
                </p>
                {scan.error && <p className="text-xs text-red-400 mt-0.5 truncate">{scan.error}</p>}
              </div>
            </div>
          ))}
          {scans.length === 0 && <p className="text-sm text-[#6b6b6b] text-center py-4">No scans yet</p>}
        </div>
      </div>
    </div>
  )
}

function DownloadsTab() {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [audioOnly, setAudioOnly] = useState(true)

  const { data: jobs = [] } = useQuery({ queryKey: ['downloads'], queryFn: getDownloads, refetchInterval: 2000 })

  const downloadMut = useMutation({
    mutationFn: () => startDownload(url, audioOnly),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downloads'] }); setUrl('') },
  })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-3">Download via yt-dlp</h3>
        <div className="flex gap-2 mb-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="flex-1 bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent font-mono"
          />
          <button
            onClick={() => downloadMut.mutate()}
            disabled={!url || downloadMut.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium disabled:opacity-50"
          >
            <Download size={14} /> Download
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#a1a1a1] cursor-pointer">
          <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} className="accent-accent" />
          Audio only
        </label>
      </div>

      <div>
        <h3 className="text-base font-semibold mb-3">Jobs</h3>
        <div className="space-y-1.5">
          {jobs.map((job) => (
            <div key={job.id} className="p-3 rounded-lg bg-[#181818] border border-[#222]">
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status={job.status} />
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
          {jobs.length === 0 && <p className="text-sm text-[#6b6b6b] text-center py-4">No download jobs</p>}
        </div>
      </div>
    </div>
  )
}

function UsersTab() {
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: getUsers })
  const inviteMut = useMutation({ mutationFn: createInvite })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Users</h3>
        <button
          onClick={() => inviteMut.mutate()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Generate Invite
        </button>
      </div>

      {inviteMut.data && (
        <div className="p-3 rounded-lg bg-accent/10 border border-accent/30">
          <p className="text-xs text-[#a1a1a1] mb-1">Invite token (share with new user):</p>
          <p className="text-sm font-mono break-all text-accent">{inviteMut.data.invite_token}</p>
        </div>
      )}

      <div className="space-y-1.5">
        {users.map((user) => (
          <div key={user.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#181818] border border-[#222]">
            <div className="w-8 h-8 rounded-full bg-[#222] flex items-center justify-center text-sm font-medium flex-shrink-0">
              {user.name[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-[#6b6b6b]">{user.email}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${user.role === 'admin' ? 'bg-accent/10 text-accent' : 'bg-[#222] text-[#6b6b6b]'}`}>
              {user.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HealthTab() {
  const qc = useQueryClient()
  const { data: health, isLoading } = useQuery({ queryKey: ['health'], queryFn: getHealth, refetchInterval: 10000 })
  const { data: storage } = useQuery({ queryKey: ['storage'], queryFn: getStorage })
  const clearCacheMut = useMutation({
    mutationFn: clearTranscodeCache,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage'] }),
  })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-3">System</h3>
        {isLoading ? (
          <div className="h-32 bg-[#181818] rounded-xl animate-pulse" />
        ) : health ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Status', value: health.status, accent: health.status === 'ok' },
              { label: 'Tracks', value: health.tracks.toString() },
              { label: 'Sources', value: health.sources.toString() },
              { label: 'Users', value: health.users.toString() },
              { label: 'Uptime', value: `${Math.floor(health.uptime_seconds / 3600)}h ${Math.floor((health.uptime_seconds % 3600) / 60)}m` },
              { label: 'Node', value: health.node_version },
              { label: 'Memory', value: formatBytes(health.memory.heapUsed) },
            ].map(({ label, value, accent }) => (
              <div key={label} className="p-3 rounded-lg bg-[#181818] border border-[#222]">
                <p className="text-xs text-[#6b6b6b] uppercase tracking-wider mb-1">{label}</p>
                <p className={`text-lg font-semibold ${accent ? 'text-green-400' : ''}`}>{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {storage && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">Storage</h3>
            <button
              onClick={() => clearCacheMut.mutate()}
              disabled={clearCacheMut.isPending}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-xs text-[#a1a1a1] transition-colors"
            >
              <Trash2 size={12} /> Clear Transcode Cache
            </button>
          </div>

          {'disk' in storage && (storage as { disk: { total_bytes: number; used_bytes: number; free_bytes: number } }).disk.total_bytes > 0 && (() => {
            const disk = (storage as { disk: { total_bytes: number; used_bytes: number; free_bytes: number } }).disk
            const pct = Math.round((disk.used_bytes / disk.total_bytes) * 100)
            return (
              <div className="mb-3 p-3 rounded-lg bg-[#181818] border border-[#222]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Disk</span>
                  <span className="text-xs text-[#a1a1a1]">{formatBytes(disk.used_bytes)} / {formatBytes(disk.total_bytes)}</span>
                </div>
                <div className="h-1.5 bg-[#333] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-accent'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-[#555] mt-1">{formatBytes(disk.free_bytes)} free</p>
              </div>
            )
          })()}

          <div className="space-y-1.5">
            {[
              { label: 'Uploads', path: storage.upload_dir.path, size_bytes: storage.upload_dir.size_bytes },
              { label: 'Artwork', path: storage.artwork_dir.path, size_bytes: storage.artwork_dir.size_bytes },
              { label: 'Transcode Cache', path: storage.transcode_cache.path, size_bytes: storage.transcode_cache.size_bytes },
            ].map(({ label, path, size_bytes }) => (
              <div key={label} className="flex items-center gap-3 p-3 rounded-lg bg-[#181818] border border-[#222]">
                <HardDrive size={14} className="text-[#555] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs font-mono text-[#6b6b6b] truncate">{path}</p>
                </div>
                <span className="text-sm text-[#a1a1a1] flex-shrink-0">{formatBytes(size_bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AdminFileRow({ file, onRename, onDelete }: {
  file: UploadedFile
  onRename: (sourceId: string, name: string) => void
  onDelete: (sourceId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const ext = file.filename.lastIndexOf('.') > 0 ? file.filename.slice(file.filename.lastIndexOf('.')) : ''
  const [name, setName] = useState(() => ext ? file.filename.slice(0, file.filename.lastIndexOf('.')) : file.filename)
  const isVideo = ['.mp4', '.m4v', '.mkv'].includes(ext.toLowerCase())

  const handleRename = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed + ext !== file.filename) onRename(file.source_id, trimmed + ext)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#181818] border border-[#222] hover:border-[#333] transition-colors">
      <div className="flex-shrink-0 text-[#555]">
        {isVideo ? <FileVideo size={15} /> : <FileAudio size={15} />}
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
                if (e.key === 'Escape') setEditing(false)
              }}
              className="flex-1 bg-[#111] border border-accent rounded px-2 py-0.5 text-sm focus:outline-none"
            />
            <span className="text-sm text-[#555]">{ext}</span>
            <button onClick={handleRename} className="p-1 text-green-400 hover:text-green-300"><Check size={13} /></button>
            <button onClick={() => setEditing(false)} className="p-1 text-[#555] hover:text-white"><X size={13} /></button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium truncate">{file.track_title || file.filename}</p>
            <p className="text-xs text-[#555] truncate font-mono">{file.filename} {file.added_by_name && <span>· {file.added_by_name}</span>}</p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {file.file_size != null && <span className="text-xs text-[#555]">{formatBytes(file.file_size)}</span>}
        {!editing && (
          <div className="flex items-center gap-1">
            <button onClick={() => setEditing(true)} className="p-1 text-[#555] hover:text-white transition-colors" title="Rename"><Pencil size={13} /></button>
            <button onClick={() => onDelete(file.source_id)} className="p-1 text-[#555] hover:text-red-400 transition-colors" title="Delete"><Trash2 size={13} /></button>
          </div>
        )}
      </div>
    </div>
  )
}

function FilesTab() {
  const qc = useQueryClient()
  const { data: files = [], isLoading } = useQuery({ queryKey: ['admin-files'], queryFn: listAllFiles })

  const renameMut = useMutation({
    mutationFn: ({ sourceId, filename }: { sourceId: string; filename: string }) => adminRenameFile(sourceId, filename),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-files'] }),
  })
  const deleteMut = useMutation({
    mutationFn: (sourceId: string) => adminDeleteFile(sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-files'] }),
  })

  const handleDelete = (sourceId: string) => {
    if (confirm('Delete this file from disk and library?')) deleteMut.mutate(sourceId)
  }

  const totalSize = files.reduce((acc, f) => acc + (f.file_size ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Uploaded Files</h3>
          <p className="text-xs text-[#555] mt-0.5">{files.length} files · {formatBytes(totalSize)}</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['admin-files'] })}
          className="p-1.5 text-[#555] hover:text-white transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-[#181818] animate-pulse" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-12 text-[#555]">
          <Files size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No uploaded files</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {files.map((file) => (
            <AdminFileRow
              key={file.source_id}
              file={file}
              onRename={(sourceId, filename) => renameMut.mutate({ sourceId, filename })}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>('library')

  const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: 'library', label: 'Library', icon: Folder },
    { id: 'downloads', label: 'Downloads', icon: Download },
    { id: 'files', label: 'Files', icon: Files },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'health', label: 'Health', icon: Activity },
  ]

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Admin</h1>

      <div className="flex gap-1 mb-6 bg-[#181818] p-1 rounded-lg w-fit border border-[#222]">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === id ? 'bg-[#2a2a2a] text-white' : 'text-[#a1a1a1] hover:text-white'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'library' && <LibraryTab />}
      {tab === 'downloads' && <DownloadsTab />}
      {tab === 'files' && <FilesTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'health' && <HealthTab />}
    </div>
  )
}
