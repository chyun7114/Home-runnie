import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';

function getArg(name: string, fallback: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim();
    out[key] = value;
  }
  return out;
}

function serializeEnv(map: Record<string, string>) {
  return [
    '# Auto-generated for k6 load test',
    `BACKEND_HTTP_URL=${map.BACKEND_HTTP_URL || 'http://localhost:3030'}`,
    `ORIGIN=${map.ORIGIN || 'http://localhost:3000'}`,
    `ROOM_ID=${map.ROOM_ID || '1'}`,
    '',
    'ACCESS_TOKEN=',
    `ACCESS_TOKENS=${map.ACCESS_TOKENS || ''}`,
    '',
    `THINK_TIME_MS=${map.THINK_TIME_MS || '1000'}`,
    `LEAVE_DELAY_MS=${map.LEAVE_DELAY_MS || '1000'}`,
    `AUTH_TIMEOUT_MS=${map.AUTH_TIMEOUT_MS || '8000'}`,
    `JOIN_TIMEOUT_MS=${map.JOIN_TIMEOUT_MS || '8000'}`,
    `MESSAGE_TIMEOUT_MS=${map.MESSAGE_TIMEOUT_MS || '8000'}`,
    '',
  ].join('\n');
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendDir = path.resolve(scriptDir, '..');
  const repoRoot = path.resolve(backendDir, '..', '..');
  const envPath = path.join(backendDir, 'secret', '.env');
  const k6EnvPath = path.join(repoRoot, 'loadtest', '.env.k6');

  dotenv.config({ path: envPath });

  const count = Number(getArg('--count', '50'));
  const roomId = getArg('--room', '1');
  const backendUrl = getArg('--backend-url', 'http://localhost:3030');
  const origin = getArg('--origin', 'http://localhost:3000');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing. Check apps/backend/secret/.env');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is missing. Check apps/backend/secret/.env');
  }
  const jwtService = new JwtService();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      `
      SELECT m.id, m.role
      FROM member m
      INNER JOIN profile p ON p.member_id = m.id
      WHERE COALESCE(m.deleted, false) = false
        AND COALESCE(p.deleted, false) = false
      ORDER BY m.id
      LIMIT $1
      `,
      [count],
    );

    if (result.rows.length === 0) {
      throw new Error('No seed members with profile found.');
    }

    const tokens = result.rows.map((row: { id: number; role: string }) =>
      jwtService.sign({ memberId: row.id, role: row.role }, { secret: process.env.JWT_SECRET }),
    );

    const existing = fs.existsSync(k6EnvPath) ? parseEnv(fs.readFileSync(k6EnvPath, 'utf8')) : {};
    const nextMap = {
      ...existing,
      BACKEND_HTTP_URL: backendUrl,
      ORIGIN: origin,
      ROOM_ID: roomId,
      ACCESS_TOKENS: tokens.join(','),
    };

    fs.writeFileSync(k6EnvPath, serializeEnv(nextMap), 'utf8');

    console.log(
      `[k6-env] Wrote ${tokens.length} tokens to ${k6EnvPath} (room=${roomId}, memberId ${result.rows[0].id}..${result.rows[result.rows.length - 1].id})`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[k6-env] Failed:', err.message);
  process.exit(1);
});
