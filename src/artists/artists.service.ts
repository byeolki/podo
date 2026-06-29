import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';

@Injectable()
export class ArtistsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  findAll() {
    return this.db.select().from(schema.artists).orderBy(asc(schema.artists.name));
  }

  async findOne(id: string) {
    const artist = await this.db.select().from(schema.artists).where(eq(schema.artists.id, id)).get();
    if (!artist) throw new NotFoundException('Artist not found');

    const tracks = await this.db
      .select({ track: schema.tracks, position: schema.track_artists.position, role: schema.track_artists.role })
      .from(schema.track_artists)
      .innerJoin(schema.tracks, eq(schema.track_artists.track_id, schema.tracks.id))
      .where(eq(schema.track_artists.artist_id, id));

    const covers = await this.db
      .select({ track: schema.tracks })
      .from(schema.cover_mappings)
      .innerJoin(schema.tracks, eq(schema.cover_mappings.cover_track_id, schema.tracks.id))
      .innerJoin(schema.track_artists, eq(schema.track_artists.track_id, schema.tracks.id))
      .where(eq(schema.track_artists.artist_id, id));

    return {
      ...artist,
      tracks: tracks.map((t) => ({ ...t.track, duration: t.track.canonical_duration })),
      covers: covers.map((c) => ({ ...c.track, duration: c.track.canonical_duration })),
    };
  }

  async create(dto: { name: string; is_custom?: boolean }, userId: string) {
    const id = newId();
    await this.db.insert(schema.artists).values({
      id,
      name: dto.name.trim(),
      is_custom: dto.is_custom ?? true,
      external_ids: {},
      created_by: userId,
    });
    return this.findOne(id);
  }

  async update(id: string, dto: { name?: string; external_ids?: Record<string, string> }) {
    const artist = await this.db.select().from(schema.artists).where(eq(schema.artists.id, id)).get();
    if (!artist) throw new NotFoundException('Artist not found');

    await this.db.update(schema.artists).set({
      ...(dto.name && { name: dto.name.trim() }),
      ...(dto.external_ids && { external_ids: dto.external_ids }),
      updated_at: new Date(),
    }).where(eq(schema.artists.id, id));

    return this.findOne(id);
  }
}
