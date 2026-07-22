import { useState } from 'react'
import { Music } from 'lucide-react'

interface Props {
  src: string | null
  alt?: string
  className?: string
}

export default function ArtworkImage({ src, alt, className = '' }: Props) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className={`${className} flex items-center justify-center bg-surface-2`}>
        <Music size={20} className="text-ink-faint" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt ?? ''}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
