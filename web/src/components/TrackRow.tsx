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

  const artistStr = track.artists?.map((a) => a.name).join(', ') ?? ''
  const originalArtist = track.override?.original_artist ?? null
  const isCover = track.is_cover

  return (
    <>
      <div
        className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          selected ? 'bg-accent/15' : isActive ? 'bg-accent/10' : 'hover:bg-white/5'
        }`}
        onClick={() => selectionActive && onSelect ? onSelect(track.id) : undefined}
        onDoubleClick={() => !selectionActive && playTrack(track, queue)}
      >
        {/* Left col: checkbox (selection mode) OR number→play (normal) */}
        <div className="w-8 flex-shrink-0 flex items-center justify-center">
          {selectionActive ? (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect?.(track.id) }}
              className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                selected ? 'bg-accent border-accent text-white' : 'border-[#555]'
              }`}
            >
              {selected && <Check size={11} strokeWidth={3} />}
            </button>
          ) : (
            <>
              {showNumber && (
                <span className={`text-sm tabular-nums group-hover:hidden ${isActive ? 'text-accent hidden' : 'text-[#555]'}`}>
                  {index != null ? index + 1 : ''}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); playTrack(track, queue) }}
                className={`${showNumber ? 'hidden group-hover:flex' : 'flex'} items-center justify-center text-white hover:text-accent ${isActive ? '!flex text-accent' : ''}`}
              >
                <Play size={14} fill="currentColor" />
              </button>
            </>
          )}
        </div>

        {/* Center: title + subtitle */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate leading-tight ${isActive ? 'text-accent' : ''}`}>
            {track.title}
          </p>
          {(showArtist || isCover) && (
            <p className="text-xs text-[#777] truncate leading-tight mt-0.5">
              {artistStr}
              {isCover && (
                <span className="text-[#555]">
                  {artistStr ? ' · ' : ''}
                  <span className="text-[#a855f7]/70">cover</span>
                  {originalArtist ? ` of ${originalArtist}` : ''}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Right: actions + duration */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!selectionActive && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
                className="opacity-0 group-hover:opacity-100 p-1 text-[#555] hover:text-white transition-all"
                title="Edit"
              >
                <Pencil size={12} />
              </button>
              {track.has_video && (
                <button
                  onClick={(e) => { e.stopPropagation(); setVideoOpen(true) }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-[#555] hover:text-accent transition-all"
                  title="Music video"
                >
                  <Video size={13} />
                </button>
              )}
            </>
          )}
          <span className="text-xs text-[#555] tabular-nums w-10 text-right">
            {formatDuration(track.duration)}
          </span>
        </div>
      </div>

      {videoOpen && <VideoModal track={track} onClose={() => setVideoOpen(false)} />}
      {editOpen && <TrackEditModal track={track} onClose={() => setEditOpen(false)} />}
    </>
  )
}
