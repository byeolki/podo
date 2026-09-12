import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, X, Send, Play, ListMusic } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getChatStatus, sendChat } from '../api/admin'
import type { ChatAction } from '../api/admin'
import { getTracksByIds } from '../api/tracks'
import { usePlayerStore } from '../store/player'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  actions?: ChatAction[]
  usedTools?: string[]
}

const SUGGESTIONS = [
  'Play something I favourited',
  'Make a playlist of my Yorushika covers',
  'What do I have by 윤단?',
]

/**
 * The assistant, docked at the right edge.
 *
 * Collapsed to a tab so it costs nothing until it's wanted, and rendered from
 * the layout rather than a page so it survives navigation — the conversation
 * would otherwise reset every time it sent you to a playlist.
 *
 * The server can't play anything (it has no speaker), so it returns actions and
 * this runs them against the player. That also means the queue visibly changes
 * rather than the assistant claiming it did.
 */
export default function AssistantPanel() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const setQueue = usePlayerStore((s) => s.setQueue)

  const { data: status } = useQuery({
    queryKey: ['ai-chat-status'],
    queryFn: getChatStatus,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (history: Turn[]) =>
      sendChat(history.map(({ role, content }) => ({ role, content }))),
    onSuccess: (reply) => {
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: reply.reply, actions: reply.actions, usedTools: reply.used_tools },
      ])
      // It may well have just created or changed one.
      qc.invalidateQueries({ queryKey: ['playlists'] })
    },
    onError: (err) => {
      setTurns((prev) => [...prev, { role: 'assistant', content: (err as Error).message }])
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, isPending])

  if (!status?.enabled) return null

  function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || isPending) return
    const next: Turn[] = [...turns, { role: 'user', content: trimmed }]
    setTurns(next)
    setInput('')
    mutate(next)
  }

  async function run(action: ChatAction) {
    if (action.type === 'open_playlist' && action.playlist_id) {
      navigate(`/playlists/${action.playlist_id}`)
      setOpen(false)
      return
    }
    if (action.type === 'play' && action.track_ids?.length) {
      // The assistant only knows ids; the player needs whole tracks.
      const tracks = await getTracksByIds(action.track_ids)
      // Keep the order the assistant asked for, not the order they came back in.
      const byId = new Map(tracks.map((t) => [t.id, t]))
      const ordered = action.track_ids.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t)
      if (ordered.length) setQueue(ordered, 0)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-[90] flex items-center gap-1.5 px-2 py-3 rounded-l-xl bg-surface-2 border border-r-0 border-border text-ink-secondary hover:text-white hover:bg-surface-3 transition-colors shadow-lg"
        title="Assistant"
        aria-label="Open the assistant"
      >
        <Sparkles size={15} className="text-accent" />
      </button>
    )
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 z-[90] w-full sm:w-[380px] bg-surface-1 border-l border-border flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-accent" />
          <span className="text-sm font-semibold">Assistant</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-ink-tertiary hover:text-white transition-colors" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-ink-tertiary">
              Ask for music from your library. It can search, queue tracks and build playlists.
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="block w-full text-left text-xs px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-ink-secondary hover:text-white transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={`max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                turn.role === 'user' ? 'bg-accent/20 text-white' : 'bg-surface-2 text-ink-secondary'
              }`}
            >
              {turn.content}
              {!!turn.actions?.length && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {turn.actions.map((a, j) => (
                    <button
                      key={j}
                      onClick={() => run(a)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
                    >
                      {a.type === 'play' ? <Play size={11} fill="currentColor" /> : <ListMusic size={11} />}
                      {a.label ?? (a.type === 'play' ? `Play ${a.track_ids?.length ?? 0}` : 'Open playlist')}
                    </button>
                  ))}
                </div>
              )}
              {!!turn.usedTools?.length && (
                <p className="text-[10px] text-ink-faint mt-1.5">{turn.usedTools.join(' → ')}</p>
              )}
            </div>
          </div>
        ))}

        {isPending && <p className="text-xs text-ink-tertiary">Thinking…</p>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(input) }}
        className="flex gap-2 p-3 border-t border-border flex-shrink-0"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for something to play…"
          className="flex-1 bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!input.trim() || isPending}
          className="px-3 rounded-lg bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
          aria-label="Send"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  )
}
