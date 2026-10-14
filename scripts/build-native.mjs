import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);

export async function buildNative(root, platform = process.platform, arch = process.arch) {
  const directory = path.join(root, 'dist/native');
  // Never carry obsolete native binaries into a later package.
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  if (platform !== 'darwin') return;
  if (platform !== process.platform) throw new Error('Native helpers must be built on the target OS.');
  const cpu = { arm64: 'arm64', x64: 'x86_64' }[arch];
  if (!cpu) throw new Error(`Unsupported macOS architecture: ${arch}`);
  const binary = path.join(directory, 'murz-desktop-observer');
  await exec('xcrun', ['clang', '-O2', '-arch', cpu, '-mmacosx-version-min=12.0',
    '-fobjc-arc', '-fblocks', path.join(root, 'native/desktop-observer.m'), '-framework', 'AppKit', '-o', binary]);
  await exec('codesign', ['--force', '--sign', '-', binary]);
}
