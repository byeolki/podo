import { Injectable, NotFoundException, Inject, Logger, Optional } from '@nestjs/common';
import { eq, and, isNull, asc, inArray, desc } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import * as path from 'path';
import { AiService } from '../ai/ai.service';

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Optional() private readonly ai: AiService | null,
  ) {}

  async findAll() {
    const rawTracks = await this.db
      .select()
      .from(schema.tracks)
      .where(isNull(schema.tracks.deleted_at))
      .orderBy(asc(schema.tracks.added_at));

    if (!rawTracks.length) return [];

    const trackIds = rawTracks.map((t) => t.id);
    const [trackArtists, videoSources, overrides] = await Promise.all([
      this.db
        .select({ track_id: schema.track_artists.track_id, artist: schema.artists, position: schema.track_artists.position })
        .from(schema.track_artists)
        .innerJoin(schema.artists, eq(schema.track_artists.artist_id, schema.artists.id))
        .where(inArray(schema.track_artists.track_id, trackIds))
        .orderBy(asc(schema.track_artists.position)),
      this.db
        .selectDistinct({ track_id: schema.sources.track_id })
        .from(schema.sources)
        .where(and(eq(schema.sources.media_kind, 'video'), eq(schema.sources.available, true), isNull(schema.sources.deleted_at), inArray(schema.sources.track_id, trackIds))),
      this.db
        .select()
        .from(schema.track_metadata_overrides)
        .where(inArray(schema.track_metadata_overrides.track_id, trackIds)),
    ]);

    const artistsByTrack = new Map<string, (typeof schema.artists.$inferSelect)[]>();
    for (const ta of trackArtists) {
      if (!artistsByTrack.has(ta.track_id)) artistsByTrack.set(ta.track_id, []);
      artistsByTrack.get(ta.track_id)!.push(ta.artist);
    }

    const videoTrackIds = new Set(videoSources.map((s) => s.track_id));
    const overrideByTrack = new Map(overrides.map((o) => [o.track_id, o]));

    return rawTracks.map((t) => {
      const ov = overrideByTrack.get(t.id);
      const baseArtists = artistsByTrack.get(t.id) ?? [];
      const artistsResult = ov?.artist
        ? [{ id: '', name: ov.artist, is_custom: true, external_ids: {} }]
        : baseArtists;
      return {
        ...t,
        duration: t.canonical_duration,
        title: ov?.title ?? t.title,
        is_cover: ov?.is_cover ?? t.is_cover,
        artists: artistsResult,
        has_video: videoTrackIds.has(t.id) || !!ov?.video_locator,
        override: ov ?? null,
      };
    });
  }

  async findOne(id: string) {
    const track = await this.db
      .select()
      .from(schema.tracks)
      .where(and(eq(schema.tracks.id, id), isNull(schema.tracks.deleted_at)))
      .get();
    if (!track) throw new NotFoundException('Track not found');

    const [sources, artists, override, tags] = await Promise.all([
      this.db
        .select()
        .from(schema.sources)
        .where(and(eq(schema.sources.track_id, id), isNull(schema.sources.deleted_at))),
      this.db
        .select({ artist: schema.artists, position: schema.track_artists.position, role: schema.track_artists.role })
        .from(schema.track_artists)
        .innerJoin(schema.artists, eq(schema.track_artists.artist_id, schema.artists.id))
        .where(eq(schema.track_artists.track_id, id))
        .orderBy(asc(schema.track_artists.position)),
      this.db
        .select()
        .from(schema.track_metadata_overrides)
        .where(eq(schema.track_metadata_overrides.track_id, id))
        .get(),
      this.db
        .select({ tag: schema.tags })
        .from(schema.track_tags)
        .innerJoin(schema.tags, eq(schema.track_tags.tag_id, schema.tags.id))
        .where(eq(schema.track_tags.track_id, id)),
    ]);

    const artistsResult = override?.artist
      ? [{ id: '', name: override.artist, is_custom: true, external_ids: {}, position: 0, role: 'main' as const }]
      : artists.map((a) => ({ ...a.artist, position: a.position, role: a.role }));

    return {
      ...track,
      duration: track.canonical_duration,
      title: override?.title ?? track.title,
      is_cover: override?.is_cover ?? track.is_cover,
      track_number: override?.track_number ?? track.track_number,
      disc_number: override?.disc_number ?? track.disc_number,
      sources,
      artists: artistsResult,
      tags: tags.map((t) => t.tag),
      override: override ?? null,
    };
  }

  async applyOverride(
    trackId: string,
    dto: {
      title?: string;
      artist?: string;
      original_artist?: string;
      is_cover?: boolean;
      video_locator?: string;
      track_number?: number;
      disc_number?: number;
    },
    userId: string,
  ) {
    const track = await this.db.select().from(schema.tracks).where(eq(schema.tracks.id, trackId)).get();
    if (!track) throw new NotFoundException('Track not found');

    const set: Record<string, unknown> = { updated_by: userId, updated_at: new Date() };
    if (dto.title !== undefined) set.title = dto.title || null;
    if (dto.artist !== undefined) set.artist = dto.artist || null;
    if (dto.original_artist !== undefined) set.original_artist = dto.original_artist || null;
    if (dto.is_cover !== undefined) set.is_cover = dto.is_cover;
    if (dto.video_locator !== undefined) set.video_locator = dto.video_locator || null;
    if (dto.track_number !== undefined) set.track_number = dto.track_number ?? null;
    if (dto.disc_number !== undefined) set.disc_number = dto.disc_number ?? null;

    await this.db
      .insert(schema.track_metadata_overrides)
      .values({ track_id: trackId, updated_by: userId, updated_at: new Date(), ...set })
      .onConflictDoUpdate({ target: schema.track_metadata_overrides.track_id, set });

    this.logger.log(`Metadata override: track=${trackId} by user=${userId}`);
    return this.findOne(trackId);
  }

  async bulkApplyOverride(
    trackIds: string[],
    dto: { title?: string; track_number?: number; disc_number?: number },
    userId: string,
  ) {
    if (!trackIds.length) return { updated: 0 };

    const existing = await this.db
      .select({ id: schema.tracks.id })
      .from(schema.tracks)
      .where(inArray(schema.tracks.id, trackIds));

    const validIds = existing.map((r) => r.id);
    if (!validIds.length) return { updated: 0 };

    const now = new Date();
    await this.db
      .insert(schema.track_metadata_overrides)
      .values(
        validIds.map((id) => ({
          track_id: id,
          title: dto.title ?? null,
          track_number: dto.track_number ?? null,
          disc_number: dto.disc_number ?? null,
          updated_by: userId,
          updated_at: now,
        })),
      )
      .onConflictDoUpdate({
        target: schema.track_metadata_overrides.track_id,
        set: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.track_number !== undefined && { track_number: dto.track_number }),
          ...(dto.disc_number !== undefined && { disc_number: dto.disc_number }),
          updated_by: userId,
          updated_at: now,
        },
      });

    this.logger.log(`Bulk metadata override: ${validIds.length} tracks by user=${userId}`);
    return { updated: validIds.length };
  }

  async updateArtwork(trackId: string, artworkPath: string) {
    const track = await this.db.select().from(schema.tracks).where(eq(schema.tracks.id, trackId)).get();
    if (!track) throw new NotFoundException('Track not found');

    if (track.album_version_id) {
      await this.db
        .update(schema.album_versions)
        .set({ artwork_path: artworkPath, updated_at: new Date() })
        .where(eq(schema.album_versions.id, track.album_version_id));
    }

    return { artwork_path: artworkPath };
  }

  async getLyrics(trackId: string) {
    return this.db.select().from(schema.lyrics).where(eq(schema.lyrics.track_id, trackId)).get();
  }

  async aiAutofill(trackIds: string[], userId: string): Promise<{ track_id: string; applied: boolean; result: Record<string, unknown> | null }[]> {
    if (!this.ai?.enabled) return trackIds.map((id) => ({ track_id: id, applied: false, result: null }));

    const tracks = await this.db
      .select({ id: schema.tracks.id, title: schema.tracks.title })
      .from(schema.tracks)
      .where(inArray(schema.tracks.id, trackIds));

    const sources = await this.db
      .select({ track_id: schema.sources.track_id, locator: schema.sources.locator, media_kind: schema.sources.media_kind })
      .from(schema.sources)
      .where(and(inArray(schema.sources.track_id, trackIds), eq(schema.sources.available, true), isNull(schema.sources.deleted_at)));

    const sourceByTrack = new Map<string, string>();
    for (const s of sources) {
      if (s.media_kind === 'audio' && !sourceByTrack.has(s.track_id)) {
        sourceByTrack.set(s.track_id, s.locator);
      }
    }
    for (const s of sources) {
      if (!sourceByTrack.has(s.track_id)) sourceByTrack.set(s.track_id, s.locator);
    }

    const results: { track_id: string; applied: boolean; result: Record<string, unknown> | null }[] = [];

    for (const track of tracks) {
      const locator = sourceByTrack.get(track.id);
      if (!locator) { results.push({ track_id: track.id, applied: false, result: null }); continue; }

      const filename = path.basename(locator);
      const aiResult = await this.ai.extractMetadata(filename, { title: track.title });

      if (!aiResult) { results.push({ track_id: track.id, applied: false, result: null }); continue; }

      const set: Record<string, unknown> = { updated_by: userId, updated_at: new Date() };
      if (aiResult.title) set.title = aiResult.title;
      if (aiResult.artist) set.artist = aiResult.artist;
      if (aiResult.is_cover !== undefined) set.is_cover = aiResult.is_cover;
      if (aiResult.original_artist) set.original_artist = aiResult.original_artist;

      await this.db
        .insert(schema.track_metadata_overrides)
        .values({ track_id: track.id, updated_by: userId, updated_at: new Date(), ...set })
        .onConflictDoUpdate({ target: schema.track_metadata_overrides.track_id, set });

      results.push({ track_id: track.id, applied: true, result: aiResult as unknown as Record<string, unknown> });
    }

    return results;
  }

  async addCoverMapping(coverTrackId: string, originalTrackId: string, userId: string) {
    const [cover, original] = await Promise.all([
      this.db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.id, coverTrackId)).get(),
      this.db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.id, originalTrackId)).get(),
    ]);
    if (!cover) throw new NotFoundException('Cover track not found');
    if (!original) throw new NotFoundException('Original track not found');

    const id = newId();
    await this.db
      .insert(schema.cover_mappings)
      .values({ id, cover_track_id: coverTrackId, original_track_id: originalTrackId, created_by: userId })
      .onConflictDoNothing();
    this.logger.log(`Cover mapping: ${coverTrackId} → ${originalTrackId}`);
    return { id };
  }
}
