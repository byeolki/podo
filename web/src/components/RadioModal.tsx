import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Radio, Plus, Trash2, Copy, Check, Shuffle } from 'lucide-react'
import { createRadioToken, getRadioTokens, revokeRadioToken, getRadioStreamUrl, type RadioToken } from '../api/broadcast'

interface Props {
  playlistId: string
  onClose: () => void
}

const FORMATS: Array<'mp3' | 'aac' | 'opus'> = ['mp3', 'aac', 'opus']

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
}

function TokenRow({ token, onRevoke }: { token: RadioToken; onRevoke: () => void }) {
  const [format, setFormat] = useState<'mp3' | 'aac' | 'opus'>('mp3')
  const [shuffle, setShuffle] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = getRadioStreamUrl(token.token, format, shuffle)

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="p-3 rounded-lg bg-[#181818] border border-[#222] space-y-2">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 bg-[#111] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs font-mono text-[#a1a1a1] truncate"
          onFocus={(e) => e.target.select()}
        />
        <button onClick={handleCopy} className="p-1.5 text-[#555] hover:text-white transition-colors flex-shrink-0" title="Copy URL">
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
        <button onClick={onRevoke} className="p-1.5 text-[#555] hover:text-red-400 transition-colors flex-shrink-0" title="Close this radio stream">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-2 py-0.5 rounded text-[10px] uppercase font-medium transition-colors ${
                  format === f ? 'bg-accent/20 text-accent' : 'bg-[#222] text-[#6b6b6b] hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShuffle((v) => !v)}
            title="Shuffle playback"
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              shuffle ? 'bg-accent/20 text-accent' : 'bg-[#222] text-[#6b6b6b] hover:text-white'
            }`}
          >
            <Shuffle size={10} /> Shuffle
          </button>
        </div>
        <span className="text-[10px] text-[#555]">
          Expires in {daysLeft(token.expires_at)}d
        </span>
      </div>
    </div>
  )
}

export default function RadioModal({ playlistId, onClose }: Props) {
  const qc = useQueryClient()

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['radio-tokens', playlistId],
    queryFn: () => getRadioTokens(playlistId),
  })

  const createMut = useMutation({
    mutationFn: () => createRadioToken(playlistId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['radio-tokens', playlistId] }),
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeRadioToken(playlistId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['radio-tokens', playlistId] }),
  })

  const activeTokens = tokens.filter((t) => !t.revoked_at)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] flex-shrink-0">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Radio size={15} className="text-accent" /> Radio URLs
          </span>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-2">
          <p className="text-xs text-[#6b6b6b] mb-1">
            A stream URL that loops this playlist forever. Paste it into VLC or another external player.
          </p>

          {isLoading ? (
            <div className="h-16 bg-[#181818] rounded-lg animate-pulse" />
          ) : activeTokens.length === 0 ? (
            <p className="text-xs text-[#555] text-center py-4">No radio URLs created yet</p>
          ) : (
            activeTokens.map((t) => (
              <TokenRow key={t.id} token={t} onRevoke={() => revokeMut.mutate(t.id)} />
            ))
          )}
        </div>

        <div className="border-t border-[#2a2a2a] px-4 py-3 flex-shrink-0">
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <Plus size={14} /> {createMut.isPending ? 'Creating…' : 'Generate new radio URL'}
          </button>
        </div>
      </div>
    </div>
  )
}
