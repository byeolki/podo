import { useEffect, useRef, useState, useCallback } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Video, Activity, Repeat, Repeat1, ListMusic, AlertCircle, Loader2, X } from 'lucide-react'
import { usePlayerStore, useCurrentTrack } from '../store/player'
import { getStreamUrl, getArtworkUrl, ensureFreshToken } from '../api/client'
import { formatDuration, recordPlay, artistLine } from '../api/tracks'
import ArtworkImage from './ArtworkImage'
import VideoModal from './VideoModal'
import SleepTimerMenu from './SleepTimerMenu'
import QueuePanel from './QueuePanel'

/**
 * How long to keep trying to get a track playing again after the stream dies.
 *
 * The old budget was four attempts backing off 1-2-4-8 seconds: it gave up after
 * fifteen. A server restart — a redeploy, a crash, an OOM kill — takes longer
 * than that to come back, so the one interruption that happens regularly was
 * also the one the player was guaranteed to lose. Ninety seconds covers a
 * container coming back up; the attempt cap only stops a tight loop.
 */
const RECOVERY_WINDOW_MS = 90_000
const MAX_RECOVERY_ATTEMPTS = 30
const MAX_RECOVERY_DELAY_MS = 4_000
/**
 * How long to let a gap in the audio go before trying to reload.
 *
 * Measured rather than assumed: when a stream dies mid-play the browser fires
 * neither `error` nor `pause` — `paused` stays false, `error` stays null, and
 * all you get is `waiting` followed by `stalled`. So these two timers are the
 * only thing standing between a dead stream and silence, and the old single
 * 12-second timer meant a redeploy was at least twelve seconds of nothing before
 * anything even tried.
 *
 * `stalled` is the stronger signal — the browser expected bytes and got none —
 * so it reacts sooner. `waiting` also fires during ordinary buffering, so it
 * waits long enough not to interrupt a slow but healthy load. A false positive
 * costs a re-buffer from the same position, not a restart.
 */
const WAITING_TIMEOUT_MS = 6_000
const STALLED_TIMEOUT_MS = 2_500

export default function Player() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const track = useCurrentTrack()
  const nowPlayingArtist = (() => {
    if (!track) return ''
    const { lead, coverPerformers } = artistLine(track)
    if (!coverPerformers) return lead ?? ''
    return lead ? `${lead} · covered by ${coverPerformers}` : `Cover by ${coverPerformers}`
  })()
  const {
    isPlaying, volume, currentTime, duration,
    toggle, next, prev, setVolume,
    setCurrentTime, setDuration, setAudioRef,
    queue, currentIndex, normalize, setNormalize,
    repeatMode, cycleRepeatMode,
  } = usePlayerStore()
  const [videoOpen, setVideoOpen] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const playRecordedRef = useRef<string | null>(null)
  const recoveryAttemptsRef = useRef(0)
  const recoverySinceRef = useRef<number | null>(null)
  // `recover` and `armStallTimer` each need the other, and one has to be defined
  // first; these break the cycle without reordering the file around it.
  const recoverRef = useRef<(() => void) | null>(null)
  const armStallTimerRef = useRef<((delay: number) => void) | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
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
    if (autoplay) audio.play().catch(reportPlaybackFailure)
  }, [])

  /**
   * A rejected `play()` fires no `pause` event, so nothing corrected the store:
   * the button stayed on Pause, the equaliser kept animating, and the only
   * signal that anything was wrong was silence.
   */
  const reportPlaybackFailure = useCallback((e: unknown) => {
    // `AbortError` means a newer load superseded this play() — which is exactly
    // what advancing to the next track does, since the queue change swaps `src`
    // while the previous play() promise is still pending. Treating it as a
    // failure paused the player between tracks, at random, part way through a
    // queue. It is not an error; the newer load is about to start playing.
    if ((e as Error)?.name === 'AbortError') return
    const message = (e as Error)?.name === 'NotAllowedError'
      ? 'Your browser blocked playback — press play again.'
      : `Couldn't play this track — ${(e as Error)?.message ?? 'unknown error'}`
    setPlaybackError(message)
    usePlayerStore.getState().pause()
  }, [])

  const recover = useCallback(() => {
    if (recoveryTimerRef.current) return
    if (!usePlayerStore.getState().isPlaying) return
    if (recoverySinceRef.current === null) recoverySinceRef.current = Date.now()
    const elapsed = Date.now() - recoverySinceRef.current
    if (elapsed > RECOVERY_WINDOW_MS || recoveryAttemptsRef.current >= MAX_RECOVERY_ATTEMPTS) {
      setPlaybackError("Lost the connection to the server and couldn't get it back. Press play to try again.")
      usePlayerStore.getState().pause()
      return
    }
    const attempt = ++recoveryAttemptsRef.current
    const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_RECOVERY_DELAY_MS)
    setReconnecting(true)
    recoveryTimerRef.current = setTimeout(async () => {
      recoveryTimerRef.current = null
      const audio = audioRef.current
      if (!audio) return
      // Resuming from the position rather than the start is what makes a restart
      // survivable; it only works because the stream is a seekable file.
      const pos = audio.currentTime || usePlayerStore.getState().currentTime
      const wasPlaying = usePlayerStore.getState().isPlaying
      try {
        await loadSource(pos, wasPlaying)
      } catch {
        // Nothing to react to otherwise: a reload that fails before the element
        // has a source fires no media event, so without this the retry loop ends
        // here and the track stays stopped.
        recoverRef.current?.()
        return
      }
      // The server may still be down, in which case the new source stalls exactly
      // like the old one did and the media events bring us back here.
      armStallTimerRef.current?.(STALLED_TIMEOUT_MS)
    }, delay)
  }, [loadSource])

  useEffect(() => { recoverRef.current = recover }, [recover])

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
    recoverySinceRef.current = null
    setReconnecting(false)
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
    if (isPlaying) audio.play().catch(reportPlaybackFailure)
    else audio.pause()
  }, [isPlaying, reportPlaybackFailure])

  // Transport shortcuts, the ones every music player has. Suppressed while a
  // text field or contenteditable has focus, so typing in search doesn't
  // scrub the track.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const audio = audioRef.current
      switch (e.key) {
        case ' ':
          e.preventDefault()
          usePlayerStore.getState().toggle()
          break
        case 'ArrowRight':
          if (audio) audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || Infinity)
          break
        case 'ArrowLeft':
          if (audio) audio.currentTime = Math.max(audio.currentTime - 5, 0)
          break
        case 'n':
          usePlayerStore.getState().next()
          break
        case 'p':
          usePlayerStore.getState().prev()
          break
        case 'm':
          usePlayerStore.getState().setVolume(usePlayerStore.getState().volume > 0 ? 0 : 0.8)
          break
        case 'q':
          setQueueOpen((v) => !v)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
    recoverySinceRef.current = null
    setReconnecting(false)
    clearStallTimer()
    setCurrentTime(t)
    if (track && t > 30 && playRecordedRef.current !== track.id) {
      playRecordedRef.current = track.id
      recordPlay(track.id).catch(() => {})
    }
  }

  const armStallTimer = useCallback((delay: number) => {
    if (!usePlayerStore.getState().isPlaying) return
    // Once a recovery is under way the longer `waiting` timer is the wrong
    // instrument: we already know the stream is in trouble, and a reload that
    // fails fires `waiting` again, which would otherwise reset the wait to six
    // seconds every time round the loop.
    if (recoverySinceRef.current !== null) delay = Math.min(delay, STALLED_TIMEOUT_MS)
    clearStallTimer()
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null
      const audio = audioRef.current
      if (audio && usePlayerStore.getState().isPlaying && audio.readyState < 3) {
        recover()
      }
    }, delay)
  }, [clearStallTimer, recover])

  useEffect(() => { armStallTimerRef.current = armStallTimer }, [armStallTimer])

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

    // An "end of this track" sleep timer outranks repeat and auto-advance —
    // that's the whole point of it.
    if (store.sleepTimer?.kind === 'endOfTrack') {
      store.fireSleepTimer()
      return
    }

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
    {/* A restart used to look like the track simply stopping. Saying so — and
        saying it is still trying — is the difference between "broken" and
        "wait a moment". */}
    {reconnecting && !playbackError && (
      <div
        role="status"
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[55] flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 border border-border text-ink-secondary text-sm shadow-overlay"
      >
        <Loader2 size={14} className="flex-shrink-0 animate-spin" aria-hidden="true" />
        Reconnecting…
      </div>
    )}
    {playbackError && (
      <div role="alert"
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[55] w-[min(92vw,560px)] flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2 border border-danger/40 text-danger text-sm shadow-overlay">
        <AlertCircle size={14} className="flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate">{playbackError}</span>
        <button onClick={() => setPlaybackError(null)} className="text-ink-tertiary hover:text-ink-primary" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
    )}
    {/* Floating rather than edge-to-edge: on a wide display a full-width bar put
        the artwork and the volume slider a metre apart with nothing between. */}
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[min(96vw,1100px)] h-20 rounded-2xl bg-surface-1/95 backdrop-blur border border-border shadow-overlay flex items-center px-3 sm:px-4 gap-2 sm:gap-4">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onEnded={handleTrackEnd}
        onError={recover}
        onStalled={() => armStallTimer(STALLED_TIMEOUT_MS)}
        onWaiting={() => armStallTimer(WAITING_TIMEOUT_MS)}
        onPlaying={() => {
          clearStallTimer()
          setPlaybackError(null)
          setReconnecting(false)
          recoveryAttemptsRef.current = 0
          recoverySinceRef.current = null
        }}
        onPause={handleNativePause}
        onPlay={handleNativePlay}
        preload="auto"
      />

      {/* Track info */}
      <div className="flex items-center gap-2 sm:gap-3 w-32 sm:w-52 flex-shrink-0">
        <ArtworkImage
          src={getArtworkUrl(track?.album_version_id)}
          fallbackSrc={track?.thumbnail_path ? getArtworkUrl(track.id) : null}
          alt={track?.title}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-md object-cover flex-shrink-0 bg-surface-2 transition-shadow ${isPlaying ? 'shadow-glow' : ''}`}
        />
        <div className="min-w-0">
          <p className="text-title font-medium truncate">{track?.title ?? 'Not playing'}</p>
          {/* Same split as the track rows and the native client — see artistLine. */}
          <p className="text-meta text-ink-secondary truncate">{nowPlayingArtist}</p>
        </div>
      </div>

      {/* Controls + progress */}
      <div className="flex flex-col items-center flex-1 gap-1.5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={prev}
            disabled={!track}
            aria-label="Previous track"
            className="p-1.5 text-ink-secondary hover:text-ink-primary disabled:opacity-30 transition-colors"
          >
            <SkipBack size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={!track}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="press w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-30 shadow-raised transition-[scale,background-color] duration-150"
          >
            {isPlaying
              ? <Pause size={16} fill="currentColor" aria-hidden="true" />
              : <Play size={16} fill="currentColor" className="ml-0.5" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!track || (currentIndex >= queue.length - 1 && repeatMode !== 'all')}
            aria-label="Next track"
            className="p-1.5 text-ink-secondary hover:text-ink-primary disabled:opacity-30 transition-colors"
          >
            <SkipForward size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={cycleRepeatMode}
            aria-label={repeatMode === 'off' ? 'Repeat: off' : repeatMode === 'all' ? 'Repeat: all' : 'Repeat: one'}
            className={`p-1.5 transition-colors ${repeatMode !== 'off' ? 'text-accent-text' : 'text-ink-tertiary hover:text-ink-secondary'}`}
          >
            {repeatMode === 'one' ? <Repeat1 size={16} aria-hidden="true" /> : <Repeat size={16} aria-hidden="true" />}
          </button>
        </div>

        <div className="flex items-center gap-2 w-full max-w-md">
          <span className="hidden sm:inline text-xs text-ink-tertiary w-9 text-right tabular-nums">
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
              background: `linear-gradient(to right, #8850E0 ${(currentTime / (duration || 1)) * 100}%, #3a3a38 0%)`,
            }}
          />
          <span className="hidden sm:inline text-xs text-ink-tertiary w-9 tabular-nums">
            {formatDuration(duration * 1000)}
          </span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 flex-shrink-0 sm:w-44 justify-end">
        {track?.has_video && (
          <button
            onClick={() => setVideoOpen(true)}
            className="p-1.5 text-ink-tertiary hover:text-accent-text transition-colors"
            title="Music video"
          >
            <Video size={16} aria-hidden="true" />
          </button>
        )}
        <button
          onClick={() => setQueueOpen(true)}
          className="p-1.5 text-ink-tertiary hover:text-ink-primary transition-colors"
          title="Queue (q)"
          aria-label="Show queue"
        >
          <ListMusic size={16} aria-hidden="true" />
        </button>
        <SleepTimerMenu />
        <button
          onClick={() => setNormalize(!normalize)}
          className={`hidden sm:block transition-colors ${normalize ? 'text-accent-text' : 'text-ink-tertiary hover:text-ink-secondary'}`}
          title={normalize ? 'Normalize: on' : 'Normalize: off'}
        >
          <Activity size={16} aria-hidden="true" />
        </button>
        <button
          onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
          className="hidden sm:block p-1.5 text-ink-tertiary hover:text-ink-primary transition-colors"
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
            background: `linear-gradient(to right, #8850E0 ${volume * 100}%, #333333 0%)`,
          }}
        />
      </div>
    </div>
    {videoOpen && track && <VideoModal track={track} onClose={() => setVideoOpen(false)} />}
    {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
    </>
  )
}
