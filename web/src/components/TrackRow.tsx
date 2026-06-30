import { useState } from 'react'
import { Play, Video, Pencil, Check, Heart } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePlayerStore } from '../store/player'
import { toggleFavorite } from '../api/tracks'
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
  const [hovered, setHovered] = useState(false)

  const queryClient = useQueryClient()
  const { mutate: favMutate } = useMutation({
    mutationFn: () => toggleFavorite(track.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['tracks'] })
      const prev = queryClient.getQueriesData<Track[]>({ queryKey: ['tracks'] })
      queryClient.setQueriesData<Track[]>({ queryKey: ['tracks'] }, (old) =>
        old?.map((t) =>
          t.id === track.id
            ? { ...t, is_favorited: !t.is_favorited, favorite_count: t.favorite_count + (t.is_favorited ? -1 : 1) }
            : t,
        ),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        for (const [key, data] of ctx.prev) queryClient.setQueryData(key, data)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tracks'] }),
  })

  const performer = track.artists?.map((a) => a.name).join(', ') ?? ''
  const originalArtist = track.override?.original_artist ?? null
  const isCover = track.is_cover
  const artistStr = isCover ? (originalArtist ?? performer) : (performer || originalArtist || '')

  return (
    <>
      <div
        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          selected ? 'bg-accent/15' : isActive ? 'bg-accent/10' : hovered ? 'bg-white/5' : ''
        }`}
        onClick={() => { if (selectionActive) onSelect?.(track.id) }}
        onDoubleClick={() => { if (!selectionActive) playTrack(track, queue) }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
                <span className={`text-sm tabular-nums ${isActive || hovered ? 'hidden' : 'text-[#555]'}`}>
                  {index != null ? index + 1 : ''}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); playTrack(track, queue) }}
                className={`${showNumber ? (hovered || isActive ? 'flex' : 'hidden') : 'flex'} items-center justify-center text-white hover:text-accent ${isActive ? 'text-accent' : ''}`}
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
              {isCover && performer && (
                <span className="text-[#777]">
                  {artistStr ? ' · ' : ''}
                  <span className="text-[#a855f7]">cover</span>
                  {` of ${performer}`}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Right: actions + duration */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {!selectionActive && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); favMutate() }}
                className={`p-1 transition-colors ${
                  track.is_favorited
                    ? 'text-red-400'
                    : hovered ? 'text-[#555] hover:text-red-400' : 'opacity-0 pointer-events-none'
                }`}
                title={track.is_favorited ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart size={12} fill={track.is_favorited ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
                className={`p-1 text-[#555] hover:text-white transition-colors ${hovered ? '' : 'opacity-0 pointer-events-none'}`}
                title="Edit"
              >
                <Pencil size={12} />
              </button>
              {track.has_video && (
                <button
                  onClick={(e) => { e.stopPropagation(); setVideoOpen(true) }}
                  className={`p-1 text-[#555] hover:text-accent transition-colors ${hovered ? '' : 'opacity-0 pointer-events-none'}`}
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
