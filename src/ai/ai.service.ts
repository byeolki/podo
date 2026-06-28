import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface AiMetaResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  genres: string[];
  is_cover: boolean;
  original_artist: string | null;
}

const SYSTEM_PROMPT = `You are a music metadata expert. Given a filename and any known tags, extract structured metadata.
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
- is_cover = true when the filename or tags suggest this is a cover version (e.g. "cover by X", "X covers Y", "(covered by X)")
- original_artist = the original song's artist when is_cover is true, otherwise null
- Return null for fields you cannot determine with reasonable confidence
- genres should be an empty array if unknown`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('openai_api_key', '');
    this.model = config.get<string>('openai_model', 'gpt-4o-mini');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async extractMetadata(filename: string, existingTags: Record<string, string | null>): Promise<AiMetaResult | null> {
    if (!this.client) return null;

    const tagSummary = Object.entries(existingTags)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const userMessage = `Filename: ${filename}\nExisting tags: ${tagSummary || 'none'}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      });

      const text = response.choices[0]?.message?.content ?? '';
      const parsed = JSON.parse(text) as AiMetaResult;
      return parsed;
    } catch (e) {
      this.logger.warn(`AI extraction failed for ${filename}: ${(e as Error).message}`);
      return null;
    }
  }
}
