import bcrypt from 'bcryptjs';
import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';
import { Partner, CreatePartnerDto, PartnerStatus } from '@bx/shared-types';

export class PartnerService {
  private db = getPool();

  async register(dto: CreatePartnerDto & { password: string }): Promise<Partner> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Check duplicate email across both partners and auth_users
      const emailCheck = await client.query(
        'SELECT 1 FROM auth_users WHERE email = $1',
        [dto.contactEmail]
      );
      if (emailCheck.rows.length) throw new Error('Email already registered');

      const domainCheck = await client.query(
        'SELECT 1 FROM partners WHERE domain = $1',
        [dto.domain]
      );
      if (domainCheck.rows.length) throw new Error('Domain already registered');

      // Create partner
      const partnerId = generateId();
      const { rows } = await client.query<Record<string, unknown>>(
        `INSERT INTO partners (id, name, domain, contact_email, webhook_url, supported_formats, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())
         RETURNING *`,
        [partnerId, dto.name, dto.domain, dto.contactEmail, dto.webhookUrl ?? null, dto.supportedFormats]
      );

      // Create auth user with hashed password
      const passwordHash = await bcrypt.hash(dto.password, 10);
      await client.query(
        `INSERT INTO auth_users (id, partner_id, email, password_hash, scopes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          generateId(),
          partnerId,
          dto.contactEmail,
          passwordHash,
          ['partner:read', 'partner:write', 'subscription:read', 'subscription:write', 'integration:send', 'mapping:read', 'mapping:write', 'agent:read'],
        ]
      );

      await client.query('COMMIT');
      return this.mapRow(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<Partner | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM partners WHERE id = $1',
      [id]
    );
    return rows.length ? this.mapRow(rows[0]) : null;
  }

  async listApproved({ page, pageSize }: { page: number; pageSize: number }): Promise<{ data: Partner[]; total: number; page: number; pageSize: number }> {
    const offset = (page - 1) * pageSize;
    const [{ rows }, countResult] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        'SELECT * FROM partners WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        ['approved', pageSize, offset]
      ),
      this.db.query<{ count: string }>('SELECT COUNT(*) FROM partners WHERE status = $1', ['approved']),
    ]);
    return {
      data: rows.map((r) => this.mapRow(r)),
      total: parseInt(countResult.rows[0].count),
      page,
      pageSize,
    };
  }

  async listPending(): Promise<Partner[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM partners WHERE status = 'pending' ORDER BY created_at ASC"
    );
    return rows.map((r) => this.mapRow(r));
  }

  async listAll(): Promise<Partner[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM partners WHERE id != '00000000-0000-0000-0000-000000000001' ORDER BY created_at DESC"
    );
    return rows.map((r) => this.mapRow(r));
  }

  async approve(id: string): Promise<Partner> {
    return this.updateStatus(id, 'approved');
  }

  async reject(id: string, _reason?: string): Promise<Partner> {
    return this.updateStatus(id, 'rejected');
  }

  async suspend(id: string): Promise<Partner> {
    return this.updateStatus(id, 'suspended');
  }

  async archive(id: string): Promise<Partner> {
    return this.updateStatus(id, 'archived');
  }

  async deletePartner(id: string): Promise<void> {
    const { rowCount } = await this.db.query(
      "DELETE FROM partners WHERE id = $1 AND id != '00000000-0000-0000-0000-000000000001'",
      [id]
    );
    if (!rowCount) throw new Error('Partner not found or cannot be deleted');
  }

  async getBranding(id: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT branding_config FROM partners WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new Error('Partner not found');
    return (rows[0]['branding_config'] as Record<string, unknown>) ?? {};
  }

  async updateBranding(id: string, branding: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'UPDATE partners SET branding_config = $2, updated_at = NOW() WHERE id = $1 RETURNING branding_config',
      [id, JSON.stringify(branding)]
    );
    if (!rows.length) throw new Error('Partner not found');
    return (rows[0]['branding_config'] as Record<string, unknown>) ?? {};
  }

  async getPlatformBranding(): Promise<Record<string, unknown>> {
    const [brandingRes, settingsRes] = await Promise.all([
      this.db.query<Record<string, unknown>>("SELECT branding FROM platform_settings WHERE id = 'default'"),
      this.db.query<{ key: string; value: string }>(
        "SELECT key, value FROM system_settings WHERE key IN ('platform_name', 'platform_tagline')"
      ),
    ]);
    const branding = (brandingRes.rows[0]?.['branding'] as Record<string, unknown>) ?? {};
    const sysMap = Object.fromEntries(settingsRes.rows.map(r => [r.key, r.value]));
    // system_settings are canonical source for name/tagline; branding JSONB fallback
    return {
      ...branding,
      platformName: sysMap['platform_name'] ?? branding['platformName'] ?? 'BusinessX',
      tagline: sysMap['platform_tagline'] ?? branding['tagline'] ?? '',
    };
  }

  async updatePlatformBranding(branding: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Sync platformName / tagline to system_settings for other services
    if (branding['platformName']) {
      await this.db.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ('platform_name', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [branding['platformName']]
      );
    }
    if (branding['tagline'] !== undefined) {
      await this.db.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ('platform_tagline', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [branding['tagline']]
      );
    }
    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO platform_settings (id, branding, updated_at) VALUES ('default', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET branding = $1, updated_at = NOW() RETURNING branding`,
      [JSON.stringify(branding)]
    );
    return (rows[0]?.['branding'] as Record<string, unknown>) ?? {};
  }

  async update(id: string, updates: Record<string, unknown>): Promise<Partner> {
    const allowed = ['webhook_url', 'supported_formats', 'supported_message_types'];
    const fields = Object.keys(updates).filter((k) => allowed.includes(k));
    if (!fields.length) throw new Error('No updatable fields');

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [id, ...fields.map((f) => updates[f])];

    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE partners SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    return this.mapRow(rows[0]);
  }

  private async updateStatus(id: string, status: PartnerStatus): Promise<Partner> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'UPDATE partners SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id, status]
    );
    if (!rows.length) throw new Error('Partner not found');
    return this.mapRow(rows[0]);
  }

  private mapRow(row: Record<string, unknown>): Partner {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      domain: row['domain'] as string,
      contactEmail: row['contact_email'] as string,
      status: row['status'] as PartnerStatus,
      webhookUrl: row['webhook_url'] as string | undefined,
      supportedFormats: row['supported_formats'] as Partner['supportedFormats'],
      supportedMessageTypes: (row['supported_message_types'] as string[] | undefined) ?? [],
      createdAt: row['created_at'] as Date,
      updatedAt: row['updated_at'] as Date,
    };
  }
}
