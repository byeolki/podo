import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { getVideoStreamUrl } from '../api/client'
import type { Track } from '../api/tracks'

interface Props {
  track: Track
  startTime?: number
  onClose: () => void
}

export default function VideoModal({ track, startTime = 0, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{track.title}</p>
            {track.artists && track.artists.length > 0 && (
              <p className="text-xs text-[#a1a1a1] truncate">{track.artists.map((a) => a.name).join(', ')}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex-shrink-0 text-[#a1a1a1] hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <video
          ref={videoRef}
          src={getVideoStreamUrl(track.id)}
          controls
          autoPlay
          onLoadedMetadata={() => {
            if (videoRef.current && startTime > 0) {
              videoRef.current.currentTime = startTime
            }
          }}
          className="w-full rounded-xl bg-black aspect-video"
        />
      </div>
    </div>
  )
}
