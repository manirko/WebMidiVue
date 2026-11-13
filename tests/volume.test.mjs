import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountVolume} from '../dist/biotron/volume-ui.mjs';
import {SoundPlayer} from '../dist/biotron/sound/player.mjs';
import {ElementarySynthEngine} from '../dist/biotron/sound/elementary/engine.mjs';
import {installDOM, fire} from './dom-fixture.mjs';

test('V1: header Volume is a native 0…100 slider, step 1 and default 70', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const verify = source => assert.match(source.match(/<header\b[\s\S]*?<\/header>/)[0],
    /<input id="volume" aria-label="Volume" type="range" min="0" max="100" step="1" value="70">/);
  verify(html);
  for (const [from,to] of [['type="range"','type="text"'],['max="100"','max="1"'],['step="1"','step="2"'],['value="70"','value="0"']]) {
    assert.throws(() => verify(html.replace(from,to)));
  }
});
test('V1: slider input preserves every percentage and the existing squared engine gain', t => {
  t.after(installDOM());
  const input = document.createElement('input'), sound = new SoundPlayer();
  mountVolume(input, sound);
  assert.equal(input.value,'70'); assert.equal(sound.engine,null,'mount created audio');
  input.value = 37; fire(input,'input'); assert.equal(sound.volume,37);
  const engine = new ElementarySynthEngine({currentTime:0,state:'running'}, {volume:sound.volume});
  sound.engine = engine;
  for (let value=0; value<=100; value++) {
    input.value=value; fire(input,'input');
    assert.equal(sound.volume,value); assert.equal(engine.volume,value);
    assert.equal(engine.values.volume,(value/100)**2);
    if (value>0 && value<100) assert.notEqual(engine.values.volume,value/100,'negative: linear gain');
  }
  input.value=70; fire(input,'input');
  assert.throws(() => assert.equal(engine.values.volume,1),'negative: ignored slider');
});
