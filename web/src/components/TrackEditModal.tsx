import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateTrackMetadata, aiAutofillTracks } from '../api/tracks'
import type { Track, TrackMetadataInput } from '../api/tracks'

interface Props {
  track: Track
  onClose: () => void
}

export default function TrackEditModal({ track, onClose }: Props) {
  const ov = track.override
  const [title, setTitle] = useState(ov?.title ?? track.title)
  const [origArtist, setOrigArtist] = useState(ov?.original_artist ?? '')
  const [coverBy, setCoverBy] = useState(ov?.artist ?? (track.artists?.[0]?.name ?? ''))
  const [isCover, setIsCover] = useState(ov?.is_cover ?? track.is_cover ?? false)
  const [videoLocator, setVideoLocator] = useState(ov?.video_locator ?? '')

  const queryClient = useQueryClient()
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
        if (r.artist) setCoverBy(r.artist as string)
        if (r.original_artist) setOrigArtist(r.original_artist as string)
      }
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutate({
      title: title.trim() || undefined,
      artist: coverBy.trim() || undefined,
      is_cover: isCover,
      original_artist: origArtist.trim() || undefined,
      video_locator: videoLocator.trim() || undefined,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-sm font-semibold">Edit Track</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runAiFill()}
              disabled={aiFilling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-xs text-[#a1a1a1] hover:text-white transition-colors disabled:opacity-50"
              title="Auto-fill with AI"
            >
              <Sparkles size={12} />
              {aiFilling ? 'Filling…' : 'AI Fill'}
            </button>
            <button onClick={onClose} className="text-[#6b6b6b] hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-[#6b6b6b] mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-[#6b6b6b] mb-1.5">Artist</label>
            <input
              type="text"
              value={origArtist}
              onChange={(e) => setOrigArtist(e.target.value)}
              placeholder="Original artist"
              className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent placeholder:text-[#444]"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsCover(!isCover)}
              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 overflow-hidden ${isCover ? 'bg-accent' : 'bg-[#333]'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isCover ? 'translate-x-[20px]' : 'translate-x-0'}`}
              />
            </button>
            <label className="text-sm text-[#a1a1a1]">Cover song</label>
          </div>

          <div className={isCover ? '' : 'hidden'}>
            <label className="block text-xs text-[#6b6b6b] mb-1.5">Cover by</label>
            <input
              type="text"
              value={coverBy}
              onChange={(e) => setCoverBy(e.target.value)}
              placeholder="Who covered this song"
              className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent placeholder:text-[#444]"
            />
          </div>

          <div>
            <label className="block text-xs text-[#6b6b6b] mb-1.5">Music video path</label>
            <input
              type="text"
              value={videoLocator}
              onChange={(e) => setVideoLocator(e.target.value)}
              placeholder="/path/to/video.mp4"
              className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent placeholder:text-[#444]"
            />
          </div>

          <div className="text-xs text-[#6b6b6b] pt-1 border-t border-[#222] flex justify-between">
            <span>Added {new Date(track.added_at).toLocaleDateString()}</span>
            {ov?.updated_at && <span>Last edited {new Date(ov.updated_at).toLocaleDateString()}</span>}
          </div>

          {error && (
            <p className="text-xs text-red-400">{(error as Error).message}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-[#222] hover:bg-[#2a2a2a] text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
