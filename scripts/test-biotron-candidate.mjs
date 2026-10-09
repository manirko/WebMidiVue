import assert from "node:assert/strict"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import test from "node:test"
import {
  createReleaseEvidence,
  normalizeGeneratedSourceMaps,
  packageCandidate,
} from "./build-biotron-candidate.mjs"

test("release evidence is complete, sorted and bound to the exact commit", () => {
  const dist = mkdtempSync(resolve(tmpdir(), "biotron-candidate-"))
  try {
    mkdirSync(resolve(dist, "js"))
    writeFileSync(resolve(dist, "index.html"), "beta")
    writeFileSync(resolve(dist, "js/app.js"), "build abc123")
    writeFileSync(resolve(dist, "release-evidence.json"), "old manifest")
    const manifest = createReleaseEvidence(dist, {
      commit: "abc123def4567890",
      branch: "candidate",
      builtAt: "2026-09-30T23:00:00Z",
    })
    assert.equal(manifest.build_id, "abc123def456")
    assert.equal(manifest.firmware_update_enabled, false)
    assert.equal(manifest.deploy_config.path, "wrangler.toml")
    assert.deepEqual(manifest.files.map(file => file.path), ["index.html", "js/app.js"])
    assert(manifest.files.every(file => file.sha256.length === 64))
  } finally {
    rmSync(dist, {recursive: true, force: true})
  }
})

test("generated service-worker source map is reproducible across build paths", () => {
  const first = mkdtempSync(resolve(tmpdir(), "biotron-map-a-"))
  const second = mkdtempSync(resolve(tmpdir(), "biotron-map-b-"))
  try {
    const sourceMap = temporary => JSON.stringify({
      version: 3,
      file: "service-worker.js",
      sources: [`../../private/tmp/${temporary}/service-worker.js`],
      sourcesContent: ["self.skipWaiting()"],
      names: [],
      mappings: "AAAA",
    })
    writeFileSync(resolve(first, "service-worker.js.map"), sourceMap("random-a"))
    writeFileSync(resolve(second, "service-worker.js.map"), sourceMap("random-b"))

    assert.deepEqual(normalizeGeneratedSourceMaps(first), ["service-worker.js"])
    assert.deepEqual(normalizeGeneratedSourceMaps(second), ["service-worker.js"])
    assert.equal(
      readFileSync(resolve(first, "service-worker.js.map"), "utf8"),
      readFileSync(resolve(second, "service-worker.js.map"), "utf8"),
    )
  } finally {
    rmSync(first, {recursive: true, force: true})
    rmSync(second, {recursive: true, force: true})
  }
})

test("candidate packaging is atomic, immutable and free of macOS metadata entries", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "biotron-package-"))
  const source = resolve(temporary, "source")
  const dist = resolve(source, "dist")
  const output = resolve(temporary, "candidates")
  const commit = "abc123def4567890abc123def4567890abc123de"
  const buildId = commit.slice(0, 12)
  try {
    mkdirSync(dist, {recursive: true})
    writeFileSync(resolve(dist, "index.html"), `build ${buildId}`)
    const release = createReleaseEvidence(dist, {
      commit,
      branch: "detached",
      builtAt: "2026-10-01T00:00:00Z",
    })
    writeFileSync(resolve(dist, "release-evidence.json"), `${JSON.stringify(release)}\n`)
    const packaged = packageCandidate(dist, output, {
      commit,
      buildId,
      testedAt: "2026-10-01T00:00:00Z",
      environment: {node: "test", npm: "test", browser: "test"},
    })

    assert.equal(packaged.archiveSha256.length, 64)
    assert(existsSync(resolve(packaged.candidateDir, packaged.archiveName)))
    assert(existsSync(resolve(packaged.candidateDir, "wrangler.toml")))
    const checklist = readFileSync(resolve(packaged.candidateDir, "PHYSICAL-TEST.md"), "utf8")
    assert.match(checklist, new RegExp(buildId))
    assert.match(checklist, /Biotron beta · 1 October 2026/)
    assert.match(checklist, /\*\*Start listening\*\*/)
    assert.doesNotMatch(checklist, /Hear Biotron/)
    assert.doesNotMatch(checklist, /page shows build/)
    const evidence = JSON.parse(
      readFileSync(resolve(packaged.candidateDir, "test-evidence.json"), "utf8"),
    )
    assert.equal(evidence.status, "pass")
    assert(evidence.verified.includes("secondary_service_midi_port_hidden_from_device_picker"))
    assert.throws(
      () => packageCandidate(dist, output, {
        commit,
        buildId,
        testedAt: "2026-10-01T00:00:00Z",
        environment: {},
      }),
      /Refusing to overwrite immutable candidate/,
    )
    assert.deepEqual(
      readdirWithoutStaging(output),
      [buildId],
    )
  } finally {
    rmSync(temporary, {recursive: true, force: true})
  }
})

function readdirWithoutStaging(directory) {
  return existsSync(directory)
    ? readdirSync(directory).filter(name => !name.startsWith(".preparing-"))
    : []
}
