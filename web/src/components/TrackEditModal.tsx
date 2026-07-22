import { useState, useRef, KeyboardEvent } from 'react'
import { X, Sparkles, Camera } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateTrackMetadata, aiAutofillTracks, uploadTrackThumbnail, removeTrackThumbnail } from '../api/tracks'
import type { Track, TrackMetadataInput } from '../api/tracks'
import { getArtworkUrl } from '../api/client'
import ArtworkImage from './ArtworkImage'

interface Props {
  track: Track
  onClose: () => void
}

function splitList(s: string | null | undefined): string[] {
  if (!s) return []
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    const val = input.trim()
    if (val && !tags.includes(val)) onChange([...tags, val])
    setInput('')
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag))
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 w-full bg-surface-1 border border-border-strong rounded-lg px-2 py-1.5 cursor-text focus-within:border-accent transition-colors min-h-[38px]"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span key={tag} className="flex items-center gap-1 bg-surface-3 text-sm px-2 py-0.5 rounded-md">
          {tag}
          <button type="button" onClick={() => remove(tag)} className="text-ink-faint hover:text-white transition-colors">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-ink-faint"
      />
    </div>
  )
}

export default function TrackEditModal({ track, onClose }: Props) {
  const ov = track.override
  const [title, setTitle] = useState(ov?.title ?? track.title)
  const [origArtists, setOrigArtists] = useState<string[]>(splitList(ov?.original_artist))
  const [coverByArtists, setCoverByArtists] = useState<string[]>(
    splitList(ov?.artist) || splitList(track.artists?.map((a) => a.name).join(', '))
  )
  const [isCover, setIsCover] = useState(ov?.is_cover ?? track.is_cover ?? false)
  const [alternateTitles, setAlternateTitles] = useState<string[]>(splitList(ov?.alternate_titles))
  const [hasThumbnail, setHasThumbnail] = useState(!!track.thumbnail_path)
  const [thumbnailBust, setThumbnailBust] = useState(0)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()

  const thumbnailMut = useMutation({
    mutationFn: (file: File) => uploadTrackThumbnail(track.id, file),
    onSuccess: () => {
      setHasThumbnail(true)
      setThumbnailBust((v) => v + 1)
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })

  const removeThumbnailMut = useMutation({
    mutationFn: () => removeTrackThumbnail(track.id),
    onSuccess: () => {
      setHasThumbnail(false)
      setThumbnailBust((v) => v + 1)
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })
  const { mutate, isPending, error } = useMutation({
    mutationFn: (data: TrackMetadataInput) => updateTrackMetadata(track.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      onClose()
    },
  })

  const { mutate: runAiFill, isPending: aiFilling } = useMutation({
    mutationFn: () => aiAutofillTracks([track.id]),
    onSuccess: (results) => {
      const r = results[0]?.result
      if (r) {
        if (r.title) setTitle(r.title as string)
        if (r.is_cover !== undefined) setIsCover(r.is_cover as boolean)
        if (r.artist) setCoverByArtists(splitList(r.artist as string))
        if (r.original_artist) setOrigArtists(splitList(r.original_artist as string))
      }
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutate({
      title: title.trim() || undefined,
      artist: coverByArtists.join(', ') || undefined,
      is_cover: isCover,
      original_artist: origArtists.join(', ') || undefined,
      alternate_titles: alternateTitles.join(', ') || undefined,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Edit Track</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runAiFill()}
              disabled={aiFilling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs text-ink-secondary hover:text-white transition-colors disabled:opacity-50"
            >
              <Sparkles size={12} />
              {aiFilling ? 'Filling…' : 'AI Fill'}
            </button>
            <button onClick={onClose} className="text-ink-tertiary hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-ink-tertiary mb-1.5">Thumbnail</label>
            <div className="flex items-center gap-3">
              <div className="relative w-16 h-16 flex-shrink-0 group">
                <ArtworkImage
                  src={hasThumbnail ? `${getArtworkUrl(track.id)}?v=${thumbnailBust}` : getArtworkUrl(track.album_version_id)}
                  alt={title}
                  className="w-full h-full rounded-lg object-cover bg-surface-1"
                />
                <button
                  type="button"
                  onClick={() => thumbnailInputRef.current?.click()}
                  disabled={thumbnailMut.isPending}
                  className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 group-hover:bg-black/50 text-transparent group-hover:text-white transition-all disabled:opacity-50"
                  title="Change thumbnail"
                >
                  <Camera size={18} />
                </button>
                <input
                  ref={thumbnailInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) thumbnailMut.mutate(file)
                    e.target.value = ''
                  }}
                />
              </div>
              <div className="flex flex-col gap-1 text-xs text-ink-tertiary">
                <span>{hasThumbnail ? 'Custom thumbnail' : 'Auto-generated (YouTube / video frame)'}</span>
                {hasThumbnail && (
                  <button
                    type="button"
                    onClick={() => removeThumbnailMut.mutate()}
                    disabled={removeThumbnailMut.isPending}
                    className="self-start text-red-400 hover:underline disabled:opacity-50"
                  >
                    {removeThumbnailMut.isPending ? 'Removing…' : 'Remove custom thumbnail'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-ink-tertiary mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-surface-1 border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-tertiary mb-1.5">Artist</label>
            <TagInput tags={origArtists} onChange={setOrigArtists} placeholder="Add artist, press Enter" />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsCover(!isCover)}
              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 overflow-hidden ${isCover ? 'bg-accent' : 'bg-border-strong'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isCover ? 'translate-x-[20px]' : 'translate-x-0'}`}
              />
            </button>
            <label className="text-sm text-ink-secondary">Cover song</label>
          </div>

          <div className={isCover ? '' : 'hidden'}>
            <label className="block text-xs text-ink-tertiary mb-1.5">Cover by</label>
            <TagInput tags={coverByArtists} onChange={setCoverByArtists} placeholder="Add cover artist, press Enter" />
          </div>

          <div>
            <label className="block text-xs text-ink-tertiary mb-1.5">Alternate names (for search)</label>
            <TagInput
              tags={alternateTitles}
              onChange={setAlternateTitles}
              placeholder="e.g. Kenshi Yonezu, Yonezu Kenji, press Enter"
            />
          </div>

          <div className="text-xs text-ink-tertiary pt-1 border-t border-border flex justify-between">
            <span>Added {new Date(track.added_at).toLocaleDateString()}</span>
            {ov?.updated_at && <span>Last edited {new Date(ov.updated_at).toLocaleDateString()}</span>}
          </div>

          {error && <p className="text-xs text-red-400">{(error as Error).message}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-black text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
