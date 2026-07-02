import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getVideoStreamUrl, ensureFreshToken } from '../api/client'
import { usePlayerStore } from '../store/player'
import type { Track } from '../api/tracks'

interface Props {
  track: Track
  onClose: () => void
}

export default function VideoModal({ track, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = usePlayerStore((s) => s.audioRef)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ensureFreshToken().then(() => {
      if (!cancelled) setVideoSrc(getVideoStreamUrl(track.id))
    })
    return () => { cancelled = true }
  }, [track.id])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    const id = setInterval(() => {
      const video = videoRef.current
      const audio = audioRef
      if (!video || !audio) return

      if (audio.paused && !video.paused) {
        video.pause()
      } else if (!audio.paused && video.paused) {
        video.play().catch(() => {})
      }

      if (Math.abs(video.currentTime - audio.currentTime) > 0.5) {
        video.currentTime = audio.currentTime
      }
    }, 500)
    return () => clearInterval(id)
  }, [audioRef])

  function handleLoadedMetadata() {
    const video = videoRef.current
    const audio = audioRef
    if (!video || !audio) return
    video.currentTime = audio.currentTime
    if (!audio.paused) video.play().catch(() => {})
  }

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

        {videoSrc && (
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            onLoadedMetadata={handleLoadedMetadata}
            className="w-full rounded-xl bg-black aspect-video"
          />
        )}
      </div>
    </div>
  )
}
