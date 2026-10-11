import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DEFAULT_SETTINGS, validateSettings } from '../shared/timer-state';
import { murzCopy } from '../shared/murz-copy';
import type { TimerSettings } from '../shared/timer-state';

/** Only preferences are persisted; runtime decides whether to start a fresh cycle. */
export class SettingsStore {
  readonly file: string;
  loadWarning?: string;
  private current: TimerSettings = { ...DEFAULT_SETTINGS };
  private pending: Promise<unknown> = Promise.resolve();

  constructor(userData: string) { this.file = path.join(userData, 'settings.json'); }

  get(): TimerSettings { return { ...this.current }; }

  async load(): Promise<TimerSettings> {
    try {
      if ((await stat(this.file)).size > 16_384) throw new Error('Settings file is too large');
      const payload = JSON.parse(await readFile(this.file, 'utf8')) as { version?: unknown; settings?: unknown };
      if (payload?.version !== 1 && payload?.version !== 2) throw new Error('Unsupported settings format');
      const legacy = payload.version === 1;
      const old = payload.settings as Record<string, unknown> | null;
      const input = legacy && old && typeof old === 'object' ? {
        ...DEFAULT_SETTINGS, workMinutes: old.workMinutes, shortMinutes: old.breakMinutes,
        warningMinutes: old.warningMinutes,
      } : payload.settings;
      const checked = validateSettings(input);
      if (!checked.ok) throw new Error('Invalid saved settings');
      this.current = checked.settings;
      this.loadWarning = undefined;
      if (legacy) {
        try { await this.save(checked.settings); }
        catch { this.loadWarning = murzCopy.errors.migration; }
      }
    } catch (error) {
      this.current = { ...DEFAULT_SETTINGS };
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.loadWarning = murzCopy.errors.savedSettings;
      }
    }
    return this.get();
  }

  async save(input: unknown): Promise<TimerSettings> {
    const checked = validateSettings(input);
    if (!checked.ok) throw new Error('Invalid timer settings');
    const next = checked.settings;
    // Serialize concurrent saves, then commit preferences only after atomic rename.
    const operation = this.pending.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({ version: 2, settings: next }, null, 2) + '\n', 'utf8');
          await handle.sync();
        } finally { await handle.close(); }
        await rename(temporary, this.file);
        this.current = { ...next };
        this.loadWarning = undefined;
        return this.get();
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async flush(): Promise<void> { await this.pending; }
}
