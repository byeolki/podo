import { useEffect, useState } from 'react'
import { Sparkles, Check, AlertCircle, RotateCcw } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAiSettings, updateAiSettings } from '../api/admin'
import type { AiProviderName } from '../api/admin'

const PROVIDERS: { value: AiProviderName; label: string; hint: string }[] = [
  { value: 'openai', label: 'OpenAI', hint: 'Needs OPENAI_API_KEY on the server.' },
  {
    value: 'claude-code',
    label: 'Claude Code CLI',
    hint: 'Runs the CLI bundled in the image — needs ANTHROPIC_API_KEY, or an authenticated config mounted at /root/.claude.',
  },
]

/**
 * Provider and model for the AI features.
 *
 * The model is a free text field rather than a dropdown on purpose: pointing the
 * server at a newer model shouldn't require a release of this dashboard.
 */
export default function AiSettingsCard() {
  const qc = useQueryClient()
  const { data: ai } = useQuery({ queryKey: ['ai-settings'], queryFn: getAiSettings })

  const [model, setModel] = useState('')
  const [modelDirty, setModelDirty] = useState(false)

  // Track the server's value until the field is actually edited, so switching
  // provider can show that provider's default without clobbering a typed one.
  useEffect(() => {
    if (ai && !modelDirty) setModel(ai.model)
  }, [ai, modelDirty])

  const { mutate, isPending } = useMutation({
    mutationFn: updateAiSettings,
    onSuccess: (next) => {
      qc.setQueryData(['ai-settings'], next)
      qc.invalidateQueries({ queryKey: ['health'] })
      setModelDirty(false)
      setModel(next.model)
    },
  })

  if (!ai) return null

  const providerHint = PROVIDERS.find((p) => p.value === ai.provider)?.hint
  const defaultModel = ai.default_models[ai.provider]

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles size={15} className="text-accent" /> AI
        </h3>
        <span className={`flex items-center gap-1.5 text-xs ${ai.available ? 'text-accent' : 'text-ink-tertiary'}`}>
          {ai.available ? <Check size={12} /> : <AlertCircle size={12} />}
          {ai.available ? 'Ready' : 'Not available'}
        </span>
      </div>

      <div className="rounded-xl bg-surface-2 border border-border divide-y divide-border">
        <label className="flex items-center justify-between gap-4 p-3 cursor-pointer">
          <span className="text-sm">
            Enabled
            <span className="block text-xs text-ink-tertiary mt-0.5">
              Fills metadata from filenames on import, and powers the AI Fill action.
            </span>
          </span>
          <input
            type="checkbox"
            checked={ai.enabled}
            disabled={isPending}
            onChange={(e) => mutate({ enabled: e.target.checked })}
            className="accent-accent flex-shrink-0"
          />
        </label>

        <div className="p-3">
          <p className="text-xs text-ink-tertiary mb-1.5">Provider</p>
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                disabled={isPending}
                onClick={() => mutate({ provider: p.value, model: '' })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors border ${
                  ai.provider === p.value
                    ? 'bg-accent/15 border-accent text-white'
                    : 'bg-surface-1 border-border-strong text-ink-secondary hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {providerHint && <p className="text-xs text-ink-faint mt-2">{providerHint}</p>}
        </div>

        <div className="p-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-ink-tertiary">Model</p>
            {model !== defaultModel && (
              <button
                type="button"
                onClick={() => { setModelDirty(false); mutate({ model: '' }) }}
                className="flex items-center gap-1 text-xs text-ink-faint hover:text-white transition-colors"
                title={`Back to ${defaultModel}`}
              >
                <RotateCcw size={11} /> Default
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={model}
              onChange={(e) => { setModel(e.target.value); setModelDirty(true) }}
              placeholder={defaultModel}
              className="flex-1 bg-surface-1 border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={isPending || !modelDirty || !model.trim()}
              onClick={() => mutate({ model: model.trim() })}
              className="px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-ink-faint mt-2">
            Any model id the provider accepts — it isn't checked against a list here.
          </p>
        </div>

        <label className="flex items-center justify-between gap-4 p-3 cursor-pointer">
          <span className="text-sm">
            Assistant
            <span className="block text-xs text-ink-tertiary mt-0.5">
              A chat panel docked at the edge of the window that can search your
              library, queue tracks and build playlists for you.
            </span>
          </span>
          <input
            type="checkbox"
            checked={ai.chat_enabled}
            disabled={isPending}
            onChange={(e) => mutate({ chat_enabled: e.target.checked })}
            // The launcher reads its own endpoint, so refresh that too.
            onBlur={() => qc.invalidateQueries({ queryKey: ['ai-chat-status'] })}
            className="accent-accent flex-shrink-0"
          />
        </label>
      </div>

      {!ai.available && ai.unavailable_reason && (
        <p className="flex items-start gap-1.5 text-xs text-ink-tertiary mt-2">
          <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
          {ai.unavailable_reason}
        </p>
      )}
      {ai.last_error && (
        <p className="flex items-start gap-1.5 text-xs text-red-400 mt-2">
          <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
          Last attempt failed — {ai.last_error}
        </p>
      )}
    </div>
  )
}
