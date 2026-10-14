/**
 * Project config -> CLI targets (first, additive slice of config support).
 *
 * Reads a per-project config (the shape in visual-check.config.example.ts)
 * and turns it into the exact --urls and --viewports values the existing
 * commands already accept. Pure: no browser, no network.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_VIEWPORTS, ViewportSpec } from './types.js';

export interface ProjectConfigRoute {
  id: string;
  path: string;
}

export interface ProjectConfigInput {
  projectId: string;
  routes: ProjectConfigRoute[];
  viewports?: ViewportSpec[];
  /** Absolute http(s) URL the routes resolve against when --base-url is not given. */
  baseUrl?: string;
  [key: string]: unknown;
}

const SUPPORTED_EXTENSIONS = ['.json', '.mjs', '.js'];
const APPLIED_KEYS = new Set(['projectId', 'routes', 'viewports', 'baseUrl']);
const ROUTE_KEYS = new Set(['id', 'path']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateConfig(raw: unknown, filePath: string): ProjectConfigInput {
  if (!isPlainObject(raw)) {
    throw new Error(`${filePath}: config must be an object`);
  }
  if (typeof raw.projectId !== 'string' || raw.projectId.trim() === '') {
    throw new Error(`${filePath}: projectId must be a non-empty string`);
  }
  if (!Array.isArray(raw.routes) || raw.routes.length === 0) {
    throw new Error(`${filePath}: routes must be a non-empty array`);
  }
  raw.routes.forEach((route: unknown, index: number) => {
    if (!isPlainObject(route)) {
      throw new Error(`${filePath}: routes[${index}] must be an object`);
    }
    if (typeof route.id !== 'string' || route.id.trim() === '') {
      throw new Error(`${filePath}: routes[${index}].id must be a non-empty string`);
    }
    if (typeof route.path !== 'string' || !route.path.startsWith('/')) {
      throw new Error(`${filePath}: routes[${index}].path must be a string starting with "/"`);
    }
  });
  if (raw.baseUrl !== undefined && !isAbsoluteHttpUrl(raw.baseUrl)) {
    throw new Error(`${filePath}: baseUrl must be an absolute http:// or https:// URL`);
  }
  return raw as ProjectConfigInput;
}

function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

export async function loadProjectConfigFile(filePath: string): Promise<ProjectConfigInput> {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  let raw: unknown;
  if (ext === '.json') {
    raw = JSON.parse(await readFile(resolved, 'utf8'));
  } else if (ext === '.mjs' || ext === '.js') {
    const mod = (await import(pathToFileURL(resolved).href)) as { default?: unknown };
    raw = mod.default;
  } else {
    throw new Error(
      `Unsupported config file ${filePath}: supported extensions are ${SUPPORTED_EXTENSIONS.join(', ')}. ` +
        'TypeScript configs (.ts) are not supported yet.',
    );
  }
  return validateConfig(raw, filePath);
}

/** Same rules as the CLI's parseViewports: a known viewport name with a sane size. */
function isUsableViewport(value: unknown): value is ViewportSpec {
  if (!isPlainObject(value)) return false;
  const known = DEFAULT_VIEWPORTS.some((v) => v.name === value.name);
  const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return known && positive(value.width) && positive(value.height);
}

export function resolveConfigTargets(
  config: ProjectConfigInput,
  baseUrl: string,
): { urls: string[]; viewports: ViewportSpec[]; warnings: string[] } {
  if (!isAbsoluteHttpUrl(baseUrl)) {
    throw new Error(`Invalid --base-url: ${baseUrl} (expected an absolute http:// or https:// URL)`);
  }
  const base = new URL(baseUrl);

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const route of config.routes) {
    const href = new URL(route.path, base).href;
    if (seen.has(href)) continue;
    seen.add(href);
    urls.push(href);
  }

  const usableConfigViewports =
    Array.isArray(config.viewports) && config.viewports.length > 0 && config.viewports.every(isUsableViewport);
  const viewports = usableConfigViewports ? (config.viewports as ViewportSpec[]) : DEFAULT_VIEWPORTS;

  const topLevel = Object.keys(config)
    .filter((key) => !APPLIED_KEYS.has(key))
    .sort()
    .map((key) => `${key} is not applied by config-targets yet`);
  const routeWarnings = config.routes
    .filter((route) => Object.keys(route).some((key) => !ROUTE_KEYS.has(key)))
    .map((route) => {
      const extra = Object.keys(route).filter((key) => !ROUTE_KEYS.has(key)).sort();
      return `route "${route.id}": ${extra.join(', ')} not applied by config-targets yet`;
    });

  const viewportWarnings: string[] = [];
  if (config.viewports !== undefined && !usableConfigViewports) {
    const names = DEFAULT_VIEWPORTS.map((v) => v.name);
    const namesWithOr = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
    viewportWarnings.push(
      `viewports: not used (each entry needs a name of ${namesWithOr} and a positive width and height); using ${names.join(', ')}`,
    );
  }

  return { urls, viewports, warnings: [...topLevel, ...routeWarnings, ...viewportWarnings] };
}

/**
 * Pick the base URL for a config-driven command: the --base-url flag when
 * given, else the config's own baseUrl, else a clear usage error.
 */
export function resolveConfigBaseUrl(config: ProjectConfigInput, baseUrlFlag?: string): string {
  if (baseUrlFlag !== undefined) return baseUrlFlag;
  if (config.baseUrl !== undefined) return config.baseUrl;
  throw new Error('--base-url is required: the config has no baseUrl field and --base-url was not given');
}

/** `resolveConfigTargets` for the CLI: same URL list as config-targets, base URL from flag or config. */
export function resolveConfigTargetsForCli(
  config: ProjectConfigInput,
  baseUrlFlag?: string,
): { baseUrl: string; urls: string[]; viewports: ViewportSpec[]; warnings: string[] } {
  const baseUrl = resolveConfigBaseUrl(config, baseUrlFlag);
  return { baseUrl, ...resolveConfigTargets(config, baseUrl) };
}
