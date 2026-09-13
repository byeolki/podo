import { useEffect, useRef, useState } from 'react'
import { Moon } from 'lucide-react'
import { usePlayerStore, type SleepTimer } from '../store/player'

const PRESETS_MINUTES = [15, 30, 45, 60, 90]

function remainingLabel(timer: SleepTimer, now: number): string | null {
  if (!timer) return null
  if (timer.kind === 'endOfTrack') return 'end'
  const minutes = Math.max(0, Math.ceil((timer.endsAt - now) / 60_000))
  return `${minutes}m`
}

/**
 * Stops playback after a delay, or when the current track ends. The deadline is
 * held in the store as an absolute timestamp; this component only renders it and
 * checks it once a second, so a backgrounded tab still stops at the right time.
 */
export default function SleepTimerMenu() {
  const sleepTimer = usePlayerStore((s) => s.sleepTimer)
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer)
  const fireSleepTimer = usePlayerStore((s) => s.fireSleepTimer)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sleepTimer?.kind !== 'at') return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= sleepTimer.endsAt) fireSleepTimer()
    }, 1000)
    return () => clearInterval(id)
  }, [sleepTimer, fireSleepTimer])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const active = sleepTimer !== null
  const label = remainingLabel(sleepTimer, now)

  const choose = (timer: SleepTimer) => {
    setSleepTimer(timer)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={active ? `Sleep timer: ${label}` : 'Sleep timer'}
        aria-label="Sleep timer"
        className={`flex items-center gap-1 transition-colors ${
          active ? 'text-accent-text' : 'text-ink-tertiary hover:text-ink-secondary'
        }`}
      >
        <Moon size={15} />
        {active && <span className="text-[10px] tabular-nums font-medium">{label}</span>}
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-44 bg-surface-3 border border-border rounded-lg overflow-hidden shadow-xl z-[60]">
          <p className="px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint border-b border-border">
            Stop playing after
          </p>
          {PRESETS_MINUTES.map((minutes) => (
            <button
              key={minutes}
              onClick={() => choose({ kind: 'at', endsAt: Date.now() + minutes * 60_000 })}
              className="w-full text-left px-3 py-2 text-xs text-ink-secondary hover:text-ink-primary hover:bg-white/5 transition-colors"
            >
              {minutes} minutes
            </button>
          ))}
          <button
            onClick={() => choose({ kind: 'endOfTrack' })}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              sleepTimer?.kind === 'endOfTrack'
                ? 'text-accent-text bg-accent/10'
                : 'text-ink-secondary hover:text-ink-primary hover:bg-white/5'
            }`}
          >
            End of this track
          </button>
          {active && (
            <button
              onClick={() => choose(null)}
              className="w-full text-left px-3 py-2 text-xs text-danger hover:bg-white/5 transition-colors border-t border-border"
            >
              Cancel timer
            </button>
          )}
        </div>
      )}
    </div>
  )
}
