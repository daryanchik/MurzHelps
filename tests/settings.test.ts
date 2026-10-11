import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../src/main/settings';
import { DEFAULT_SETTINGS, validateSettings } from '../src/shared/timer-state';

test('validates all boundaries and rejects malformed/out-of-range preferences', () => {
  for (const settings of [DEFAULT_SETTINGS,
    { ...DEFAULT_SETTINGS, workMinutes: 1, shortMinutes: 1, warningMinutes: 0 },
    { ...DEFAULT_SETTINGS, workMinutes: 240, shortMinutes: 120, warningMinutes: 15 }]) {
    assert.equal(validateSettings(settings).ok, true);
  }
  for (const input of [null, [], 5, {},
    { ...DEFAULT_SETTINGS, workMinutes: 0 }, { ...DEFAULT_SETTINGS, workMinutes: 241 },
    { ...DEFAULT_SETTINGS, shortMinutes: 0 }, { ...DEFAULT_SETTINGS, shortMinutes: 121 },
    { ...DEFAULT_SETTINGS, longEvery: 0 }, { ...DEFAULT_SETTINGS, longEvery: 25 },
    { ...DEFAULT_SETTINGS, longMinutes: 0 }, { ...DEFAULT_SETTINGS, longMinutes: 121 },
    { ...DEFAULT_SETTINGS, autoStart: 'true' }, { ...DEFAULT_SETTINGS, autoStart: undefined },
    { ...DEFAULT_SETTINGS, warningMinutes: -1 }, { ...DEFAULT_SETTINGS, warningMinutes: 16 },
    { ...DEFAULT_SETTINGS, workMinutes: 1, shortMinutes: 1, warningMinutes: 2 },
    { ...DEFAULT_SETTINGS, workMinutes: 1.5 }, { ...DEFAULT_SETTINGS, workMinutes: '60' },
    { ...DEFAULT_SETTINGS, warningMinutes: NaN }, { ...DEFAULT_SETTINGS, shortMinutes: Infinity }]) {
    assert.equal(validateSettings(input).ok, false, JSON.stringify(input));
  }
});

test('settings save atomically and restore across app launches; sessions are not stored', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'murz-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory);
  assert.deepEqual(await store.load(), DEFAULT_SETTINGS);
  assert.equal(store.loadWarning, undefined);
  const custom = { ...DEFAULT_SETTINGS, workMinutes: 25, shortMinutes: 7, warningMinutes: 3 };
  await store.save(custom);
  assert.deepEqual(await new SettingsStore(directory).load(), custom);
  const json = JSON.parse(await readFile(store.file, 'utf8'));
  assert.deepEqual(json, { version: 2, settings: custom });
  assert.deepEqual(await readdir(directory), ['settings.json']);
});

test('invalid save never changes memory or persisted preferences', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'murz-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory); await store.save(DEFAULT_SETTINGS);
  const before = await readFile(store.file, 'utf8');
  await assert.rejects(store.save({ ...DEFAULT_SETTINGS, workMinutes: 0 }));
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.equal(await readFile(store.file, 'utf8'), before);
});

test('corrupt/unsupported/oversize settings recover to defaults with a visible diagnostic', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'murz-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory);
  for (const payload of ['{invalid', 'null', '{"version":99}', ' '.repeat(16_385),
    JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, warningMinutes: 99 } })]) {
    await writeFile(store.file, payload);
    assert.deepEqual(await store.load(), DEFAULT_SETTINGS);
    assert.ok(store.loadWarning);
    assert.equal(await readFile(store.file, 'utf8'), payload, 'reading does not erase the bad file');
  }
  await store.save(DEFAULT_SETTINGS); assert.equal(store.loadWarning, undefined);
});

test('concurrent saves finish in order and leave no temporary files', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'murz-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory);
  const a = { ...DEFAULT_SETTINGS, workMinutes: 3, shortMinutes: 1, warningMinutes: 0 };
  const b = { ...DEFAULT_SETTINGS, workMinutes: 4, shortMinutes: 2, warningMinutes: 1 };
  assert.deepEqual(await Promise.all([store.save(a), store.save(b)]), [a, b]);
  await store.flush();
  assert.deepEqual(store.get(), b);
  assert.deepEqual(await new SettingsStore(directory).load(), b);
  assert.deepEqual(await readdir(directory), ['settings.json']);
});

test('failed writes leave prior settings intact and do not poison later saves', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'murz-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory);
  await mkdir(store.file);
  const custom = { ...DEFAULT_SETTINGS, workMinutes: 1, shortMinutes: 1, warningMinutes: 0 };
  await assert.rejects(store.save(custom));
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.deepEqual(await readdir(directory), ['settings.json']);
  await rm(store.file, { recursive: true });
  await store.save(custom); assert.deepEqual(store.get(), custom);
});

test('v0.2 preferences migrate without changing the three saved values', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'murz-migrate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory);
  await writeFile(store.file, JSON.stringify({ version: 1, settings: { workMinutes: 60, breakMinutes: 45, warningMinutes: 0 } }));
  const expected = { ...DEFAULT_SETTINGS, workMinutes: 60, shortMinutes: 45, warningMinutes: 0 };
  assert.deepEqual(await store.load(), expected);
  assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')), { version: 2, settings: expected });
  assert.deepEqual(await new SettingsStore(directory).load(), expected);
});

test('failed migration save retains the original file and the migrated values in memory', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'murz-migrate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  class ReadOnlyStore extends SettingsStore { override async save(): Promise<never> { throw new Error('read only'); } }
  const store = new ReadOnlyStore(directory);
  const original = JSON.stringify({ version: 1, settings: { workMinutes: 42, breakMinutes: 12, warningMinutes: 7 } });
  await writeFile(store.file, original);
  assert.deepEqual(await store.load(), { ...DEFAULT_SETTINGS, workMinutes: 42, shortMinutes: 12, warningMinutes: 7 });
  assert.equal(await readFile(store.file, 'utf8'), original);
  assert.ok(store.loadWarning);
});
