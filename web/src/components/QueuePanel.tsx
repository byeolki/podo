import { useEffect, useRef } from 'react'
import { X, ListMusic } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { formatDuration } from '../api/tracks'
import { getArtworkUrl } from '../api/client'
import ArtworkImage from './ArtworkImage'

interface Props {
  onClose: () => void
}

/**
 * What's playing and what's next. A player without this can't answer "why is
 * this song on?" — you can start a queue from anywhere in the app but until now
 * there was no way to look at it.
 */
export default function QueuePanel({ onClose }: Props) {
  const queue = usePlayerStore((s) => s.queue)
  const currentIndex = usePlayerStore((s) => s.currentIndex)
  const jumpTo = usePlayerStore((s) => s.jumpTo)
  const currentRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const upNext = queue.length - currentIndex - 1

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="w-full max-w-sm h-full bg-surface-1 border-l border-border flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Play queue"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ListMusic size={15} className="text-accent" /> Queue
            </span>
            <p className="text-xs text-ink-tertiary mt-0.5">
              {queue.length} track{queue.length === 1 ? '' : 's'}
              {upNext > 0 ? ` · ${upNext} up next` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close queue" className="text-ink-faint hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {queue.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-faint">Nothing queued</p>
          ) : (
            queue.map((track, i) => {
              const isCurrent = i === currentIndex
              return (
                <button
                  key={`${track.id}-${i}`}
                  ref={isCurrent ? currentRef : undefined}
                  onClick={() => jumpTo(i)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                    isCurrent ? 'bg-accent/10' : i < currentIndex ? 'opacity-45 hover:bg-white/5' : 'hover:bg-white/5'
                  }`}
                >
                  <ArtworkImage
                    src={getArtworkUrl(track.album_version_id)}
                    fallbackSrc={track.thumbnail_path ? getArtworkUrl(track.id) : null}
                    alt=""
                    className="w-9 h-9 rounded object-cover flex-shrink-0 bg-surface-2"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${isCurrent ? 'text-accent font-medium' : ''}`}>{track.title}</p>
                    <p className="text-xs text-ink-tertiary truncate">
                      {track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist'}
                    </p>
                  </div>
                  <span className="text-xs text-ink-faint tabular-nums flex-shrink-0">
                    {formatDuration(track.duration)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </aside>
    </div>
  )
}
