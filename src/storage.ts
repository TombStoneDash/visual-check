/**
 * Supabase Storage wrapper — Phase 2.
 *
 * Backed by the Supabase REST API so we do not have to take a new runtime
 * dependency. Tests stub global `fetch`; production reads SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY from the environment.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BaselineLane } from './types.js';
import { getActiveBaseline } from './db.js';

export type StorageBucket =
  | 'visual-check-screenshots'
  | 'visual-check-diffs'
  | 'visual-check-reports'
  | 'visual-check-baselines';

export const STORAGE_BUCKETS: StorageBucket[] = [
  'visual-check-screenshots',
  'visual-check-diffs',
  'visual-check-reports',
  'visual-check-baselines',
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function supabaseUrl(): string {
  return requireEnv('SUPABASE_URL').replace(/\/+$/, '');
}

function serviceKey(): string {
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY');
}

function contentTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

export async function uploadArtifact(
  localPath: string,
  bucket: StorageBucket,
  keyPath: string,
): Promise<string> {
  const body = await fs.readFile(localPath);
  const key = keyPath.replace(/^\/+/, '');
  const url = `${supabaseUrl()}/storage/v1/object/${bucket}/${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey()}`,
      'x-upsert': 'true',
      'content-type': contentTypeFor(localPath),
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`uploadArtifact ${bucket}/${key} failed: ${res.status} ${text}`);
  }
  return key;
}

export async function signedUrl(
  bucket: StorageBucket,
  keyPath: string,
  ttlSeconds: number,
): Promise<string> {
  const key = keyPath.replace(/^\/+/, '');
  const url = `${supabaseUrl()}/storage/v1/object/sign/${bucket}/${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: ttlSeconds }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`signedUrl ${bucket}/${key} failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const rel = body.signedURL ?? body.signedUrl;
  if (!rel) throw new Error(`signedUrl ${bucket}/${key}: response missing signedURL`);
  if (rel.startsWith('http://') || rel.startsWith('https://')) return rel;
  return `${supabaseUrl()}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
}

async function downloadBytes(bucket: StorageBucket, keyPath: string): Promise<Uint8Array> {
  const key = keyPath.replace(/^\/+/, '');
  const url = `${supabaseUrl()}/storage/v1/object/${bucket}/${key}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`downloadBytes ${bucket}/${key} failed: ${res.status} ${text}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Resolve the active baseline for (project, url, viewport, lane), stream it
 * into `targetPath`, and return the local path. Returns null if no approved
 * baseline exists — the caller should fall back to `needs_baseline`.
 */
export async function downloadBaseline(
  projectId: string,
  url: string,
  viewport: string,
  lane: BaselineLane,
  targetPath: string,
): Promise<string | null> {
  const row = await getActiveBaseline(projectId, url, viewport, lane);
  if (!row) return null;
  const bytes = await downloadBytes('visual-check-baselines', row.storage_path);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, bytes);
  return targetPath;
}
