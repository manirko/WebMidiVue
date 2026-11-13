import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const license = await readFile(new URL('../node_modules/@elemaudio/core/LICENSE.md', import.meta.url), 'utf8');
await mkdir(new URL('../dist/vendor/', import.meta.url), {recursive: true});
await build({absWorkingDir: root, stdin: {
  contents: "export {el} from '@elemaudio/core'; export {default as WebRenderer} from '@elemaudio/web-renderer';",
  resolveDir: root, sourcefile: 'elementary-entry.mjs'
}, bundle: true, format: 'esm', minify: true, legalComments: 'inline',
  banner: {js: `/*! @elemaudio/core 4.0.1 + @elemaudio/web-renderer 4.0.3\n${license}*/`},
  outfile: 'dist/vendor/elementary.mjs'});
await writeFile(new URL('../dist/vendor/LICENSE-elementary.txt', import.meta.url), license);
console.log('Vendored Elementary Audio (MIT).');
