import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { eq, and, gt } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: { name: string; email: string; password: string; invite_token: string }) {
    const now = new Date();

    const invite = await this.db
      .select()
      .from(schema.invite_tokens)
      .where(
        and(
          eq(schema.invite_tokens.token, dto.invite_token),
          gt(schema.invite_tokens.expires_at, now),
        ),
      )
      .get();

    if (!invite || invite.used_by) throw new BadRequestException('Invalid or expired invite token');

    const existing = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .get();
    if (existing) throw new ConflictException('Email already in use');

    const password_hash = await bcrypt.hash(dto.password, 12);
    const userId = newId();

    await this.db.insert(schema.users).values({
      id: userId,
      name: dto.name,
      email: dto.email,
      password_hash,
      role: 'user',
    });

    await this.db
      .update(schema.invite_tokens)
      .set({ used_by: userId, used_at: now })
      .where(eq(schema.invite_tokens.token, dto.invite_token));

    return this.issueTokens(userId, dto.email, 'user');
  }

  async login(dto: { email: string; password: string }) {
    const user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .get();

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.email, user.role);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.db
      .select()
      .from(schema.refresh_tokens)
      .where(
        and(
          eq(schema.refresh_tokens.token_hash, tokenHash),
          gt(schema.refresh_tokens.expires_at, new Date()),
        ),
      )
      .get();

    if (!stored) throw new UnauthorizedException('Invalid or expired refresh token');

    const user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, stored.user_id))
      .get();
    if (!user) throw new UnauthorizedException();

    await this.db
      .delete(schema.refresh_tokens)
      .where(eq(schema.refresh_tokens.id, stored.id));

    return this.issueTokens(user.id, user.email, user.role);
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.db
      .delete(schema.refresh_tokens)
      .where(eq(schema.refresh_tokens.token_hash, tokenHash));
  }

  async createInvite(adminUserId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.db.insert(schema.invite_tokens).values({
      token,
      created_by: adminUserId,
      expires_at: expiresAt,
    });
    return token;
  }

  async bootstrapAdmin(dto: { name: string; email: string; password: string }) {
    const count = await this.db.$count(schema.users);
    if (count > 0) throw new BadRequestException('Server already has users');

    const password_hash = await bcrypt.hash(dto.password, 12);
    const userId = newId();

    await this.db.insert(schema.users).values({
      id: userId,
      name: dto.name,
      email: dto.email,
      password_hash,
      role: 'admin',
    });

    return this.issueTokens(userId, dto.email, 'admin');
  }

  private async issueTokens(userId: string, email: string, role: string) {
    const accessPayload: JwtPayload = { sub: userId, email, role, type: 'access' };
    const accessToken = this.jwt.sign(accessPayload, {
      expiresIn: this.config.get('jwt_access_expires_in', '15m'),
    });

    const rawRefresh = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawRefresh);
    const expiresAt = this.parseExpiry(this.config.get('jwt_refresh_expires_in', '30d'));

    await this.db.insert(schema.refresh_tokens).values({
      id: newId(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    return { access_token: accessToken, refresh_token: rawRefresh };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private parseExpiry(expr: string): Date {
    const unit = expr.slice(-1);
    const n = parseInt(expr.slice(0, -1), 10);
    const ms: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return new Date(Date.now() + n * (ms[unit] ?? 86400000));
  }
}
