import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
import { eq, and, isNull, asc, inArray } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async findAll(limit = 50) {
    return this.db
      .select()
      .from(schema.tracks)
      .where(isNull(schema.tracks.deleted_at))
      .orderBy(asc(schema.tracks.added_at))
      .limit(limit);
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

    return {
      ...track,
      title: override?.title ?? track.title,
      track_number: override?.track_number ?? track.track_number,
      disc_number: override?.disc_number ?? track.disc_number,
      sources,
      artists: artists.map((a) => ({ ...a.artist, position: a.position, role: a.role })),
      tags: tags.map((t) => t.tag),
    };
  }

  async applyOverride(
    trackId: string,
    dto: { title?: string; track_number?: number; disc_number?: number },
    userId: string,
  ) {
    const track = await this.db.select().from(schema.tracks).where(eq(schema.tracks.id, trackId)).get();
    if (!track) throw new NotFoundException('Track not found');

    await this.db
      .insert(schema.track_metadata_overrides)
      .values({
        track_id: trackId,
        title: dto.title ?? null,
        track_number: dto.track_number ?? null,
        disc_number: dto.disc_number ?? null,
        updated_by: userId,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.track_metadata_overrides.track_id,
        set: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.track_number !== undefined && { track_number: dto.track_number }),
          ...(dto.disc_number !== undefined && { disc_number: dto.disc_number }),
          updated_by: userId,
          updated_at: new Date(),
        },
      });

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
