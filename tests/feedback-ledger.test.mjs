import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFeedback, renderFeedback} from '../scripts/check-feedback.mjs';

const ledger = JSON.parse(readFileSync(new URL('../docs/FEEDBACK-LEDGER.json', import.meta.url), 'utf8'));

test('feedback ledger: canonical data and generated view agree', () => {
  validateFeedback(ledger);
  assert.equal(renderFeedback(ledger), readFileSync(new URL('../docs/FEEDBACK-LEDGER.md', import.meta.url), 'utf8'));
  assert(ledger.context_sources.some(record => record.id === 34301));
  assert(!ledger.records.some(record => record.id === 34301));
});

test('feedback ledger negative fixture: duplicate records fail even with a matching snapshot', () => {
  const negativeFixture = structuredClone(ledger);
  negativeFixture.records.push(structuredClone(negativeFixture.records[0]));
  negativeFixture.source_snapshot.sergey_ids.push(negativeFixture.records[0].id);
  negativeFixture.source_snapshot.sergey_ids.sort((a, b) => a - b);
  assert.throws(() => validateFeedback(negativeFixture), /duplicate record IDs/);
});

test('feedback ledger: snapshot, required fields and statuses cannot silently drift', () => {
  const reject = (mutate, message) => {
    const data = structuredClone(ledger);
    mutate(data);
    assert.throws(() => validateFeedback(data), message);
  };
  reject(data => data.source_snapshot.sergey_ids.pop(), /sorted snapshot/);
  reject(data => data.source_snapshot.sergey_ids.reverse(), /sorted snapshot/);
  for (const key of ['id', 'title', 'status', 'remaining', 'acceptance', 'source_ids']) {
    reject(data => { delete data.issues[0][key]; }, new RegExp(`missing ${key}`));
  }
  reject(data => { data.issues[0].status = 'done'; }, /invalid status/);
  reject(data => { data.issues[0].source_ids = [999999]; }, /unknown source ID/);
  reject(data => { data.issues[0].context_source_ids = [999999]; }, /unknown context ID/);
});
