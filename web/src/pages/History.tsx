import { useQuery } from '@tanstack/react-query'
import { History as HistoryIcon, Clock } from 'lucide-react'
import { getHistory, getStats } from '../api/history'
import { formatDuration } from '../api/tracks'

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return 'Just now'
}

export default function History() {
  const { data: history = [] } = useQuery({
    queryKey: ['history'],
    queryFn: getHistory,
  })

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  })

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-semibold mb-6">History</h1>

      {stats && (
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="p-4 rounded-xl bg-[#181818] border border-[#222]">
            <p className="text-xs text-[#6b6b6b] uppercase tracking-wider mb-1">Total Listen Time</p>
            <p className="text-2xl font-semibold">{formatDuration(stats.total_listen_duration * 1000)}</p>
          </div>
          <div className="p-4 rounded-xl bg-[#181818] border border-[#222]">
            <p className="text-xs text-[#6b6b6b] uppercase tracking-wider mb-1">Plays</p>
            <p className="text-2xl font-semibold">{history.length}</p>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="text-center py-20 text-[#6b6b6b]">
          <HistoryIcon size={40} className="mx-auto mb-3" />
          <p className="text-lg font-medium">No history yet</p>
          <p className="text-sm mt-1">Start listening to see your history here</p>
        </div>
      ) : (
        <div className="space-y-1">
          {history.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5">
              <Clock size={14} className="text-[#555] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#a1a1a1] truncate">{entry.track_id}</p>
                <p className="text-xs text-[#6b6b6b]">{formatDuration(entry.played_duration * 1000)} listened</p>
              </div>
              <span className="text-xs text-[#6b6b6b] flex-shrink-0">{formatRelativeTime(entry.played_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
