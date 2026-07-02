import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Video, Activity } from 'lucide-react'
import { usePlayerStore, useCurrentTrack } from '../store/player'
import { getStreamUrl, getArtworkUrl } from '../api/client'
import { formatDuration, recordPlay } from '../api/tracks'
import ArtworkImage from './ArtworkImage'
import VideoModal from './VideoModal'

export default function Player() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const track = useCurrentTrack()
  const {
    isPlaying, volume, currentTime, duration,
    toggle, next, prev, setVolume,
    setCurrentTime, setDuration, setAudioRef,
    queue, currentIndex, normalize, setNormalize,
  } = usePlayerStore()
  const [videoOpen, setVideoOpen] = useState(false)
  const playRecordedRef = useRef<string | null>(null)

  useEffect(() => {
    setAudioRef(audioRef.current)
    return () => setAudioRef(null)
  }, [setAudioRef])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track) return
    const src = getStreamUrl(track.id, normalize)
    if (audio.src !== src) {
      audio.src = src
    }
    if (isPlaying) {
      audio.play().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, currentIndex, normalize])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) audio.play().catch(() => {})
    else audio.pause()
  }, [isPlaying])

  function handleTimeUpdate(e: React.SyntheticEvent<HTMLAudioElement>) {
    const t = e.currentTarget.currentTime
    setCurrentTime(t)
    if (track && t > 30 && playRecordedRef.current !== track.id) {
      playRecordedRef.current = track.id
      recordPlay(track.id).catch(() => {})
    }
  }

  return (
    <>
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#111] border-t border-[#222] flex items-center px-3 sm:px-4 gap-2 sm:gap-4 z-50">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onEnded={next}
        onError={() => {}}
        preload="auto"
      />

      {/* Track info */}
      <div className="flex items-center gap-2 sm:gap-3 w-32 sm:w-52 flex-shrink-0">
        <ArtworkImage
          src={getArtworkUrl(track?.album_version_id)}
          alt={track?.title}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded object-cover flex-shrink-0 bg-[#222]"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{track?.title ?? 'Not playing'}</p>
          <p className="text-xs text-[#a1a1a1] truncate">
            {track?.is_cover
              ? (track.override?.original_artist ?? track.artists?.map((a) => a.name).join(', ') ?? '')
              : (track?.artists?.map((a) => a.name).join(', ') ?? '')}
          </p>
        </div>
      </div>

      {/* Controls + progress */}
      <div className="flex flex-col items-center flex-1 gap-1.5">
        <div className="flex items-center gap-4">
          <button
            onClick={prev}
            disabled={!track}
            className="text-[#a1a1a1] hover:text-white disabled:opacity-30 transition-colors"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={toggle}
            disabled={!track}
            className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:bg-[#e0e0e0] disabled:opacity-30 transition-colors"
          >
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>
          <button
            onClick={next}
            disabled={!track || currentIndex >= queue.length - 1}
            className="text-[#a1a1a1] hover:text-white disabled:opacity-30 transition-colors"
          >
            <SkipForward size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 w-full max-w-md">
          <span className="hidden sm:inline text-xs text-[#6b6b6b] w-9 text-right tabular-nums">
            {formatDuration(currentTime * 1000)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => {
              const t = Number(e.target.value)
              if (audioRef.current) audioRef.current.currentTime = t
              setCurrentTime(t)
            }}
            className="flex-1"
            style={{
              background: `linear-gradient(to right, #a855f7 ${(currentTime / (duration || 1)) * 100}%, #333 0%)`,
            }}
          />
          <span className="hidden sm:inline text-xs text-[#6b6b6b] w-9 tabular-nums">
            {formatDuration(duration * 1000)}
          </span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 flex-shrink-0 sm:w-44 justify-end">
        {track?.has_video && (
          <button
            onClick={() => setVideoOpen(true)}
            className="text-[#6b6b6b] hover:text-accent transition-colors"
            title="Music video"
          >
            <Video size={15} />
          </button>
        )}
        <button
          onClick={() => setNormalize(!normalize)}
          className={`hidden sm:block transition-colors ${normalize ? 'text-accent' : 'text-[#6b6b6b] hover:text-[#a1a1a1]'}`}
          title={normalize ? 'Normalize: on' : 'Normalize: off'}
        >
          <Activity size={15} />
        </button>
        <button
          onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
          className="hidden sm:block text-[#6b6b6b] hover:text-white transition-colors"
        >
          {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="hidden sm:block w-20"
          style={{
            background: `linear-gradient(to right, #a855f7 ${volume * 100}%, #333 0%)`,
          }}
        />
      </div>
    </div>
    {videoOpen && track && <VideoModal track={track} onClose={() => setVideoOpen(false)} />}
    </>
  )
}
