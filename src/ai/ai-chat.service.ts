import { Injectable, Logger, ForbiddenException, Inject } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { AiService } from './ai.service';
import { SearchService } from '../search/search.service';
import { PlaylistsService } from '../playlists/playlists.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Something the browser has to carry out, because the server can't.
 *
 * Playback lives in the page — the server has no speaker — so the assistant
 * can't "play" anything itself. It names what should happen and the client does
 * it, which also means the user sees the queue change rather than being told it
 * did.
 */
export interface ChatAction {
  type: 'play' | 'open_playlist';
  track_ids?: string[];
  playlist_id?: string;
  label?: string;
}

export interface ChatReply {
  reply: string;
  actions: ChatAction[];
  /** Names of the tools that ran, in order — shown so the answer is inspectable. */
  used_tools: string[];
}

interface ToolStep {
  tool?: string;
  args?: Record<string, unknown>;
  reply?: string;
  actions?: ChatAction[];
}

/** Bounded so a confused model can't spend the user's quota in a loop. */
const MAX_TOOL_STEPS = 6;
const MAX_HISTORY = 12;

const SYSTEM_PROMPT = `You are the assistant inside Podo, a personal music server. You help someone find, queue and organise the music that is already in their own library.

You answer ONLY with a single JSON object, nothing else. Two shapes:

To use a tool:
{"tool": "<name>", "args": { ... }}

To finish:
{"reply": "<what to say to the person>", "actions": [ ... ]}

Tools:
- search_tracks {"query": string, "limit"?: number} — full-text search of the library. Use this before referring to any track; never invent ids.
- list_playlists {} — the person's playlists.
- get_playlist {"playlist_id": string} — one playlist and its tracks.
- create_playlist {"name": string, "track_ids"?: string[]} — make a new playlist.
- add_to_playlist {"playlist_id": string, "track_ids": string[]} — append to one.
- get_favorites {"limit"?: number} — tracks the person favourited.

Actions (optional, in the final reply):
- {"type": "play", "track_ids": ["..."], "label": "..."} — start playing these, in this order.
- {"type": "open_playlist", "playlist_id": "...", "label": "..."} — take them to a playlist.

Rules:
- Track and playlist ids come only from tool results. If a search finds nothing, say so — never guess an id.
- The library is heavy on Korean and Japanese music, much of it covers. Search in the script the person used, and try a romanization or the original script as a second query when the first finds nothing.
- Keep replies short and concrete. Name the tracks you found.
- Only create or modify a playlist when you were actually asked to.`;

/**
 * The chat assistant.
 *
 * Tool use is a JSON protocol in the prompt rather than a provider's native
 * function calling, because the two providers don't share one: the Claude Code
 * CLI is driven by a single prompt with no tool API. One protocol keeps both
 * providers on the same path and keeps the loop here, where it can be bounded
 * and audited, instead of inside a vendor SDK.
 *
 * Every tool is scoped to the calling user and reads or writes only their own
 * library and playlists, so a confused model can't reach anyone else's data.
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly ai: AiService,
    private readonly search: SearchService,
    private readonly playlists: PlaylistsService,
    @Inject(DB_TOKEN) private readonly db: Db,
  ) {}

  async chat(messages: ChatMessage[], userId: string): Promise<ChatReply> {
    if (!(await this.ai.isChatEnabled())) {
      throw new ForbiddenException('The assistant is turned off');
    }

    const history = messages.slice(-MAX_HISTORY);
    const transcript = history
      .map((m) => `${m.role === 'user' ? 'Person' : 'You'}: ${m.content}`)
      .join('\n');

    const usedTools: string[] = [];
    let toolLog = '';

    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const prompt = toolLog
        ? `${transcript}\n\nTool results so far:\n${toolLog}\n\nRespond with the next JSON object.`
        : `${transcript}\n\nRespond with a single JSON object.`;

      const parsed = await this.ai.askJson<ToolStep>(SYSTEM_PROMPT, prompt);
      if (!parsed) {
        return {
          reply: "I couldn't reach the model just now. Check Settings → AI.",
          actions: [],
          used_tools: usedTools,
        };
      }

      if (parsed.reply !== undefined || !parsed.tool) {
        return {
          reply: parsed.reply?.trim() || "I'm not sure what to do with that.",
          actions: this.sanitizeActions(parsed.actions),
          used_tools: usedTools,
        };
      }

      usedTools.push(parsed.tool);
      const result = await this.runTool(parsed.tool, parsed.args ?? {}, userId);
      toolLog += `\n${parsed.tool}(${JSON.stringify(parsed.args ?? {})}) -> ${JSON.stringify(result)}`;
    }

    // Out of steps: answer with what the tools already found rather than nothing.
    const parsed = await this.ai.askJson<ToolStep>(
      SYSTEM_PROMPT,
      `${transcript}\n\nTool results so far:\n${toolLog}\n\nYou have used all available tool steps. Respond now with the final {"reply": ...} object.`,
    );
    return {
      reply: parsed?.reply?.trim() || 'That turned out to need more steps than I have.',
      actions: this.sanitizeActions(parsed?.actions),
      used_tools: usedTools,
    };
  }

  /** Drops anything malformed rather than handing the client ids to act on blindly. */
  private sanitizeActions(actions: ChatAction[] | undefined): ChatAction[] {
    if (!Array.isArray(actions)) return [];
    return actions
      .filter((a): a is ChatAction => !!a && (a.type === 'play' || a.type === 'open_playlist'))
      .map((a) => ({
        type: a.type,
        label: typeof a.label === 'string' ? a.label.slice(0, 120) : undefined,
        track_ids: Array.isArray(a.track_ids)
          ? a.track_ids.filter((id): id is string => typeof id === 'string').slice(0, 200)
          : undefined,
        playlist_id: typeof a.playlist_id === 'string' ? a.playlist_id : undefined,
      }))
      .filter((a) => (a.type === 'play' ? !!a.track_ids?.length : !!a.playlist_id))
      .slice(0, 4);
  }

  private async runTool(
    tool: string,
    args: Record<string, unknown>,
    userId: string,
  ): Promise<unknown> {
    const str = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '');
    const ids = (key: string): string[] =>
      Array.isArray(args[key]) ? (args[key] as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    const num = (key: string, fallback: number): number =>
      typeof args[key] === 'number' ? (args[key] as number) : fallback;

    try {
      switch (tool) {
        case 'search_tracks': {
          const hits = await this.search.search(str('query'), ['track'], Math.min(num('limit', 10), 25));
          return (hits.tracks ?? []).map((h) => ({ id: h.id, title: h.name, artist: h.artist ?? null }));
        }
        case 'list_playlists': {
          const rows = await this.playlists.findAll(userId);
          return rows.map((p) => ({ id: p.id, name: p.name }));
        }
        case 'get_playlist': {
          return await this.playlists.findOne(str('playlist_id'), userId);
        }
        case 'create_playlist': {
          const created = await this.playlists.create({ name: str('name') || 'New playlist' }, userId);
          if (!created) return { error: 'could not create the playlist' };
          const trackIds = ids('track_ids');
          if (trackIds.length) await this.playlists.addTracks(created.id, trackIds, userId);
          return { id: created.id, name: created.name, added: trackIds.length };
        }
        case 'add_to_playlist': {
          const trackIds = ids('track_ids');
          await this.playlists.addTracks(str('playlist_id'), trackIds, userId);
          return { ok: true, added: trackIds.length };
        }
        case 'get_favorites': {
          const rows = await this.db
            .select({ id: schema.tracks.id, title: schema.tracks.title, artist: schema.tracks.artist })
            .from(schema.favorites)
            .innerJoin(schema.tracks, eq(schema.favorites.track_id, schema.tracks.id))
            .where(and(eq(schema.favorites.user_id, userId), isNull(schema.tracks.deleted_at)))
            .orderBy(desc(schema.favorites.created_at))
            .limit(Math.min(num('limit', 20), 50));
          return rows;
        }
        default:
          return { error: `unknown tool "${tool}"` };
      }
    } catch (e) {
      // Handed back to the model rather than thrown: a tool it called wrongly is
      // something it can recover from on the next step.
      this.logger.debug(`Tool ${tool} failed: ${(e as Error).message}`);
      return { error: (e as Error).message };
    }
  }
}
