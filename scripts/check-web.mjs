/** Validate project-site paths without a browser or external requests. */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'web/index.html'), 'utf8');
const script = await readFile(path.join(root, 'web/script.js'), 'utf8');
const css = await readFile(path.join(root, 'web/style.css'), 'utf8');
const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
urls.push(...[...script.matchAll(/catImage:\s*"([^"]+)"/g)].map(match => match[1]));
urls.push(...[...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1]));
for (const url of urls) {
  if (url.startsWith('#') || url.startsWith('https:') || url.startsWith('data:')) continue;
  assert.ok(url.startsWith('./'), `Project Pages paths must be relative: ${url}`);
  const file = path.resolve(root, 'web', url);
  assert.ok(file.startsWith(path.join(root, 'web') + path.sep));
  assert.ok((await stat(file)).size > 0, `Empty resource: ${url}`);
}
assert.ok(html.includes('</main>') && html.includes('</body>') && html.includes('</html>'));
assert.ok(!html.includes('/releases/latest'), 'latest excludes prereleases; use the actual releases listing');
assert.ok(!html.includes('/releases/download/'), 'do not invent an installer URL before publication');
assert.equal((html.match(/data-download-link/g) || []).length, 2);
assert.ok(html.includes('href="https://github.com/daryanchik/MurzHelps"'));
assert.ok(html.includes('href="./assets/murz-icon.png"'));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.ok(html.includes(`v${version.replace(/\.0$/, '')} · Apple Silicon`));
console.log(`Website resources, favicon, release links and version ${version} validated under /MurzHelps/.`);
