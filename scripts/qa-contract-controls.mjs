import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

// Mutate one in-memory fixture; production files and installed modules stay intact.
export async function detectedFault(url, before, after, verify, expectedAssertion) {
  await verify(await import(url.href))
  const source = readFileSync(url, 'utf8')
  assert.equal(source.split(before).length, 2, 'Fault target must occur exactly once')
  const changed = source.replace(before, after).replace(/from (["'])(\.[^"']*)\1/g,
    (_, quote, relative) => `from ${quote}${new URL(relative, url).href}${quote}`)
  const mutant = await import('data:text/javascript;base64,' + Buffer.from(changed).toString('base64'))
  try { await verify(mutant) }
  catch (error) {
    // A broken import, timeout or unrelated assertion is not defect detection.
    if (error.code !== 'ERR_ASSERTION' || !error.message.includes(expectedAssertion)) throw error
    return {result: 'DETECTED', assertion: expectedAssertion}
  }
  assert.fail('Fault survived: ' + expectedAssertion)
}
