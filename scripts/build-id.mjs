// BUILD = content hash of dist/ (excluding version.mjs), the same rule as TouchMe (touchme-next scripts/build-id.mjs).
// A docs-only commit keeps the BUILD; any change to served files changes it.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]);
const files=walk(resolve(root,'dist')).filter(p=>!p.endsWith('/version.mjs')).sort().map(p=>({path:relative(root,p),sha256:createHash('sha256').update(readFileSync(p)).digest('hex')}));
const id=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,12);
writeFileSync(resolve(root,'dist/version.mjs'),`export const BUILD='${id}';\n`);
writeFileSync(resolve(root,'docs/build-manifest.json'),JSON.stringify({build:id,files},null,2)+'\n');
console.log(`Biotron build ${id}`);
