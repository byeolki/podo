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
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  isPlaying: false,
  volume: 0.8,
  currentTime: 0,
  duration: 0,
  audioRef: null,

  setQueue: (tracks, startIndex = 0) => {
    set({ queue: tracks, currentIndex: startIndex })
  },

  play: () => {
    set({ isPlaying: true })
  },

  pause: () => {
    set({ isPlaying: false })
  },

  toggle: () => {
    const { isPlaying } = get()
    if (isPlaying) get().pause()
    else get().play()
  },

  next: () => {
    const { queue, currentIndex } = get()
    if (currentIndex < queue.length - 1) {
      set({ currentIndex: currentIndex + 1, currentTime: 0 })
    }
  },

  prev: () => {
    const { currentIndex, currentTime, audioRef } = get()
    if (currentTime > 3) {
      if (audioRef) audioRef.currentTime = 0
      set({ currentTime: 0 })
    } else if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1, currentTime: 0 })
    }
  },

  setVolume: (v) => {
    const { audioRef } = get()
    if (audioRef) audioRef.volume = v
    set({ volume: v })
  },

  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setAudioRef: (el) => {
    set({ audioRef: el })
    if (el) el.volume = get().volume
  },

  playTrack: (track, queue) => {
    const tracks = queue ?? [track]
    const idx = tracks.findIndex((t) => t.id === track.id)
    set({ queue: tracks, currentIndex: idx >= 0 ? idx : 0, isPlaying: true })
  },
}))

export function useCurrentTrack(): Track | null {
  const queue = usePlayerStore((s) => s.queue)
  const idx = usePlayerStore((s) => s.currentIndex)
  return queue[idx] ?? null
}
