import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/main/overlay-diagnostics.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0].text;
const requireNode = createRequire(`${process.cwd()}/package.json`);

test('diagnostics persist bounded event fields without raw errors or paths and rotate at 256 KiB', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'murz-diagnostics-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module, exports: module.exports, console: { info() {} },
    require: (name: string) => name === 'electron' ? { app: { getPath: () => directory } } : requireNode(name),
  });
  const { logOverlay, diagnosticPath } = module.exports;
  logOverlay('failed', { reason: 'image-decode', asset: 'ms7', revision: 4, wanted: true,
    message: 'private information', path: '/private/document', stage: 'file:///private/document', elapsedMs: Infinity });
  const first = readFileSync(diagnosticPath(), 'utf8');
  assert.doesNotMatch(first, /private|file:|Infinity/);
  assert.deepEqual(Object.keys(JSON.parse(first)).sort(), ['time', 'event', 'reason', 'asset', 'revision', 'wanted'].sort());
  writeFileSync(diagnosticPath(), 'x'.repeat(256 * 1024));
  logOverlay('shown', { revision: 5 });
  assert.equal(readFileSync(diagnosticPath() + '.previous', 'utf8').length, 256 * 1024);
  assert.equal(JSON.parse(readFileSync(diagnosticPath(), 'utf8')).event, 'shown');
  // A full disk or unusable profile must not prevent the app from restoring input.
  rmSync(diagnosticPath());
  rmSync(directory, { recursive: true });
  writeFileSync(directory, 'not a directory');
  assert.doesNotThrow(() => logOverlay('hidden', { visible: false }));
});
