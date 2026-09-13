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
  /**
   * A failure, shown in the thread but never replayed to the model — "Failed to
   * fetch" is not something it said. It belongs in the thread all the same: a
   * request that dies in flight used to leave the panel simply stopped, with the
   * spinner gone and nothing in its place, which reads as the assistant giving up
   * silently rather than as something going wrong.
   */
  failed?: boolean
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
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const setQueue = usePlayerStore((s) => s.setQueue)
  const play = usePlayerStore((s) => s.play)

  const { data: status } = useQuery({
    queryKey: ['ai-chat-status'],
    queryFn: getChatStatus,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (history: Turn[]) =>
      sendChat(history.filter((t) => !t.failed).map(({ role, content }) => ({ role, content }))),
    onSuccess: (reply) => {
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: reply.reply, actions: reply.actions, usedTools: reply.used_tools },
      ])
      // Its tools create playlists and rewrite track metadata, so the views
      // behind the panel are stale the moment it succeeds.
      qc.invalidateQueries({ queryKey: ['playlists'] })
      qc.invalidateQueries({ queryKey: ['playlist'] })
      qc.invalidateQueries({ queryKey: ['tracks'] })
      qc.invalidateQueries({ queryKey: ['search'] })
    },
    onError: (err) => {
      const message = (err as Error).message
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          failed: true,
          content:
            /failed to fetch|network|timeout|gateway/i.test(message)
              ? `That request didn't come back — ${message}. Long jobs can outlast the connection; try asking for a smaller batch.`
              : message,
        },
      ])
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, isPending])

  // Every other overlay here closes on Escape; not doing so made this the one
  // panel you had to reach for the mouse to dismiss.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!status?.chat_enabled) return null

  function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || isPending) return
    const next: Turn[] = [...turns, { role: 'user', content: trimmed }]
    setTurns(next)
    setError(null)
    setInput('')
    mutate(next)
  }

  async function run(action: ChatAction) {
    try {
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
        if (!ordered.length) {
          setTurns((prev) => [...prev, { role: 'assistant', content: "Those tracks aren't in the library any more." }])
          return
        }
        setQueue(ordered, 0)
        // `setQueue` only loads the queue. Without this the button silently does
        // nothing whenever the player happens to be idle.
        play()
      }
    } catch (e) {
      setTurns((prev) => [...prev, { role: 'assistant', content: `That didn't work — ${(e as Error).message}` }])
    }
  }

  // Sits in the corner proper on a wide viewport: the player bar is capped at
  // 1100px and centred, so the bottom corners are free. Below xl it has to clear
  // the bar. It no longer widens into a labelled pill on hover — at 1280 the
  // expanded pill reached back over the bar it had just cleared.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press fixed right-5 bottom-28 xl:bottom-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 border border-border shadow-overlay transition-[scale,border-color] duration-150 hover:border-accent"
        title="Assistant"
        aria-label="Open the assistant"
      >
        <Sparkles size={18} className="text-accent-text" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div
      // A popup growing out of the corner it was launched from, rather than a
      // full-height panel welded to the window edge: it covers a strip of the
      // page instead of a third of it, and reads as something you opened.
      //
      // Its bottom edge tracks the launcher's at every breakpoint. They were an
      // inch apart at xl, so the popup appeared somewhere other than the button
      // that opened it and the scale-from-the-corner animation had nothing to
      // grow out of. Past xl that means overlapping the right end of the player
      // bar — the transport is centred and stays clear, and the alternative is a
      // popup that visibly detaches from its own trigger.
      className="fixed z-[60] flex flex-col overflow-hidden rounded-2xl bg-surface-1 border border-border shadow-overlay
                 inset-x-3 bottom-28 top-20
                 sm:inset-x-auto sm:top-auto sm:right-5 sm:w-[380px] sm:h-[min(560px,72vh)]
                 xl:bottom-5
                 origin-bottom-right animate-[assistant-in_140ms_ease-out]"
      role="dialog"
      aria-label="Assistant"
    >
      <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-accent-text" />
          <span className="text-sm font-semibold">Assistant</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-ink-tertiary hover:text-ink-primary transition-colors" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-ink-tertiary">
              Ask for music from your library. It can search, queue tracks and build playlists.
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="block w-full text-left text-xs px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-ink-secondary hover:text-ink-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={`max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                turn.failed
                  ? 'bg-danger/10 border border-danger/30 text-danger'
                  : turn.role === 'user'
                    ? 'bg-accent/20 text-white'
                    : 'bg-surface-2 text-ink-secondary'
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
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(input) }}
        className="flex gap-2 p-3 border-t border-border flex-shrink-0"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for something to play…"
          className="flex-1 bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-sm focus:border-accent"
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
