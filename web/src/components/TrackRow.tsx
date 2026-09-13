import { useState, useMemo } from 'react'
import { Play, Video, Pencil, Check, Heart } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePlayerStore } from '../store/player'
import { toggleFavorite } from '../api/tracks'
import type { Track } from '../api/tracks'
import { formatDuration, artistLine } from '../api/tracks'
import VideoModal from './VideoModal'
import TrackEditModal from './TrackEditModal'
import ArtworkImage from './ArtworkImage'
import { getArtworkUrl } from '../api/client'

/**
 * Row actions stay out of the way until the row is hovered — or until something
 * inside it takes keyboard focus. Without the focus half, tabbing moved through
 * buttons that were still at `opacity-0`, so a keyboard user was operating
 * controls they could not see.
 */
const REVEAL =
  'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto ' +
  'group-focus-within:opacity-100 group-focus-within:pointer-events-auto ' +
  '[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto'

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
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isActive = currentTrack?.id === track.id
  const isActivelyPlaying = isActive && isPlaying
  const [videoOpen, setVideoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const isTouch = useMemo(() => window.matchMedia('(hover: none)').matches, [])

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

  const isCover = track.is_cover
  const { lead, coverPerformers } = artistLine(track)

  return (
    <>
      <div
        className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors duration-150 focus-within:bg-white/[0.06] ${
          selected ? 'bg-accent/15' : isActive ? 'bg-accent/10' : 'hover:bg-white/[0.06]'
        }`}
        onClick={() => {
          if (selectionActive) onSelect?.(track.id)
          else if (isTouch) playTrack(track, queue)
        }}
        onDoubleClick={() => { if (!selectionActive) playTrack(track, queue) }}
      >
        {/* Left col: checkbox (selection mode) OR number→play (normal) */}
        <div className="w-8 flex-shrink-0 grid items-center justify-items-start">
          {selectionActive ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`Select ${track.title}`}
              onClick={(e) => { e.stopPropagation(); onSelect?.(track.id) }}
              className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                selected ? 'bg-accent border-accent text-white' : 'border-ink-faint'
              }`}
            >
              {selected && <Check size={11} strokeWidth={3} aria-hidden="true" />}
            </button>
          ) : (
            <>
              {/* Number, equalizer and play button share one cell: the first two are
                  decoration that steps aside for the control. The button is never
                  `hidden`, because display:none also removes it from the tab order —
                  which left a keyboard user with no way to play a track at all. */}
              {showNumber && (
                <span
                  aria-hidden="true"
                  className={`col-start-1 row-start-1 text-meta tabular-nums text-ink-faint ${
                    isActive ? 'hidden' : 'group-hover:invisible group-focus-within:invisible'
                  }`}
                >
                  {index != null ? index + 1 : ''}
                </span>
              )}
              {isActivelyPlaying && (
                <span
                  aria-hidden="true"
                  className="col-start-1 row-start-1 flex items-end gap-0.5 h-3.5 group-hover:invisible group-focus-within:invisible"
                >
                  <span className="eq-bar" style={{ animationDelay: '0ms' }} />
                  <span className="eq-bar" style={{ animationDelay: '180ms' }} />
                  <span className="eq-bar" style={{ animationDelay: '360ms' }} />
                </span>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); playTrack(track, queue) }}
                aria-label={`Play ${track.title}`}
                className={`press col-start-1 row-start-1 flex items-center justify-center text-white transition-[scale,color] duration-150 hover:text-accent-text ${
                  isActive ? 'text-accent-text' : ''
                } ${
                  showNumber || isActivelyPlaying
                    ? 'invisible group-hover:visible group-focus-within:visible focus-visible:visible'
                    : ''
                }`}
              >
                <Play size={14} fill="currentColor" aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        {/* Cover — the native client shows one on every row and the web list
            looked bare without it. */}
        <ArtworkImage
          src={getArtworkUrl(track.album_version_id)}
          fallbackSrc={track.thumbnail_path ? getArtworkUrl(track.id) : null}
          alt=""
          className="w-11 h-11 rounded-md object-cover flex-shrink-0 bg-surface-2"
        />

        {/* Center: title + subtitle */}
        <div className="flex-1 min-w-0">
          <p className={`text-title font-medium truncate ${isActive ? 'text-accent-text' : ''}`}>
            {track.title}
          </p>
          {(showArtist || isCover) && (
            <p className="text-meta text-ink-secondary truncate mt-0.5">
              {lead}
              {isCover && (
                <span className="text-ink-tertiary">
                  {lead ? ' · ' : ''}
                  {coverPerformers ? (
                    <>
                      <span className="text-accent-text">{lead ? 'covered by' : 'Cover by'}</span>
                      {` ${coverPerformers}`}
                    </>
                  ) : (
                    <span className="text-accent-text">cover</span>
                  )}
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
                type="button"
                onClick={(e) => { e.stopPropagation(); favMutate() }}
                className={`p-1 transition-colors ${
                  track.is_favorited ? 'text-danger' : `text-ink-faint hover:text-danger ${REVEAL}`
                }`}
                aria-label={track.is_favorited ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
                aria-pressed={track.is_favorited}
              >
                <Heart size={14} strokeWidth={1.5} fill={track.is_favorited ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
                className={`p-1 text-ink-faint hover:text-white transition-colors ${REVEAL}`}
                aria-label={`Edit ${track.title}`}
              >
                <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
              {track.has_video && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setVideoOpen(true) }}
                  className={`p-1 text-ink-faint hover:text-accent-text transition-colors ${REVEAL}`}
                  aria-label={`Play the music video for ${track.title}`}
                >
                  <Video size={14} strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
            </>
          )}
          <span className="text-meta text-ink-tertiary tabular-nums w-10 text-right">
            {formatDuration(track.duration)}
          </span>
        </div>
      </div>

      {videoOpen && <VideoModal track={track} onClose={() => setVideoOpen(false)} />}
      {editOpen && <TrackEditModal track={track} onClose={() => setEditOpen(false)} />}
    </>
  )
}
