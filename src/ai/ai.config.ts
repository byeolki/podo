export type AiProviderName = 'openai' | 'claude-code';

/**
 * How the AI features are wired up. Persisted in `app_settings` under
 * `ai`, seeded from environment variables the first time it is read.
 */
export interface AiSettings {
  /** Master switch, independent of whether a provider happens to be usable. */
  enabled: boolean;
  provider: AiProviderName;
  /** Model id for the selected provider. Free text — a new model shouldn't need a release. */
  model: string;
  /** The chat assistant, with its tools. Off by default: it can create playlists. */
  chat_enabled: boolean;
}

/**
 * Defaults per provider. These are *defaults*, not an allowlist — the model is a
 * plain string everywhere, so pointing at a newer one is a settings change rather
 * than a code change.
 */
export const DEFAULT_MODELS: Record<AiProviderName, string> = {
  openai: 'gpt-5.3',
  'claude-code': 'claude-sonnet-5',
};

export const AI_SETTINGS_KEY = 'ai';

export function normalizeSettings(raw: Partial<AiSettings> | null | undefined, fallback: AiSettings): AiSettings {
  const provider: AiProviderName = raw?.provider === 'claude-code' || raw?.provider === 'openai'
    ? raw.provider
    : fallback.provider;
  const model = typeof raw?.model === 'string' && raw.model.trim()
    ? raw.model.trim()
    // Switching provider without naming a model should land on that provider's
    // default rather than carrying the other provider's model id across.
    : (provider === fallback.provider ? fallback.model : DEFAULT_MODELS[provider]);

  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    provider,
    model,
    chat_enabled: typeof raw?.chat_enabled === 'boolean' ? raw.chat_enabled : fallback.chat_enabled,
  };
}
