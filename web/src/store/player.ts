import { create } from 'zustand'
import type { Track } from '../api/tracks'

interface PlayerState {
  queue: Track[]
  currentIndex: number
  isPlaying: boolean
  volume: number
  currentTime: number
  duration: number
  audioRef: HTMLAudioElement | null
  normalize: boolean
  resumeTime: number | null
  repeatMode: 'off' | 'all' | 'one'

  setQueue: (tracks: Track[], startIndex?: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  next: () => void
  prev: () => void
  setVolume: (v: number) => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setAudioRef: (el: HTMLAudioElement | null) => void
  playTrack: (track: Track, queue?: Track[]) => void
  setNormalize: (v: boolean) => void
  consumeResumeTime: () => number | null
  cycleRepeatMode: () => void
}

const QUEUE_KEY = 'podo_player_queue'
const TIME_KEY = 'podo_player_time'
const VOLUME_KEY = 'podo_player_volume'
const MAX_PERSISTED_QUEUE = 300

function persistQueue(queue: Track[], currentIndex: number) {
  try {
    let q = queue
    let idx = currentIndex
    if (q.length > MAX_PERSISTED_QUEUE) {
      const start = Math.max(0, Math.min(idx - 50, q.length - MAX_PERSISTED_QUEUE))
      q = q.slice(start, start + MAX_PERSISTED_QUEUE)
      idx = idx - start
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ queue: q, currentIndex: idx }))
  } catch {}
}

let lastTimePersist = 0

function persistTime(t: number, force = false) {
  const now = Date.now()
  if (!force && now - lastTimePersist < 5000) return
  lastTimePersist = now
  try { localStorage.setItem(TIME_KEY, String(Math.floor(t))) } catch {}
}

function loadPersisted(): { queue: Track[]; currentIndex: number; currentTime: number } | null {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { queue: Track[]; currentIndex: number }
    if (!Array.isArray(data.queue) || data.queue.length === 0) return null
    const time = parseInt(localStorage.getItem(TIME_KEY) ?? '0', 10)
    return {
      queue: data.queue,
      currentIndex: Math.min(Math.max(data.currentIndex ?? 0, 0), data.queue.length - 1),
      currentTime: Number.isFinite(time) && time > 0 ? time : 0,
    }
  } catch {
    return null
  }
}

function loadVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '')
    return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.8
  } catch {
    return 0.8
  }
}

function loadNormalize(): boolean {
  try { return localStorage.getItem('podo_normalize') === 'true' } catch { return false }
}

const REPEAT_KEY = 'podo_repeat_mode'
const REPEAT_ORDER: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one']

function loadRepeatMode(): 'off' | 'all' | 'one' {
  try {
    const v = localStorage.getItem(REPEAT_KEY)
    return v === 'all' || v === 'one' ? v : 'off'
  } catch {
    return 'off'
  }
}

const restored = loadPersisted()

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: restored?.queue ?? [],
  currentIndex: restored?.currentIndex ?? 0,
  isPlaying: false,
  volume: loadVolume(),
  currentTime: restored?.currentTime ?? 0,
  duration: 0,
  audioRef: null,
  normalize: loadNormalize(),
  resumeTime: restored && restored.currentTime > 3 ? restored.currentTime : null,
  repeatMode: loadRepeatMode(),

  setQueue: (tracks, startIndex = 0) => {
    set({ queue: tracks, currentIndex: startIndex, resumeTime: null })
    persistQueue(tracks, startIndex)
    persistTime(0, true)
  },

  play: () => {
    set({ isPlaying: true })
  },

  pause: () => {
    set({ isPlaying: false })
    persistTime(get().currentTime, true)
  },

  toggle: () => {
    const { isPlaying } = get()
    if (isPlaying) get().pause()
    else get().play()
  },

  next: () => {
    const { queue, currentIndex, repeatMode } = get()
    if (currentIndex < queue.length - 1) {
      set({ currentIndex: currentIndex + 1, currentTime: 0, resumeTime: null })
      persistQueue(queue, currentIndex + 1)
      persistTime(0, true)
    } else if (repeatMode === 'all' && queue.length > 0) {
      set({ currentIndex: 0, currentTime: 0, resumeTime: null })
      persistQueue(queue, 0)
      persistTime(0, true)
    }
  },

  prev: () => {
    const { queue, currentIndex, currentTime, audioRef } = get()
    if (currentTime > 3) {
      if (audioRef) audioRef.currentTime = 0
      set({ currentTime: 0 })
      persistTime(0, true)
    } else if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1, currentTime: 0, resumeTime: null })
      persistQueue(queue, currentIndex - 1)
      persistTime(0, true)
    }
  },

  setVolume: (v) => {
    const { audioRef } = get()
    if (audioRef) audioRef.volume = v
    set({ volume: v })
    try { localStorage.setItem(VOLUME_KEY, String(v)) } catch {}
  },

  setCurrentTime: (t) => {
    set({ currentTime: t })
    persistTime(t)
  },

  setDuration: (d) => set({ duration: d }),
  setAudioRef: (el) => {
    set({ audioRef: el })
    if (el) el.volume = get().volume
  },

  playTrack: (track, queue) => {
    const tracks = queue ?? [track]
    const idx = tracks.findIndex((t) => t.id === track.id)
    set({ queue: tracks, currentIndex: idx >= 0 ? idx : 0, isPlaying: true, resumeTime: null })
    persistQueue(tracks, idx >= 0 ? idx : 0)
    persistTime(0, true)
  },

  setNormalize: (v) => {
    try { localStorage.setItem('podo_normalize', v ? 'true' : 'false') } catch {}
    set({ normalize: v })
  },

  consumeResumeTime: () => {
    const t = get().resumeTime
    set({ resumeTime: null })
    return t
  },

  cycleRepeatMode: () => {
    const current = get().repeatMode
    const next = REPEAT_ORDER[(REPEAT_ORDER.indexOf(current) + 1) % REPEAT_ORDER.length]
    set({ repeatMode: next })
    try { localStorage.setItem(REPEAT_KEY, next) } catch {}
  },
}))

export function useCurrentTrack(): Track | null {
  const queue = usePlayerStore((s) => s.queue)
  const idx = usePlayerStore((s) => s.currentIndex)
  return queue[idx] ?? null
}
