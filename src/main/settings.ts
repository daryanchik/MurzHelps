import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DEFAULT_SETTINGS, validateSettings } from '../shared/timer-state';
import type { TimerSettings } from '../shared/timer-state';

/** Only preferences are persisted; a timer session always starts from IDLE. */
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
      if (payload?.version !== 1) throw new Error('Unsupported settings format');
      const checked = validateSettings(payload.settings);
      if (!checked.ok) throw new Error('Invalid saved settings');
      this.current = checked.settings;
      this.loadWarning = undefined;
    } catch (error) {
      this.current = { ...DEFAULT_SETTINGS };
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.loadWarning = 'Не удалось прочитать настройки. Используются значения по умолчанию; сохранение заменит файл настроек.';
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
          await handle.writeFile(JSON.stringify({ version: 1, settings: next }, null, 2) + '\n', 'utf8');
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
