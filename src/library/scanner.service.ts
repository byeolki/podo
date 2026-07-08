import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, and, inArray } from "drizzle-orm";
import { Db, DB_TOKEN } from "../db/database.module";
import * as schema from "../db/schema";
import { FfprobeService } from "./ffprobe.service";
import { MetadataService } from "./metadata.service";
import { EventsService } from "../sync/events.service";
import { AiService } from "../ai/ai.service";
import { newId } from "../common/id";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn } from "child_process";
import PQueue from "p-queue";

const AUDIO_EXTS = new Set([".mp3", ".m4a", ".flac", ".aac", ".wav", ".ogg", ".opus"]);
const VIDEO_EXTS = new Set([".mp4", ".m4v", ".mkv"]);
const SUPPORTED_EXTS = new Set([...AUDIO_EXTS, ...VIDEO_EXTS]);

function mediaKind(ext: string): "audio" | "video" | null {
    if (AUDIO_EXTS.has(ext)) return "audio";
    if (VIDEO_EXTS.has(ext)) return "video";
    return null;
}

@Injectable()
export class ScannerService {
    private readonly logger = new Logger(ScannerService.name);
    private readonly scanQueue = new PQueue({ concurrency: 4 });
    private activeScanJobId: string | null = null;
    private readonly artworkDir: string;

    constructor(
        @Inject(DB_TOKEN) private readonly db: Db,
        private readonly ffprobe: FfprobeService,
        private readonly metadata: MetadataService,
        private readonly events: EventsService,
        private readonly config: ConfigService,
        @Optional() private readonly ai: AiService | null,
    ) {
        this.artworkDir = config.get<string>("artwork_dir", path.join(process.cwd(), "data", "artwork"));
        fs.mkdirSync(this.artworkDir, { recursive: true });
    }

    async scanRoot(libraryRootId: string, rootPath: string): Promise<string> {
        const jobId = newId();
        await this.db.insert(schema.scan_jobs).values({
            id: jobId,
            library_root_id: libraryRootId,
            status: "running",
        });

        this.activeScanJobId = jobId;
        this.events.emit("scan.started", { job_id: jobId, root: rootPath });

        setImmediate(() => this.runScan(jobId, libraryRootId, rootPath));
        return jobId;
    }

    async scanFile(filePath: string, origin: "local" | "ytdlp" = "local", sourceUrl?: string): Promise<void> {
        const ext = path.extname(filePath).toLowerCase();
        const kind = mediaKind(ext);
        if (!kind) return;

        try {
            await this.scanQueue.add(() => this.upsertSource(filePath, kind, origin, sourceUrl));
        } catch (e) {
            this.logger.error(
                `Failed to scan ${filePath}`,
                e instanceof Error ? e.stack : String(e),
            );
        }
    }

    async removeFile(filePath: string): Promise<void> {
        try {
            const source = await this.db
                .select()
                .from(schema.sources)
                .where(eq(schema.sources.locator, filePath))
                .get();

            if (!source) return;

            await this.db
                .update(schema.sources)
                .set({ available: false, deleted_at: new Date(), updated_at: new Date() })
                .where(eq(schema.sources.id, source.id));

            this.events.emit("source.removed", { source_id: source.id, track_id: source.track_id });
        } catch (e) {
            this.logger.error(
                `Failed to remove ${filePath}`,
                e instanceof Error ? e.stack : String(e),
            );
        }
    }

    private async runScan(jobId: string, libraryRootId: string, rootPath: string): Promise<void> {
        try {
            const files = this.walkDir(rootPath);
            const total = files.length;

            await this.db
                .update(schema.scan_jobs)
                .set({ total_files: total })
                .where(eq(schema.scan_jobs.id, jobId));

            let processed = 0;
            let added = 0;
            let updated = 0;

            for (const filePath of files) {
                const ext = path.extname(filePath).toLowerCase();
                const kind = mediaKind(ext);
                if (!kind) {
                    processed++;
                    continue;
                }

                try {
                    const result = await this.scanQueue.add(() =>
                        this.upsertSource(filePath, kind),
                    );
                    if (result === "added") added++;
                    else if (result === "updated") updated++;
                } catch (e) {
                    this.logger.warn(
                        `Failed to scan ${filePath}`,
                        e instanceof Error ? e.stack : String(e),
                    );
                }

                processed++;
                if (processed % 50 === 0) {
                    await this.db
                        .update(schema.scan_jobs)
                        .set({ processed_files: processed, added, updated })
                        .where(eq(schema.scan_jobs.id, jobId));

                    this.events.emit("scan.progress", {
                        job_id: jobId,
                        total,
                        processed,
                        added,
                        updated,
                    });
                }
            }

            await this.markMissingUnavailable(rootPath);

            await this.db
                .update(schema.scan_jobs)
                .set({
                    status: "completed",
                    processed_files: processed,
                    added,
                    updated,
                    finished_at: new Date(),
                })
                .where(eq(schema.scan_jobs.id, jobId));

            await this.db
                .update(schema.library_roots)
                .set({ last_scan_at: new Date() })
                .where(eq(schema.library_roots.id, libraryRootId));

            this.events.emit("scan.completed", { job_id: jobId, total, added, updated });
        } catch (e) {
            await this.db
                .update(schema.scan_jobs)
                .set({
                    status: "failed",
                    error: String(e),
                    finished_at: new Date(),
                })
                .where(eq(schema.scan_jobs.id, jobId));

            this.events.emit("scan.failed", { job_id: jobId, error: String(e) });
        } finally {
            this.activeScanJobId = null;
        }
    }

    private async upsertSource(
        filePath: string,
        kind: "audio" | "video",
        origin: "local" | "ytdlp" = "local",
        sourceUrl?: string,
    ): Promise<"added" | "updated" | "skipped"> {
        let stat: fs.Stats;
        try {
            stat = fs.statSync(filePath);
        } catch {
            return "skipped";
        }

        const existing = await this.db
            .select()
            .from(schema.sources)
            .where(eq(schema.sources.locator, filePath))
            .get();

        if (existing) {
            const mtime = stat.mtimeMs;
            const existingMtime = existing.updated_at?.getTime() ?? 0;
            if (Math.abs(mtime - existingMtime) < 2000) return "skipped";
        }

        const probe = await this.ffprobe.probe(filePath);
        if (!probe) return "skipped";

        const meta = this.metadata.parseTags(probe);

        let isCover = false;
        let aiOverride: {
            title?: string;
            artist?: string;
            is_cover?: boolean;
            original_artist?: string;
        } | null = null;

        if (this.ai?.enabled) {
            const aiResult = await this.ai.extractMetadata(path.basename(filePath), {
                title: meta.title,
                artist: meta.artist,
                album: meta.album,
                genre: meta.genres.join(", ") || null,
            });
            if (aiResult) {
                if (!meta.title && aiResult.title) meta.title = aiResult.title;
                if (!meta.artist && aiResult.artist) meta.artist = aiResult.artist;
                if (!meta.album && aiResult.album) meta.album = aiResult.album;
                if (!meta.year && aiResult.year) meta.year = aiResult.year;
                if (!meta.genres.length && aiResult.genres.length) meta.genres = aiResult.genres;
                isCover = aiResult.is_cover;
                aiOverride = {
                    title: aiResult.title ?? undefined,
                    artist: aiResult.artist ?? undefined,
                    is_cover: aiResult.is_cover,
                    original_artist: aiResult.original_artist ?? undefined,
                };
            }
        }

        const title = meta.title ?? path.basename(filePath, path.extname(filePath));
        const fileHash = this.hashFile(filePath);

        let albumVersionId: string | null = null;
        if (meta.album) {
            albumVersionId = await this.metadata.resolveOrCreateAlbumVersion(meta.album, meta.year);
        }

        if (!existing) {
            const siblingTrackId = await this.findSiblingTrackId(filePath);
            if (siblingTrackId) {
                const sourceId = newId();
                await this.db
                    .insert(schema.sources)
                    .values({
                        id: sourceId,
                        track_id: siblingTrackId,
                        media_kind: kind,
                        origin,
                        format: probe.format,
                        codec: probe.codec,
                        bitrate: probe.bitrate ?? undefined,
                        sample_rate: probe.sample_rate ?? undefined,
                        channels: probe.channels ?? undefined,
                        duration: probe.duration ?? undefined,
                        locator: filePath,
                        file_hash: fileHash,
                        file_size: stat.size,
                        source_url: sourceUrl,
                    })
                    .onConflictDoNothing();
                this.events.emit("track.upserted", { track_id: siblingTrackId });
                await this.maybeSetThumbnail(siblingTrackId, filePath, kind, origin);
                await this.maybeSetLyrics(siblingTrackId, filePath, origin);
                return "added";
            }
        }

        if (existing) {
            const trackId = existing.track_id;

            await this.db
                .update(schema.tracks)
                .set({
                    title,
                    artist: meta.artist ?? undefined,
                    album_version_id: albumVersionId ?? undefined,
                    track_number: meta.track_number ?? undefined,
                    disc_number: meta.disc_number ?? undefined,
                    canonical_duration: probe.duration ?? undefined,
                    is_cover: isCover,
                    updated_at: new Date(),
                })
                .where(eq(schema.tracks.id, trackId));

            await this.db
                .update(schema.sources)
                .set({
                    format: probe.format,
                    codec: probe.codec,
                    bitrate: probe.bitrate ?? undefined,
                    sample_rate: probe.sample_rate ?? undefined,
                    channels: probe.channels ?? undefined,
                    duration: probe.duration ?? undefined,
                    replaygain_track: probe.replaygain_track ?? undefined,
                    replaygain_album: probe.replaygain_album ?? undefined,
                    file_hash: fileHash,
                    file_size: stat.size,
                    available: true,
                    deleted_at: null,
                    updated_at: new Date(),
                    source_url: sourceUrl ?? undefined,
                })
                .where(eq(schema.sources.id, existing.id));

            this.events.emit("track.upserted", { track_id: trackId });
            await this.maybeSetThumbnail(trackId, filePath, kind, origin);
            await this.maybeSetLyrics(trackId, filePath, origin);
            return "updated";
        }

        const trackId = newId();
        await this.db.insert(schema.tracks).values({
            id: trackId,
            title,
            artist: meta.artist ?? undefined,
            album_version_id: albumVersionId ?? undefined,
            track_number: meta.track_number ?? undefined,
            disc_number: meta.disc_number ?? undefined,
            canonical_duration: probe.duration ?? undefined,
            is_cover: isCover,
        });

        if (meta.genres.length) {
            const tagIds = await this.metadata.ensureGenres(meta.genres);
            for (const tagId of tagIds) {
                await this.db
                    .insert(schema.track_tags)
                    .values({ track_id: trackId, tag_id: tagId })
                    .onConflictDoNothing();
            }
        }

        const sourceId = newId();
        await this.db.insert(schema.sources).values({
            id: sourceId,
            track_id: trackId,
            media_kind: kind,
            origin,
            format: probe.format,
            codec: probe.codec,
            bitrate: probe.bitrate ?? undefined,
            sample_rate: probe.sample_rate ?? undefined,
            channels: probe.channels ?? undefined,
            duration: probe.duration ?? undefined,
            replaygain_track: probe.replaygain_track ?? undefined,
            replaygain_album: probe.replaygain_album ?? undefined,
            locator: filePath,
            file_hash: fileHash,
            file_size: stat.size,
            source_url: sourceUrl,
        });

        if (aiOverride) {
            await this.db
                .insert(schema.track_metadata_overrides)
                .values({
                    track_id: trackId,
                    title: aiOverride.title ?? null,
                    artist: aiOverride.artist ?? null,
                    is_cover: aiOverride.is_cover ?? false,
                    original_artist: aiOverride.original_artist ?? null,
                    updated_at: new Date(),
                })
                .onConflictDoNothing();
        }

        this.events.emit("track.upserted", { track_id: trackId });
        await this.maybeSetThumbnail(trackId, filePath, kind, origin);
        await this.maybeSetLyrics(trackId, filePath, origin);
        return "added";
    }

    // Skip if the track already has one — yt-dlp's own thumbnail (downloaded
    // alongside the media as a same-basename sidecar) always wins over a
    // ffmpeg-extracted video frame, and neither should be regenerated on
    // every rescan.
    private async maybeSetThumbnail(
        trackId: string,
        mediaFilePath: string,
        kind: "audio" | "video",
        origin: "local" | "ytdlp",
    ): Promise<void> {
        const track = await this.db
            .select({ thumbnail_path: schema.tracks.thumbnail_path })
            .from(schema.tracks)
            .where(eq(schema.tracks.id, trackId))
            .get();
        if (track?.thumbnail_path) return;

        const dest = path.join(this.artworkDir, `track_${trackId}_thumb.jpg`);

        if (origin === "ytdlp") {
            const sidecar = path.join(
                path.dirname(mediaFilePath),
                path.basename(mediaFilePath, path.extname(mediaFilePath)) + ".jpg",
            );
            if (fs.existsSync(sidecar)) {
                try {
                    fs.copyFileSync(sidecar, dest);
                    fs.unlinkSync(sidecar);
                    await this.db
                        .update(schema.tracks)
                        .set({ thumbnail_path: dest })
                        .where(eq(schema.tracks.id, trackId));
                } catch (e) {
                    this.logger.warn(`Failed to store yt-dlp thumbnail for track ${trackId}`, e instanceof Error ? e.stack : String(e));
                }
                return;
            }
        }

        if (kind === "video") {
            try {
                await this.extractFirstFrame(mediaFilePath, dest);
                await this.db
                    .update(schema.tracks)
                    .set({ thumbnail_path: dest })
                    .where(eq(schema.tracks.id, trackId));
            } catch (e) {
                this.logger.warn(`Failed to extract thumbnail frame for ${mediaFilePath}`, e instanceof Error ? e.stack : String(e));
            }
        }
    }

    private extractFirstFrame(videoPath: string, dest: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn("ffmpeg", ["-y", "-i", videoPath, "-frames:v", "1", "-update", "1", "-q:v", "3", dest]);
            let stderr = "";
            proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
            proc.on("close", (code) => {
                if (code === 0 && fs.existsSync(dest)) resolve();
                else reject(new Error(stderr.slice(-300)));
            });
            proc.on("error", reject);
        });
    }

    // yt-dlp downloads only manually-uploaded subtitle tracks (--write-subs,
    // never --write-auto-subs): auto-generated captions are ASR transcripts
    // and too unreliable to present as lyrics. Manual ones are frequently the
    // actual timed lyrics for official audio/lyric-video uploads. Every
    // available language is kept — this is a shared multi-user deployment,
    // not tied to any one language.
    private async maybeSetLyrics(trackId: string, mediaFilePath: string, origin: "local" | "ytdlp"): Promise<void> {
        if (origin !== "ytdlp") return;

        const dir = path.dirname(mediaFilePath);
        const stem = path.basename(mediaFilePath, path.extname(mediaFilePath));
        const vttPrefix = `${stem}.`;

        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            return;
        }

        const vttFiles = entries.filter((f) => f.startsWith(vttPrefix) && f.endsWith(".vtt"));

        for (const file of vttFiles) {
            const fullPath = path.join(dir, file);
            const language = file.slice(vttPrefix.length, -".vtt".length) || "und";

            try {
                const raw = fs.readFileSync(fullPath, "utf-8");
                const content = this.parseVttToLrc(raw);
                if (content) {
                    const existing = await this.db
                        .select({ source: schema.lyrics.source })
                        .from(schema.lyrics)
                        .where(and(eq(schema.lyrics.track_id, trackId), eq(schema.lyrics.language, language)))
                        .get();

                    if (!existing || existing.source !== "user") {
                        await this.db
                            .insert(schema.lyrics)
                            .values({ track_id: trackId, language, type: "synced", content, source: "local", updated_at: new Date() })
                            .onConflictDoUpdate({
                                target: [schema.lyrics.track_id, schema.lyrics.language],
                                set: { content, type: "synced", source: "local", updated_at: new Date() },
                            });
                    }
                }
            } catch (e) {
                this.logger.warn(`Failed to parse subtitle ${fullPath}`, e instanceof Error ? e.stack : String(e));
            } finally {
                try { fs.unlinkSync(fullPath); } catch {}
            }
        }
    }

    private parseVttToLrc(vttContent: string): string {
        const timeRe = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->/;
        const cues: { seconds: number; text: string }[] = [];

        const blocks = vttContent.replace(/\r\n/g, "\n").split(/\n\n+/);
        for (const block of blocks) {
            const blockLines = block.split("\n").filter((l) => l.trim().length > 0);
            if (!blockLines.length) continue;
            if (/^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(blockLines[0])) continue;

            const timeLineIdx = blockLines.findIndex((l) => timeRe.test(l));
            if (timeLineIdx === -1) continue;

            const match = blockLines[timeLineIdx].match(timeRe);
            if (!match) continue;
            const seconds =
                parseInt(match[1], 10) * 3600 +
                parseInt(match[2], 10) * 60 +
                parseInt(match[3], 10) +
                parseInt(match[4], 10) / 1000;

            const text = blockLines
                .slice(timeLineIdx + 1)
                .join(" ")
                .replace(/<[^>]*>/g, "")
                .trim();

            if (text) cues.push({ seconds, text });
        }

        return cues
            .map(({ seconds, text }) => {
                const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
                const ss = (seconds % 60).toFixed(2).padStart(5, "0");
                return `[${mm}:${ss}]${text}`;
            })
            .join("\n");
    }

    private async findSiblingTrackId(filePath: string): Promise<string | null> {
        const dir = path.dirname(filePath);
        const stem = path.basename(filePath, path.extname(filePath));
        const sources = await this.db
            .select({ track_id: schema.sources.track_id, locator: schema.sources.locator })
            .from(schema.sources)
            .where(eq(schema.sources.available, true));
        for (const s of sources) {
            if (s.locator === filePath) continue;
            if (
                path.dirname(s.locator) === dir &&
                path.basename(s.locator, path.extname(s.locator)) === stem
            ) {
                return s.track_id;
            }
        }
        return null;
    }

    private async markMissingUnavailable(rootPath: string): Promise<void> {
        const sources = await this.db
            .select({ id: schema.sources.id, locator: schema.sources.locator })
            .from(schema.sources)
            .where(and(eq(schema.sources.available, true), eq(schema.sources.origin, "local")));

        const missing = sources.filter((s) => {
            return s.locator.startsWith(rootPath) && !fs.existsSync(s.locator);
        });

        if (missing.length === 0) return;

        const ids = missing.map((s) => s.id);
        await this.db
            .update(schema.sources)
            .set({ available: false, deleted_at: new Date(), updated_at: new Date() })
            .where(inArray(schema.sources.id, ids));
    }

    private walkDir(dir: string): string[] {
        const results: string[] = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...this.walkDir(fullPath));
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (SUPPORTED_EXTS.has(ext)) results.push(fullPath);
                }
            }
        } catch (e) {
            this.logger.warn(`Cannot read directory ${dir}: ${e}`);
        }
        return results;
    }

    private hashFile(filePath: string): string {
        try {
            const fd = fs.openSync(filePath, "r");
            const buf = Buffer.alloc(65536);
            fs.readSync(fd, buf, 0, buf.length, 0);
            fs.closeSync(fd);
            return crypto.createHash("sha256").update(buf).digest("hex");
        } catch {
            return "";
        }
    }

    getActiveScanJobId(): string | null {
        return this.activeScanJobId;
    }
}
