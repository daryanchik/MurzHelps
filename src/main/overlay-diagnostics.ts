import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

type Value = string | number | boolean | null;
const LIMIT = 256 * 1024;
const keys = new Set(['revision', 'readyRevision', 'wanted', 'visible', 'phase', 'stage', 'reason',
  'asset', 'code', 'count', 'elapsedMs', 'width', 'height', 'scaleFactor', 'platform', 'packaged']);

export function diagnosticPath(): string | undefined {
  try { return path.join(app.getPath('userData'), 'overlay-diagnostics.log'); }
  catch { return undefined; }
}

/** Fixed event codes and bounded scalar fields only; never persist URLs, paths or error stacks. */
export function logOverlay(event: string, fields: Record<string, Value> = {}): void {
  const safe: Record<string, Value> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!keys.has(key)) continue;
    if (typeof value === 'number') { if (Number.isFinite(value)) safe[key] = value; }
    else if (typeof value === 'boolean' || value === null) safe[key] = value;
    else if (/^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) safe[key] = value;
  }
  if (!/^[a-z-]{1,50}$/.test(event)) return;
  const line = JSON.stringify({ time: new Date().toISOString(), event, ...safe }) + '\n';
  console.info?.(line.trim());
  const file = diagnosticPath();
  if (!file) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size >= LIMIT) renameSync(file, file + '.previous');
    appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
  } catch { /* A diagnostic write failure must not affect the timer or window. */ }
}
