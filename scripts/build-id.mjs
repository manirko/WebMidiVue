import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('/usr/bin/git', args, {cwd: root, encoding: 'utf8'}).trim();
const sha = git(['rev-parse', '--short', 'HEAD']);
// The generated identity cannot itself make the next build dirty.
const dirty = git(['status', '--porcelain', '--untracked-files=normal', '--', '.', ':!dist/version.mjs']) !== '';
const build = sha + (dirty ? '-dirty' : '');
writeFileSync(new URL('../dist/version.mjs', import.meta.url), `export const BUILD='${build}';\n`);
console.log(`Biotron build ${build}`);
