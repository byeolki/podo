import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { TracksService } from '../tracks/tracks.service';

@Injectable()
export class ArtistsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly tracks: TracksService,
  ) {}

  findAll() {
    return this.db.select().from(schema.artists).orderBy(asc(schema.artists.name));
  }

  async findOne(id: string) {
    const artist = await this.db.select().from(schema.artists).where(eq(schema.artists.id, id)).get();
    if (!artist) throw new NotFoundException('Artist not found');

    const rows = await this.db
      .select({ track_id: schema.track_artists.track_id })
      .from(schema.track_artists)
      .where(eq(schema.track_artists.artist_id, id));

    const trackIds = rows.map((r) => r.track_id);
    const fullTracks = await this.tracks.findByIds(trackIds);

    return {
      ...artist,
      tracks: fullTracks,
      covers: [],
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
