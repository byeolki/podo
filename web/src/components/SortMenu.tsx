import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props<T extends string> {
  value: T
  /** Option key → label. Iteration order is menu order. */
  options: Record<T, string>
  onChange: (value: T) => void
  /** Tailwind width for the dropdown panel; labels vary per page. */
  menuWidthClass?: string
}

/**
 * The sort dropdown shared by Library, Albums and Playlists. Closes on an
 * outside click and on Escape — as three separate copies of this markup, it
 * only closed when an option was picked, so it stayed open over the page.
 */
export default function SortMenu<T extends string>({
  value,
  options,
  onChange,
  menuWidthClass = 'w-36',
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs text-ink-secondary hover:text-ink-primary transition-colors"
      >
        {options[value]}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className={`absolute right-0 top-full mt-1 ${menuWidthClass} bg-surface-3 border border-border rounded-lg overflow-hidden shadow-xl z-20`}>
          {(Object.keys(options) as T[]).map((key) => (
            <button
              key={key}
              onClick={() => { onChange(key); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                value === key ? 'text-accent-text bg-accent/10' : 'text-ink-secondary hover:text-ink-primary hover:bg-white/5'
              }`}
            >
              {options[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
