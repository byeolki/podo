import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, CheckCircle2, RefreshCw, CloudOff, ExternalLink } from 'lucide-react'
import { getUpdateStatus, recheckUpdate } from '../api/admin'

/**
 * Tells the operator when a newer Podo has been released, and how to take it.
 * Silent about anything else: no update is the boring, quiet state.
 */
export default function UpdateCard() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['update-status'],
    queryFn: getUpdateStatus,
    // The server caches for 12h; there's nothing to gain from asking often.
    staleTime: 60 * 60 * 1000,
  })

  const recheck = useMutation({
    mutationFn: recheckUpdate,
    onSuccess: (fresh) => qc.setQueryData(['update-status'], fresh),
  })

  if (isLoading) return <div className="h-20 rounded-xl bg-surface-2 animate-pulse" />
  if (!data) return null

  const available = data.update_available && data.latest

  return (
    <div
      className={`p-4 rounded-xl border ${
        available ? 'bg-accent/10 border-accent/40' : 'bg-surface-2 border-border'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {available ? (
            <ArrowUpCircle size={18} className="text-accent-text" />
          ) : data.enabled ? (
            <CheckCircle2 size={18} className="text-success" />
          ) : (
            <CloudOff size={18} className="text-ink-faint" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {available
              ? `Podo ${data.latest} is available`
              : data.enabled
                ? `Podo ${data.current} — up to date`
                : `Podo ${data.current}`}
          </p>

          {available ? (
            <>
              <p className="text-xs text-ink-tertiary mt-0.5">
                You're on {data.current}
                {data.published_at ? ` · released ${new Date(data.published_at).toLocaleDateString()}` : ''}
              </p>
              <pre className="mt-2 p-2 rounded-lg bg-surface-1 border border-border text-xs font-mono text-ink-secondary overflow-x-auto">
                docker compose pull &amp;&amp; docker compose up -d
              </pre>
              {data.notes && (
                <details className="mt-2">
                  <summary className="text-xs text-ink-tertiary cursor-pointer hover:text-white">
                    Release notes
                  </summary>
                  <p className="mt-1 text-xs text-ink-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {data.notes}
                  </p>
                </details>
              )}
            </>
          ) : (
            <p className="text-xs text-ink-tertiary mt-0.5">
              {data.enabled
                ? data.error
                  ? `Couldn't check: ${data.error}`
                  : data.checked_at
                    ? `Checked ${new Date(data.checked_at).toLocaleString()}`
                    : 'Not checked yet'
                : 'Update checks are disabled (UPDATE_CHECK_ENABLED=false)'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {available && data.release_url && (
            <a
              href={data.release_url}
              target="_blank"
              rel="noopener noreferrer"
              title="View the release"
              className="p-1.5 text-ink-faint hover:text-white transition-colors"
            >
              <ExternalLink size={14} />
            </a>
          )}
          {data.enabled && (
            <button
              onClick={() => recheck.mutate()}
              disabled={recheck.isPending}
              title="Check now"
              className="p-1.5 text-ink-faint hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={recheck.isPending ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
