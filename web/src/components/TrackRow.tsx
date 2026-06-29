import { useState } from 'react'
import { Play, Video, Pencil, Check } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import type { Track } from '../api/tracks'
import { formatDuration } from '../api/tracks'
import VideoModal from './VideoModal'
import TrackEditModal from './TrackEditModal'

interface Props {
  track: Track
  index?: number
  queue?: Track[]
  showArtist?: boolean
  showNumber?: boolean
  selected?: boolean
  selectionActive?: boolean
  onSelect?: (id: string) => void
}

export default function TrackRow({
  track, index, queue,
  showArtist = true, showNumber = false,
  selected = false, selectionActive = false, onSelect,
}: Props) {
  const playTrack = usePlayerStore((s) => s.playTrack)
  const currentTrack = usePlayerStore((s) => s.queue[s.currentIndex])
  const isActive = currentTrack?.id === track.id
  const [videoOpen, setVideoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  function handleRowClick(e: React.MouseEvent) {
    if (selectionActive && onSelect) {
      e.preventDefault()
      onSelect(track.id)
    }
  }

  return (
    <>
      <div
        className={`group flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-colors ${
          selected ? 'bg-accent/15' : isActive ? 'bg-accent/10' : 'hover:bg-white/5'
        }`}
        onClick={handleRowClick}
        onDoubleClick={() => !selectionActive && playTrack(track, queue)}
      >
        <div className="w-8 flex-shrink-0 flex items-center justify-center">
          {onSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(track.id) }}
              className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-all ${
                selected
                  ? 'bg-accent border-accent'
                  : selectionActive
                  ? 'border-[#555] group-hover:border-[#888]'
                  : 'border-transparent opacity-0 group-hover:opacity-100 group-hover:border-[#555]'
              }`}
            >
              {selected && <Check size={11} strokeWidth={3} />}
            </button>
          )}
          {!selectionActive && showNumber && (
            <span className={`text-sm tabular-nums group-hover:hidden ${isActive ? 'text-accent hidden' : 'text-[#6b6b6b]'} ${onSelect ? 'hidden' : ''}`}>
              {index != null ? index + 1 : ''}
            </span>
          )}
          {!selectionActive && (
            <button
              onClick={(e) => { e.stopPropagation(); playTrack(track, queue) }}
              className={`${showNumber ? 'hidden group-hover:flex' : 'flex'} items-center justify-center text-white hover:text-accent ${isActive ? '!flex text-accent' : ''}`}
            >
              <Play size={14} fill="currentColor" />
            </button>
          )}
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

        <div className="flex items-center gap-2 flex-shrink-0">
          {!selectionActive && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
                className="opacity-0 group-hover:opacity-100 text-[#6b6b6b] hover:text-white transition-all"
                title="Edit track"
              >
                <Pencil size={13} />
              </button>
              {track.has_video && (
                <button
                  onClick={(e) => { e.stopPropagation(); setVideoOpen(true) }}
                  className="opacity-0 group-hover:opacity-100 text-[#6b6b6b] hover:text-accent transition-all"
                  title="Watch music video"
                >
                  <Video size={14} />
                </button>
              )}
            </>
          )}
          <span className="text-xs text-[#6b6b6b] tabular-nums">
            {formatDuration(track.duration)}
          </span>
        </div>
      </div>

      {videoOpen && <VideoModal track={track} onClose={() => setVideoOpen(false)} />}
      {editOpen && <TrackEditModal track={track} onClose={() => setEditOpen(false)} />}
    </>
  )
}
