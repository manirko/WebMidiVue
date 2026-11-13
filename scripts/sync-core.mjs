import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = '/Users/andreymanirko/Projects/touchme-next';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const check = process.argv.includes('--check');
const manifestPath = resolve(root, 'dist/core/SOURCES.json');
if (check) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const source of manifest) {
    const committed = execFileSync('/usr/bin/git', ['show', `${source.commit}:${source.path}`], {cwd: source.origin});
    const original = await readFile(resolve(source.origin, source.path));
    const copy = await readFile(resolve(root, source.destination));
    if ([committed, original, copy].some(data => sha256(data) !== source.sha256)) throw Error(`Core drift: ${source.path}`);
  }
  console.log('Shared core matches TouchMe sources and recorded SHA-256.');
} else {
  const commit = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {cwd: origin, encoding: 'utf8'}).trim();
  const manifest = [];
  // MIDI permission and feedback payloads are product-specific; their Biotron versions live outside core.
  for (const path of ['dist/core.mjs']) {
    const data = await readFile(resolve(origin, path));
    const committed = execFileSync('/usr/bin/git', ['show', `${commit}:${path}`], {cwd: origin});
    if (!data.equals(committed)) throw Error(`Uncommitted source: ${path}`);
    const destination = `dist/core/${path.split('/').at(-1)}`;
    await mkdir(dirname(resolve(root, destination)), {recursive: true});
    await writeFile(resolve(root, destination), data);
    manifest.push({origin, commit, path, destination, sha256: sha256(data)});
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
