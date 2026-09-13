import { useState, useEffect } from 'react'
import { Music } from 'lucide-react'

interface Props {
  src: string | null
  /**
   * Tried when `src` fails to load. `GET /artwork/:id` resolves whatever id it is
   * given against albums, then playlists, then track thumbnails — it has no idea
   * an album id was meant to be "the" artwork, so an album with no cover file on
   * disk 404s instead of falling back to the track's own generated thumbnail.
   * Pass that thumbnail URL here to cover the gap (the native client does the same).
   */
  fallbackSrc?: string | null
  alt?: string
  className?: string
}

export default function ArtworkImage({ src, fallbackSrc, alt, className = '' }: Props) {
  const [failed, setFailed] = useState<string[]>([])

  // A new src (track change, cache-busted upload) deserves a fresh attempt.
  useEffect(() => setFailed([]), [src, fallbackSrc])

  const current = [src, fallbackSrc].find((url): url is string => !!url && !failed.includes(url)) ?? null

  if (!current) {
    return (
      <div className={`${className} artwork-edge flex items-center justify-center bg-surface-2`}>
        <Music size={20} strokeWidth={1.5} className="text-ink-faint" aria-hidden="true" />
      </div>
    )
  }

  return (
    <img
      key={current}
      src={current}
      alt={alt ?? ''}
      className={`${className} artwork-edge`}
      onError={() => setFailed((prev) => (prev.includes(current) ? prev : [...prev, current]))}
    />
  )
}
