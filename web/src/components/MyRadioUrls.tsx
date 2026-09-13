import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio as RadioIcon, Copy, Check, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMyRadioTokens, revokeRadioToken, getRadioStreamUrl } from '../api/broadcast'
import type { RadioToken } from '../api/broadcast'

const FORMATS = ['mp3', 'aac', 'opus'] as const
type Format = (typeof FORMATS)[number]

function status(token: RadioToken): { label: string; className: string } | null {
  if (token.revoked_at) return { label: 'Revoked', className: 'text-danger' }
  if (new Date(token.expires_at) < new Date()) return { label: 'Expired', className: 'text-ink-tertiary' }
  return null
}

/**
 * The radio URLs you've minted, across every playlist you own.
 *
 * They were only listable one playlist at a time, which meant the Radio page —
 * the obvious place to look for them — showed nothing, and the only complete
 * view was the admin tab in Settings. Someone who had made one had no way to
 * find it again.
 */
export default function MyRadioUrls() {
  const qc = useQueryClient()
  const [format, setFormat] = useState<Format>('mp3')
  const [copied, setCopied] = useState<string | null>(null)

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['my-radio-tokens'],
    queryFn: getMyRadioTokens,
  })

  const { mutate: revoke } = useMutation({
    mutationFn: (token: RadioToken) => revokeRadioToken(token.playlist_id, token.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-radio-tokens'] }),
  })

  async function copy(token: RadioToken) {
    await navigator.clipboard.writeText(getRadioStreamUrl(token.token, format))
    setCopied(token.id)
    setTimeout(() => setCopied((id) => (id === token.id ? null : id)), 1500)
  }

  const live = tokens.filter((t) => !status(t))

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <h2 className="text-base font-semibold">Your radio URLs</h2>
          <p className="text-xs text-ink-tertiary mt-0.5">
            Permanent streams anything can open — VLC, a speaker, a bot. Create one from a playlist.
          </p>
        </div>
        {live.length > 0 && (
          <div className="flex gap-1 bg-surface-2 border border-border rounded-lg p-0.5 flex-shrink-0">
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-2.5 py-1 rounded-md text-xs uppercase transition-colors ${
                  format === f ? 'bg-accent text-white' : 'text-ink-secondary hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="h-16 rounded-xl bg-surface-2 animate-pulse" />
      ) : tokens.length === 0 ? (
        <p className="text-sm text-ink-tertiary bg-surface-2 border border-border rounded-xl px-4 py-3">
          None yet — open a <Link to="/playlists" className="text-accent-text hover:underline">playlist</Link> and
          create one there.
        </p>
      ) : (
        <div className="rounded-xl bg-surface-2 border border-border divide-y divide-border">
          {tokens.map((token) => {
            const state = status(token)
            return (
              <div key={token.id} className="flex items-center gap-3 px-4 py-3">
                <RadioIcon size={14} className={state ? 'text-ink-faint' : 'text-accent-text'} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/playlists/${token.playlist_id}`}
                    className="text-sm font-medium hover:underline truncate block"
                  >
                    {token.playlist_name ?? 'Playlist'}
                  </Link>
                  <p className="text-xs text-ink-faint truncate">
                    {state
                      ? <span className={state.className}>{state.label}</span>
                      : getRadioStreamUrl(token.token, format)}
                  </p>
                </div>
                {!state && (
                  <button
                    onClick={() => copy(token)}
                    className="p-1.5 text-ink-tertiary hover:text-white transition-colors"
                    title="Copy URL"
                  >
                    {copied === token.id ? <Check size={13} className="text-accent-text" /> : <Copy size={13} />}
                  </button>
                )}
                <button
                  onClick={() => revoke(token)}
                  disabled={!!token.revoked_at}
                  className="p-1.5 text-ink-tertiary hover:text-danger transition-colors disabled:opacity-30"
                  title="Revoke"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
