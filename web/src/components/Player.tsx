import { useEffect, useRef, useState, useCallback } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Video, Activity, Repeat, Repeat1 } from 'lucide-react'
import { usePlayerStore, useCurrentTrack } from '../store/player'
import { getStreamUrl, getArtworkUrl, ensureFreshToken } from '../api/client'
import { formatDuration, recordPlay } from '../api/tracks'
import ArtworkImage from './ArtworkImage'
import VideoModal from './VideoModal'

const MAX_RECOVERY_ATTEMPTS = 4
const STALL_TIMEOUT_MS = 12_000

export default function Player() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const track = useCurrentTrack()
  const {
    isPlaying, volume, currentTime, duration,
    toggle, next, prev, setVolume,
    setCurrentTime, setDuration, setAudioRef,
    queue, currentIndex, normalize, setNormalize,
    repeatMode, cycleRepeatMode,
  } = usePlayerStore()
  const [videoOpen, setVideoOpen] = useState(false)
  const playRecordedRef = useRef<string | null>(null)
  const recoveryAttemptsRef = useRef(0)
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadSeqRef = useRef(0)
  const suppressPauseSyncRef = useRef(false)
  const suppressPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setAudioRef(audioRef.current)
    return () => setAudioRef(null)
  }, [setAudioRef])

  const loadSource = useCallback(async (seekTo: number, autoplay: boolean) => {
    const audio = audioRef.current
    const t = usePlayerStore.getState().queue[usePlayerStore.getState().currentIndex]
    if (!audio || !t) return
    const seq = ++loadSeqRef.current
    await ensureFreshToken()
    if (seq !== loadSeqRef.current) return
    audio.src = getStreamUrl(t.id, usePlayerStore.getState().normalize)
    if (seekTo > 0.5) {
      const onMeta = () => {
        audio.removeEventListener('loadedmetadata', onMeta)
        if (seq !== loadSeqRef.current) return
        try { audio.currentTime = seekTo } catch {}
      }
      audio.addEventListener('loadedmetadata', onMeta)
    }
    // audio.load() synchronously pauses a playing element and queues a native
    // 'pause' event as part of resetting it — ignore that artifact so it
    // doesn't get mistaken for a real (e.g. Bluetooth output disconnect) pause.
    suppressPauseSyncRef.current = true
    if (suppressPauseTimerRef.current) clearTimeout(suppressPauseTimerRef.current)
    suppressPauseTimerRef.current = setTimeout(() => { suppressPauseSyncRef.current = false }, 600)
    audio.load()
    if (autoplay) audio.play().catch(() => {})
  }, [])

  const recover = useCallback(() => {
    if (recoveryTimerRef.current) return
    if (recoveryAttemptsRef.current >= MAX_RECOVERY_ATTEMPTS) return
    const attempt = ++recoveryAttemptsRef.current
    const delay = Math.min(1000 * 2 ** (attempt - 1), 8000)
    recoveryTimerRef.current = setTimeout(async () => {
      recoveryTimerRef.current = null
      const audio = audioRef.current
      if (!audio) return
      const pos = audio.currentTime || usePlayerStore.getState().currentTime
      const wasPlaying = usePlayerStore.getState().isPlaying
      await loadSource(pos, wasPlaying)
    }, delay)
  }, [loadSource])

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
  }, [])

  const prevTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!track) return
    recoveryAttemptsRef.current = 0
    clearStallTimer()
    const sameTrack = prevTrackIdRef.current === track.id
    prevTrackIdRef.current = track.id
    const resume = usePlayerStore.getState().consumeResumeTime()
      ?? (sameTrack ? usePlayerStore.getState().currentTime : null)
    loadSource(resume ?? 0, isPlaying)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, currentIndex, normalize])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) audio.play().catch(() => {})
    else audio.pause()
  }, [isPlaying])

  useEffect(() => {
    const handleOnline = () => {
      const audio = audioRef.current
      if (!audio || !usePlayerStore.getState().isPlaying) return
      if (audio.error || audio.readyState < 3) {
        recoveryAttemptsRef.current = 0
        recover()
      }
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [recover])

  useEffect(() => () => {
    clearStallTimer()
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
    if (suppressPauseTimerRef.current) clearTimeout(suppressPauseTimerRef.current)
  }, [clearStallTimer])

  function handleTimeUpdate(e: React.SyntheticEvent<HTMLAudioElement>) {
    const t = e.currentTarget.currentTime
    recoveryAttemptsRef.current = 0
    clearStallTimer()
    setCurrentTime(t)
    if (track && t > 30 && playRecordedRef.current !== track.id) {
      playRecordedRef.current = track.id
      recordPlay(track.id).catch(() => {})
    }
  }

  function handleWaiting() {
    if (!usePlayerStore.getState().isPlaying) return
    clearStallTimer()
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null
      const audio = audioRef.current
      if (audio && usePlayerStore.getState().isPlaying && audio.readyState < 3) {
        recover()
      }
    }, STALL_TIMEOUT_MS)
  }

  // Keep the store in sync when playback stops/starts for reasons outside our
  // own toggle() calls — e.g. the OS pausing HTML5 audio when a Bluetooth
  // output (AirPods, etc.) disconnects. Without this the dashboard keeps
  // showing "playing" even though audio has actually stopped.
  function handleNativePause() {
    if (suppressPauseSyncRef.current) return
    if (usePlayerStore.getState().isPlaying) usePlayerStore.getState().pause()
  }

  function handleNativePlay() {
    if (!usePlayerStore.getState().isPlaying) usePlayerStore.getState().play()
  }

  // Reaching end-of-media always fires a native 'pause' just before 'ended'
  // (per the HTML spec), which our pause-sync above turns into isPlaying:
  // false. When we're actually continuing (next track, or looping), restore
  // isPlaying before advancing so the track-change effect autoplays.
  function handleTrackEnd() {
    const store = usePlayerStore.getState()
    const { repeatMode: mode, queue: q, currentIndex: idx } = store

    if (mode === 'one') {
      const audio = audioRef.current
      if (audio) {
        audio.currentTime = 0
        audio.play().catch(() => {})
      }
      store.play()
      return
    }

    const willContinue = idx < q.length - 1 || (mode === 'all' && q.length > 0)
    if (willContinue) store.play()
    next()
  }

  return (
    <>
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#111] border-t border-[#222] flex items-center px-3 sm:px-4 gap-2 sm:gap-4 z-50">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onEnded={handleTrackEnd}
        onError={recover}
        onStalled={handleWaiting}
        onWaiting={handleWaiting}
        onPlaying={clearStallTimer}
        onPause={handleNativePause}
        onPlay={handleNativePlay}
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
            disabled={!track || (currentIndex >= queue.length - 1 && repeatMode !== 'all')}
            className="text-[#a1a1a1] hover:text-white disabled:opacity-30 transition-colors"
          >
            <SkipForward size={18} />
          </button>
          <button
            onClick={cycleRepeatMode}
            title={repeatMode === 'off' ? 'Repeat: off' : repeatMode === 'all' ? 'Repeat: all' : 'Repeat: one'}
            className={`transition-colors ${repeatMode !== 'off' ? 'text-accent' : 'text-[#6b6b6b] hover:text-[#a1a1a1]'}`}
          >
            {repeatMode === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
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
