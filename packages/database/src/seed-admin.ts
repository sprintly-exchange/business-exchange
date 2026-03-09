import bcrypt from 'bcryptjs';
import { getPool } from './index';

const PLATFORM_PARTNER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Seeds the platform admin user on first startup.
 * Reads ADMIN_EMAIL (default: admin) and ADMIN_PASSWORD (default: admin) from env.
 * Idempotent — safe to call on every restart.
 */
export async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'admin';

  const db = getPool();

  const { rows } = await db.query('SELECT id FROM auth_users WHERE email = $1', [email]);
  if (rows.length > 0) return; // already seeded

  const passwordHash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO auth_users (id, partner_id, email, password_hash, scopes)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4)`,
    [PLATFORM_PARTNER_ID, email, passwordHash, ['admin']]
  );

  console.log(`[seed-admin] Admin user created: ${email}`);
}
