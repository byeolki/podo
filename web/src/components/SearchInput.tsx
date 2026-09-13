import { Search, X } from 'lucide-react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/** Filter box above the Library / Albums / Playlists lists. */
export default function SearchInput({ value, onChange, placeholder, className = '' }: Props) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-surface-2 border border-border rounded-lg pl-8 pr-4 py-2 text-sm focus:border-accent transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-white"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
