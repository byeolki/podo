import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import {
  AI_SETTINGS_KEY,
  AiProviderName,
  AiSettings,
  DEFAULT_MODELS,
  normalizeSettings,
} from './ai.config';
import { AiProvider, ClaudeCodeProvider, OpenAiProvider, parseJsonObject } from './providers';
import { MusicBrainzService, RecordingCandidate } from '../musicbrainz/musicbrainz.service';

export interface AiMetaResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  genres: string[];
  is_cover: boolean;
  original_artist: string | null;
  /** Set when MusicBrainz, not the model alone, is the source of `original_artist`. */
  original_artist_verified: boolean;
}

export interface AiStatus extends AiSettings {
  /** Provider is selected, configured and its binary/key is present. */
  available: boolean;
  unavailable_reason: string | null;
  /**
   * The most recent real failure, cleared by the next success.
   *
   * `available` can only tell you the provider is *installed* — an unauthenticated
   * Claude Code CLI passes `--version` happily and then answers "Not logged in"
   * on the first real call. Proving otherwise would cost a model call per status
   * check, so the truth arrives here instead, the first time something is asked.
   */
  last_error: string | null;
  default_models: Record<AiProviderName, string>;
}

const METADATA_PROMPT = `You are a music metadata expert with deep knowledge of Korean (K-pop, K-indie), Japanese (J-pop, anime), and global music. Given a filename and any known tags, extract structured metadata.
Respond ONLY with valid JSON matching this schema:
{
  "title": string | null,
  "artist": string | null,
  "album": string | null,
  "year": number | null,
  "genres": string[],
  "is_cover": boolean,
  "original_artist": string | null
}
- is_cover = true when the filename or tags suggest this is a cover version (e.g. "cover by X", "X covers Y", "(covered by X)", "커버", "cover")
- original_artist: when is_cover is true, ALWAYS try to identify the original artist using the song title. Search your knowledge of Korean pop, Korean indie, Japanese music, and international hits. Even if the song title is in Korean or Japanese, look up who originally performed it. Only set null if you genuinely have no idea.
- Return null for other fields you cannot determine with reasonable confidence
- genres should be an empty array if unknown`;

const ATTRIBUTION_PROMPT = `You identify who a song belongs to — the artist whose song it originally is, not whoever performed the recording at hand.
You are given a song title and a list of real MusicBrainz recordings carrying exactly that title, each with its artist and earliest release date.
Respond ONLY with valid JSON: {"original_artist": string | null}
- Choose the artist whose release is the original, using the release dates as evidence and your own knowledge of the song to break ties. Many titles are shared by unrelated songs, so the earliest date is NOT automatically the answer.
- Copy the artist name exactly as it appears in the list.
- If none of the listed recordings is the song in question, answer null. Never invent an artist that is not in the list.`;

/**
 * The AI features, behind a provider the operator chooses.
 *
 * Two providers: an OpenAI API key, or the Claude Code CLI already installed on
 * the machine. The second exists so a self-hosted server can have these features
 * without its operator provisioning an API key and billing for one.
 *
 * Everything here is best-effort by construction. A provider that is missing,
 * misconfigured, rate-limited or simply wrong returns null and the caller carries
 * on with what it had — no AI feature is ever on the critical path of importing
 * or finding music.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly envDefaults: AiSettings;
  private readonly providers: Record<AiProviderName, AiProvider>;

  private cached: AiSettings | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly musicbrainz: MusicBrainzService,
  ) {
    const openAiKey = config.get<string>('openai_api_key', '');
    const claudePath = config.get<string>('claude_code_path', 'claude');

    this.providers = {
      openai: new OpenAiProvider(openAiKey),
      'claude-code': new ClaudeCodeProvider(
        claudePath,
        config.get<string>('claude_model', '') || DEFAULT_MODELS['claude-code'],
        config.get<string>('claude_config_home', ''),
      ),
    };

    // Environment only supplies the defaults; a row in `app_settings` wins.
    //
    // Defaulting to the CLI whenever no key was set would have switched AI *on*
    // for every existing deployment on upgrade — the CLI needs no key, so it
    // reports itself available, and the scanner would then spend the operator's
    // personal Claude subscription on one subprocess per imported file without
    // anyone asking for it. Nothing is chosen implicitly: a provider has to be
    // named, or a key has to be present.
    const configured = config.get<string>('ai_provider', '').trim();
    const provider: AiProviderName =
      configured === 'openai' || configured === 'claude-code' ? configured
      : openAiKey ? 'openai'
      : 'claude-code';
    if (configured && configured !== provider) {
      this.logger.warn(`Ignoring AI_PROVIDER="${configured}" — expected "openai" or "claude-code"`);
    }

    this.envDefaults = {
      // Off unless something was actually configured. `AI_ENABLED=true` with a
      // usable CLI is the deliberate way to turn it on without a key.
      enabled: config.get<boolean>('ai_enabled', false) || !!configured || !!openAiKey,
      provider,
      // Per provider: falling back to `OPENAI_MODEL` regardless meant an operator
      // who had set it and then switched to the CLI ran `claude --model gpt-…`,
      // and every call errored.
      model: (provider === 'openai'
        ? config.get<string>('openai_model', '')
        : config.get<string>('claude_model', '')) || DEFAULT_MODELS[provider],
      chat_enabled: config.get<boolean>('ai_chat_enabled', false),
    };
  }

  async getSettings(): Promise<AiSettings> {
    if (this.cached) return this.cached;
    const row = await this.db
      .select({ value: schema.app_settings.value })
      .from(schema.app_settings)
      .where(eq(schema.app_settings.key, AI_SETTINGS_KEY))
      .get();

    let stored: Partial<AiSettings> | null = null;
    if (row) {
      try {
        stored = JSON.parse(row.value) as Partial<AiSettings>;
      } catch {
        this.logger.warn('Stored AI settings are not valid JSON; using defaults');
      }
    }
    this.cached = normalizeSettings(stored, this.envDefaults);
    return this.cached;
  }

  async updateSettings(patch: Partial<AiSettings>): Promise<AiStatus> {
    const current = await this.getSettings();
    // Changing provider without naming a model has to drop the old provider's
    // model id, or switching to OpenAI leaves it pointed at a Claude model —
    // merging the patch over the current settings alone keeps it.
    const merged: Partial<AiSettings> = { ...current, ...patch };
    if (patch.provider && patch.provider !== current.provider && patch.model === undefined) {
      merged.model = '';
    }
    const next = normalizeSettings(merged, current);
    const value = JSON.stringify(next);

    await this.db
      .insert(schema.app_settings)
      .values({ key: AI_SETTINGS_KEY, value, updated_at: new Date() })
      .onConflictDoUpdate({
        target: schema.app_settings.key,
        set: { value, updated_at: new Date() },
      });

    this.cached = next;
    if (next.provider !== current.provider || next.model !== current.model) this.lastError = null;
    return this.getStatus();
  }

  async getStatus(): Promise<AiStatus> {
    const settings = await this.getSettings();
    const reason = await this.providers[settings.provider].unavailableReason();
    return {
      ...settings,
      available: settings.enabled && reason === null,
      unavailable_reason: settings.enabled ? reason : 'Turned off in settings',
      last_error: this.lastError,
      default_models: DEFAULT_MODELS,
    };
  }

  /** Cheap synchronous-ish gate for callers that just want to skip the work. */
  async isUsable(): Promise<boolean> {
    const status = await this.getStatus();
    return status.available;
  }

  /** True when the assistant should be offered at all. */
  async isChatEnabled(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.chat_enabled && (await this.isUsable());
  }

  async extractMetadata(
    filename: string,
    existingTags: Record<string, string | null>,
  ): Promise<AiMetaResult | null> {
    const tagSummary = Object.entries(existingTags)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const parsed = await this.askJson<Partial<AiMetaResult>>(
      METADATA_PROMPT,
      `Filename: ${filename}\nExisting tags: ${tagSummary || 'none'}`,
    );
    if (!parsed) return null;

    const result: AiMetaResult = {
      title: typeof parsed.title === 'string' ? parsed.title : null,
      artist: typeof parsed.artist === 'string' ? parsed.artist : null,
      album: typeof parsed.album === 'string' ? parsed.album : null,
      year: typeof parsed.year === 'number' ? parsed.year : null,
      genres: Array.isArray(parsed.genres) ? parsed.genres.filter((g) => typeof g === 'string') : [],
      is_cover: parsed.is_cover === true,
      original_artist: typeof parsed.original_artist === 'string' ? parsed.original_artist : null,
      original_artist_verified: false,
    };

    return this.attribute(result);
  }

  /**
   * Settles who the song belongs to against MusicBrainz, for the one field the
   * model is worst at: a filename says who performed a cover, almost never who
   * wrote or first released it, so the model was answering from memory alone and
   * confidently naming the wrong artist.
   *
   * Neither source is trusted by itself. MusicBrainz matches titles fuzzily enough
   * that a bare search for "Creep" ranks a band called Flexx G above Radiohead, so
   * it supplies a shortlist rather than an answer; the model picks from that
   * shortlist rather than from memory, and may pick nothing. Only a name that came
   * back through this is marked verified.
   *
   * Costs at most one extra model call and is skipped entirely for a track whose
   * attribution is already settled and confirmable.
   */
  private async attribute(result: AiMetaResult): Promise<AiMetaResult> {
    if (!result.title) return result;

    // A non-cover is its performer's own song; there is nothing to attribute.
    if (!result.is_cover) return result;

    if (result.original_artist) {
      const confirmed = await this.musicbrainz.verify(result.title, result.original_artist);
      if (confirmed) {
        return { ...result, original_artist: confirmed.artist, original_artist_verified: true };
      }
    }

    // Wide on purpose: MusicBrainz ranks a title-only search by fuzzy relevance,
    // and Radiohead sits below two unrelated bands called Creep until the list is
    // deep enough to reach them. One request either way.
    const candidates = await this.musicbrainz.findCandidates(result.title, null, 25);
    // Exclude the performer of this recording: they are who we already know it
    // isn't, and leaving them in invites the model to answer with the coverer.
    const others = dedupeArtists(candidates).filter((c) => !sameArtist(c.artist, result.artist));
    if (!others.length) return result;

    const chosen = await this.askJson<{ original_artist?: unknown }>(
      ATTRIBUTION_PROMPT,
      [
        `Title: ${result.title}`,
        result.artist ? `Performed on this recording by: ${result.artist}` : null,
        'MusicBrainz recordings with this exact title:',
        ...others.map((c) => `- ${c.artist} (${c.first_release_date ?? 'date unknown'})`),
      ].filter(Boolean).join('\n'),
    );

    const name = typeof chosen?.original_artist === 'string' ? chosen.original_artist.trim() : '';
    const match = others.find((c) => sameArtist(c.artist, name));
    if (!match) return result;

    return { ...result, original_artist: match.artist, original_artist_verified: true };
  }

  /**
   * One JSON round-trip through the configured provider. Null on any failure —
   * unconfigured, unreachable, or an answer that wasn't parseable JSON.
   */
  async askJson<T>(system: string, user: string): Promise<T | null> {
    const settings = await this.getSettings();
    if (!settings.enabled) return null;

    const provider = this.providers[settings.provider];
    const reason = await provider.unavailableReason();
    if (reason) {
      this.logger.debug(`AI request skipped: ${reason}`);
      return null;
    }

    try {
      const raw = await provider.complete(system, user, settings.model);
      const parsed = parseJsonObject<T>(raw);
      // Only a usable answer clears the flag: a call that "succeeds" but returns
      // nothing parseable is still something the operator should see.
      if (parsed) this.lastError = null;
      else this.lastError = `${provider.name} (${settings.model}) returned nothing usable`;
      return parsed;
    } catch (e) {
      this.lastError = `${provider.name} (${settings.model}): ${(e as Error).message}`;
      this.logger.warn(`AI request failed — ${this.lastError}`);
      return null;
    }
  }
}

function sameArtist(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.normalize('NFKC').toLowerCase().trim() === b.normalize('NFKC').toLowerCase().trim();
}

/** One row per artist — MusicBrainz lists every reissue of the same recording. */
function dedupeArtists(candidates: RecordingCandidate[]): RecordingCandidate[] {
  const byArtist = new Map<string, RecordingCandidate>();
  for (const c of candidates) {
    const key = c.artist.normalize('NFKC').toLowerCase();
    const seen = byArtist.get(key);
    if (!seen || (c.first_release_date ?? '9999') < (seen.first_release_date ?? '9999')) {
      byArtist.set(key, c);
    }
  }
  return [...byArtist.values()];
}
