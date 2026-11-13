import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {feedbackPayload, feedbackMail, feedbackFailure, FEEDBACK_ENDPOINT} from '../dist/biotron/feedback.mjs';
test('shared core provenance: --check passes unchanged and rejects a drifted copy', async () => {
  const temp=await mkdtemp(join(tmpdir(),'biotron-core-check-'));
  try {
    await mkdir(join(temp,'scripts'),{recursive:true});await mkdir(join(temp,'dist/core'),{recursive:true});
    await cp(new URL('../scripts/sync-core.mjs',import.meta.url),join(temp,'scripts/sync-core.mjs'));
    for (const path of ['SOURCES.json','core.mjs','knobs.mjs','presets.mjs']) await cp(new URL('../dist/core/'+path,import.meta.url),join(temp,'dist/core',path));
    const check=()=>execFileSync(process.execPath,[join(temp,'scripts/sync-core.mjs'),'--check'],{stdio:'pipe'});
    assert.doesNotThrow(check);
    for (const path of ['core.mjs','knobs.mjs','presets.mjs']) {
      await writeFile(join(temp,'dist/core',path),'// Drift negative control\n',{flag:'a'});
      assert.throws(check,/Core drift/);
      await cp(new URL('../dist/core/'+path,import.meta.url),join(temp,'dist/core',path));
    }
  } finally {await rm(temp,{recursive:true,force:true});}
});
test('feedback: same receiver, Biotron product, consent and empty-comment negative controls', () => {
  const detail={environment:{userAgent:'test',viewport:{width:390,height:844}},deviceControl:{settings:{scale:3,unknown:42},version:'1.8.2'}};
  const packet=feedbackPayload('f86eae5','Test',detail,true);
  assert.equal(FEEDBACK_ENDPOINT,'https://playtron-reports.manirkocom.workers.dev/report');
  assert.equal(packet.product,'biotron');assert.equal(packet.technical.env.product,'biotron');assert.equal(packet.schema,'touchme-problem-report-v1');
  assert.equal(packet.technical.device.scale,3);assert.equal(packet.technical.device.unknown,undefined);
  assert.throws(()=>feedbackPayload('f86eae5','Test',detail,false),/Allow/);assert.throws(()=>feedbackPayload('f86eae5',' ',detail,true),/comment/);
  assert.match(feedbackMail('f86eae5','Test'),/^mailto:support@playtronica.com/);assert.equal(feedbackMail('f86eae5','Test','invalid'),null);
  assert.match(feedbackFailure(Error('offline')),/comment is still here/);
});
test('shell: required destinations, no extra pages/framework/service worker or firmware writer', async () => {
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const verify=source=>{
    assert.match(source,/<a class="play-brand" href="https:\/\/shop.playtronica.com" target="_blank" rel="noopener"/);
    for (const id of ['settings-open','help-open','feedback-open','how-tab','midi-tab','settings','help']) assert(source.includes(`id="${id}"`),id);
    assert.doesNotMatch(source,/beta|bootstrap|service-worker|\.vue|UF2|BOOT/i);
    assert.match(source,/href="https:\/\/settings.playtronica.com\/#\/biotron" target="_blank" rel="noopener" hidden/);
  };
  verify(html);assert.throws(()=>verify(html.replace('id="settings-open"','id="absent"')));
  assert.throws(()=>verify(html.replace('https://shop.playtronica.com','https://example.invalid')));
  assert.throws(()=>verify(html.replace('</body>','beta</body>')));
});
