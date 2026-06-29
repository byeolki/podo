import { Play } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import type { Track } from '../api/tracks'
import { formatDuration } from '../api/tracks'

interface Props {
  track: Track
  index?: number
  queue?: Track[]
  showArtist?: boolean
  showNumber?: boolean
}

export default function TrackRow({ track, index, queue, showArtist = true, showNumber = false }: Props) {
  const playTrack = usePlayerStore((s) => s.playTrack)
  const currentTrack = usePlayerStore((s) => s.queue[s.currentIndex])
  const isActive = currentTrack?.id === track.id

  return (
    <div
      className={`group flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 cursor-pointer ${
        isActive ? 'bg-accent/10' : ''
      }`}
      onDoubleClick={() => playTrack(track, queue)}
    >
      <div className="w-8 flex-shrink-0 flex items-center justify-center">
        {showNumber ? (
          <span className={`text-sm tabular-nums group-hover:hidden ${isActive ? 'text-accent hidden' : 'text-[#6b6b6b]'}`}>
            {index != null ? index + 1 : ''}
          </span>
        ) : null}
        <button
          onClick={() => playTrack(track, queue)}
          className={`${showNumber ? 'hidden group-hover:flex' : 'flex'} items-center justify-center text-white hover:text-accent ${isActive ? '!flex text-accent' : ''}`}
        >
          <Play size={14} fill="currentColor" />
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isActive ? 'text-accent' : ''}`}>
          {track.title}
        </p>
        {showArtist && track.artists && track.artists.length > 0 && (
          <p className="text-xs text-[#a1a1a1] truncate">
            {track.artists.map((a) => a.name).join(', ')}
          </p>
        )}
      </div>

      <span className="text-xs text-[#6b6b6b] tabular-nums flex-shrink-0">
        {formatDuration(track.duration)}
      </span>
    </div>
  )
}
