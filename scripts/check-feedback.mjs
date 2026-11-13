import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';

const ledgerURL = new URL('../docs/FEEDBACK-LEDGER.json', import.meta.url);
const viewURL = new URL('../docs/FEEDBACK-LEDGER.md', import.meta.url);
const statuses = new Set(['open', 'partial', 'software_verified', 'human_confirmed', 'needs_clarification']);
const topLevel = ['schema', 'scope', 'authority', 'last_synced_utc', 'last_ingested_message_id',
  'source_snapshot', 'current_candidate', 'records', 'issues', 'context_sources',
  'iteration_decisions', 'audit_findings', 'untriaged_source_ids', 'session_history'];

export function validateFeedback(data) {
  assert.deepEqual(Object.keys(data).sort(), [...topLevel].sort(), 'TouchMe top-level shape differs');
  assert.equal(data.schema, 1, 'unsupported schema');
  for (const key of ['records', 'issues', 'context_sources']) assert(Array.isArray(data[key]), `${key} must be an array`);
  assert(data.records.length && data.issues.length, 'empty records or issues');
  const ids = data.records.map(record => record.id);
  assert(ids.every(id => Number.isSafeInteger(id) && id > 0), 'record IDs must be positive integers');
  assert.equal(new Set(ids).size, ids.length, 'duplicate record IDs');
  assert.deepEqual([...ids].sort((a, b) => a - b), data.source_snapshot.sergey_ids, 'record IDs differ from sorted snapshot');
  const contextIds = data.context_sources.map(record => record.id);
  assert(contextIds.every(id => Number.isSafeInteger(id) && id > 0), 'context IDs must be positive integers');
  assert.equal(new Set([...ids, ...contextIds]).size, ids.length + contextIds.length, 'duplicate context IDs');
  const issueIds = new Set(data.issues.map(issue => issue.id));
  assert.equal(issueIds.size, data.issues.length, 'duplicate issue IDs');
  const knownIds = new Set([...ids, ...contextIds]);
  for (const issue of data.issues) {
    for (const key of ['id', 'title', 'status', 'remaining', 'acceptance']) {
      assert(typeof issue[key] === 'string' && issue[key].trim(), `${issue.id}: missing ${key}`);
    }
    assert(statuses.has(issue.status), `${issue.id}: invalid status`);
    assert(Array.isArray(issue.source_ids), `${issue.id}: missing source_ids`);
    assert(issue.source_ids.every(id => ids.includes(id)), `${issue.id}: unknown source ID`);
    if (issue.context_source_ids !== undefined) {
      assert(Array.isArray(issue.context_source_ids), `${issue.id}: context_source_ids must be an array`);
      assert(issue.context_source_ids.every(id => knownIds.has(id)), `${issue.id}: unknown context ID`);
    }
  }
  for (const record of [...data.records, ...data.context_sources]) {
    assert(Array.isArray(record.issues) && record.issues.every(id => issueIds.has(id)), `${record.id}: unknown issue`);
  }
}

export function renderFeedback(data) {
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const links = ids => [...new Set(ids)].sort((a, b) => a - b)
    .map(id => `[${id}](https://t.me/c/1797899795/${id})`).join(', ');
  return ['# Biotron feedback ledger', '',
    'Generated from [FEEDBACK-LEDGER.json](FEEDBACK-LEDGER.json) by `node scripts/check-feedback.mjs --write-view`.', '',
    `${data.records.length} Sergey records; ${data.context_sources.length} context records; ${data.issues.length} issues. Snapshot: 2026-11-13.`, '',
    '`software_verified` records software evidence only. Device, hearing and Sergey acceptance remain in the last column. Prior failures are retained.', '',
    '| Item | Status | Sources (including context) | Remaining |',
    '|---|---|---|---|',
    ...data.issues.map(issue => `| ${cell(issue.id)}: ${cell(issue.title)} | ${issue.status} | ${links([...issue.source_ids, ...(issue.context_source_ids || [])])} | ${cell(issue.remaining)} |`),
    '', 'Coverage is limited to the supplied snapshots. See JSON for acceptance steps, evidence, outgoing references and gaps.', ''].join('\n');
}

if (import.meta.main) {
  try {
    const data = JSON.parse(await readFile(ledgerURL, 'utf8'));
    validateFeedback(data);
    const view = renderFeedback(data);
    if (process.argv.includes('--write-view')) await writeFile(viewURL, view);
    else assert.equal(await readFile(viewURL, 'utf8'), view, 'stale Markdown; run with --write-view');
    console.log(`Feedback ledger PASS: ${data.records.length} records, ${data.issues.length} issues; generated view matches.`);
  } catch (error) {
    console.error(`Feedback ledger FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
