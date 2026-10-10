import {execFileSync} from "node:child_process"
import {createHash} from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import {homedir} from "node:os"
import {basename, relative, resolve} from "node:path"
import {pathToFileURL} from "node:url"

const root = resolve(import.meta.dirname, "..")

const git = (...args) => execFileSync("/usr/bin/git", args, {
  cwd: root, encoding: "utf8",
}).trim()

function filesBelow(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function runtimeEnvironment() {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  return {
    node: process.version,
    npm: execFileSync("npm", ["--version"], {encoding: "utf8"}).trim(),
    browser: existsSync(chrome)
      ? execFileSync(chrome, ["--version"], {encoding: "utf8"}).trim()
      : "Chromium browser gate",
  }
}

export function createTestEvidence({commit, buildId, testedAt, environment}) {
  return {
    schema: "playtronica.biotron-beta-test-evidence.v1",
    product: "biotron",
    commit,
    build_id: buildId,
    tested_at: testedAt,
    command: "npm run test:biotron",
    status: "pass",
    environment,
    verified: [
      "lint_and_architecture",
      "midi_lifecycle_and_settings_readback",
      "secondary_service_midi_port_hidden_from_device_picker",
      "android_identical_midi_cables_choose_primary_cable",
      "two_android_biotron_units_remain_ambiguous",
      "diagnostics_and_release_evidence",
      "telemetry_contract_and_privacy",
      "first_use_plant_connection_prerequisite_visible",
      "sound_core_and_seven_sound_levels",
      "four_audition_banks_and_36_native_variants",
      "audition_dsp_72_standard_safe_cases_and_handpan_controls",
      "live_audition_midi_and_audio_release_lifecycle",
      "audio_interruption_state_and_foreground_recovery",
      "production_isolation",
      "biotron_beta_build",
      "pwa_install_offline_update_and_retry",
      "responsive_desktop_pixel_compact_and_iphone_fallback",
      "task_specific_first_sound_feedback_for_success_and_failure",
    ],
    notes: [
      "This gate validates software only. Physical Biotron acceptance remains a separate gate.",
      "The candidate keeps customer firmware updates disabled.",
      "The archive is created only after the full release gate passes and is verified before use.",
    ],
  }
}

export function physicalChecklist(commit, buildId, versionDate) {
  const versionLabel = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${versionDate}T12:00:00Z`))
  return `# Biotron beta physical test — ${versionLabel}

This checklist belongs only to commit \`${commit}\` and its immutable archive.
Deploy that archive to a private preview and confirm the page shows
\`Biotron beta · ${versionLabel}\`. The release guard checks the technical
archive ID \`${buildId}\` separately. Do not use an older beta URL.

## Release-blocking computer pass — about five minutes

Use one known USB data cable and current Chrome or Edge on a computer. Close
DAWs, MIDI monitors and other Settings tabs. Connect both plant contact cables
to Biotron and clip the two contacts to separate points on the same plant. Do
not update firmware; this candidate intentionally disables it.

Stop at the first failure:

1. Open **Play**, press **Start listening**, keep the plant still through
   calibration, then touch a leaf. Sound must react without a DAW.
2. Open **Settings**. The picker must offer the responsive Biotron but not
   \`MIDIIN2\`, \`MIDIOUT2\` or \`Biotron Port 2\`. Wait for its saved settings
   to load before changing anything. If the read fails, press **Retry settings
   connection** once; stop if it fails again. Check that **Light sensor** shows a
   known mode, change one reversible setting and wait for **Saved on Biotron**.
3. Press **Release device for DAW**, open the DAW and confirm it receives notes.

Pass only when all three steps succeed on this exact build. Record \`PASS\` plus
computer, OS, browser and cable. This is owner acceptance, not a customer test.

## Separate Android regression check — one task only

On current Android Chrome, connect exactly one Biotron through USB host/OTG and
a data-capable cable. Open **Settings** and confirm the page connects without
asking you to choose between two identical \`Biotron\` entries. Change one
reversible setting and wait for **Saved on Biotron**. Do not combine this check
with sound, offline or firmware testing. With two physical Biotron units, the
page must stop and ask for one to be disconnected instead of choosing silently.

## Separate iPhone check — required before claiming an iOS fix

Use your tested Web MIDI Browser app, one Biotron and the same potted plant, with the phone model,
iOS version, exact app name/version and cable/adapter recorded. Open the exact preview
directly at \`/#/biotron/play\`. Do not update firmware.

First confirm plant-triggered sound while the app stays visible. Then, as a
separate check, briefly lock the phone or switch apps and return. If the browser
paused audio, the page must show that state and offer **Resume sound**; MIDI must
work again after audio resumes. Stop at the first failure. This is a recovery
test, not a promise of uninterrupted background playback or a diagnosis of every
intermittent stop. A passing computer or Android check is not an iPhone pass.

## If anything fails

Stop. Record only the failed step, visible version date and **Copy diagnostics for
Andrey**. Add a short screen recording only if those do not show the problem;
do not retry, reflash or run another checklist.
`
}

export function packageCandidate(distDir, outputRoot, details) {
  if (basename(distDir) !== "dist") throw new Error("Candidate input must be a dist directory")
  const {commit, buildId, testedAt, environment} = details
  const candidateDir = resolve(outputRoot, buildId)
  if (existsSync(candidateDir)) {
    throw new Error(`Refusing to overwrite immutable candidate: ${candidateDir}`)
  }
  mkdirSync(outputRoot, {recursive: true})
  const staging = resolve(outputRoot, `.preparing-${buildId}-${process.pid}`)
  mkdirSync(staging)
  try {
    const archiveName = `biotron-beta-${buildId}.tar.gz`
    const archivePath = resolve(staging, archiveName)
    copyFileSync(resolve(distDir, "release-evidence.json"), resolve(staging, "release-evidence.json"))
    copyFileSync(resolve(root, "wrangler.toml"), resolve(staging, "wrangler.toml"))
    writeFileSync(
      resolve(staging, "test-evidence.json"),
      `${JSON.stringify(createTestEvidence(details), null, 2)}\n`,
    )
    writeFileSync(resolve(staging, "PHYSICAL-TEST.md"), physicalChecklist(commit, buildId, details.versionDate || testedAt.slice(0, 10)))
    execFileSync("/usr/bin/tar", ["-czf", archivePath, "dist"], {
      cwd: resolve(distDir, ".."),
      env: {...process.env, COPYFILE_DISABLE: "1"},
    })
    const members = execFileSync("/usr/bin/tar", ["-tzf", archivePath], {
      encoding: "utf8",
    }).trim().split("\n")
    const unsafe = members.filter(member => (
      !(member === "dist/" || member.startsWith("dist/"))
      || member.split("/").some(part => part.startsWith("._"))
    ))
    if (unsafe.length) throw new Error(`Candidate archive contains unsafe entries: ${unsafe.join(", ")}`)
    const archiveSha256 = sha256File(archivePath)
    writeFileSync(
      resolve(staging, `${archiveName}.sha256`),
      `${archiveSha256}  ${archiveName}\n`,
    )
    renameSync(staging, candidateDir)
    return {candidateDir, archiveSha256, archiveName}
  } catch (error) {
    rmSync(staging, {recursive: true, force: true})
    throw error
  }
}

export function createReleaseEvidence(distDir, {commit, branch, builtAt}) {
  const files = filesBelow(distDir)
    .filter(path => !path.endsWith("/release-evidence.json"))
    .map(path => ({
      path: relative(distDir, path).split("\\").join("/"),
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    schema: "playtronica.biotron-beta-release-evidence.v1",
    product: "biotron",
    mode: "biotron-beta",
    commit,
    build_id: commit.slice(0, 12),
    branch,
    built_at: builtAt,
    source_clean: true,
    firmware_update_enabled: false,
    release_gate: "npm run test:biotron",
    deploy_config: {path: "wrangler.toml", bytes: statSync(resolve(root, "wrangler.toml")).size, sha256: sha256File(resolve(root, "wrangler.toml"))},
    files,
  }
}

export function normalizeGeneratedSourceMaps(distDir) {
  const sourceMapPath = resolve(distDir, "service-worker.js.map")
  if (!existsSync(sourceMapPath)) return []
  const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"))
  const before = Array.isArray(sourceMap.sources) ? sourceMap.sources : []
  sourceMap.sources = before.map(source => (
    /(?:^|\/)service-worker\.js$/.test(source) ? "service-worker.js" : source
  ))
  writeFileSync(sourceMapPath, JSON.stringify(sourceMap))
  return sourceMap.sources
}

export function main() {
  const dirty = git("status", "--porcelain")
  if (dirty) throw new Error(`Refusing candidate build from a dirty checkout:\n${dirty}`)
  const commit = git("rev-parse", "HEAD")
  const branch = git("branch", "--show-current") || "detached"
  const buildId = commit.slice(0, 12)
  const versionDate = git("show", "-s", "--format=%cs", "HEAD")
  execFileSync("npm", ["run", "test:biotron"], {
    cwd: root,
    env: {...process.env, VUE_APP_BUILD_ID: buildId},
    stdio: "inherit",
  })
  const distDir = resolve(root, "dist")
  normalizeGeneratedSourceMaps(distDir)
  const bundles = filesBelow(distDir).filter(path => path.endsWith(".js"))
  if (!bundles.some(path => readFileSync(path, "utf8").includes(buildId))) {
    throw new Error(`Built beta does not expose expected build id ${buildId}`)
  }
  const builtAt = new Date().toISOString()
  const manifest = createReleaseEvidence(distDir, {
    commit, branch, builtAt,
  })
  writeFileSync(resolve(distDir, "release-evidence.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  const outputIndex = process.argv.indexOf("--output-root")
  if (outputIndex !== -1 && !process.argv[outputIndex + 1]) {
    throw new Error("--output-root requires a directory")
  }
  const outputRoot = outputIndex === -1
    ? resolve(homedir(), "ProjectData/Playtronica/biotron-beta/release-candidates")
    : resolve(process.argv[outputIndex + 1])
  const packaged = packageCandidate(distDir, outputRoot, {
    commit,
    buildId,
    versionDate,
    testedAt: builtAt,
    environment: runtimeEnvironment(),
  })
  const python = ["/opt/homebrew/bin/python3", "/usr/bin/python3"].find(existsSync)
  if (!python) throw new Error("Python 3 is required to verify the candidate")
  const verification = JSON.parse(execFileSync(python, [
    resolve(root, "scripts/biotron_preview_guard.py"),
    "--candidate-dir", packaged.candidateDir,
    "--build-id", buildId,
    "--archive-sha256", packaged.archiveSha256,
  ], {encoding: "utf8"}))
  console.log(JSON.stringify({
    status: "candidate_ready",
    commit,
    build_id: buildId,
    files: manifest.files.length,
    candidate_dir: packaged.candidateDir,
    archive_sha256: packaged.archiveSha256,
    verification_status: verification.status,
  }, null, 2))
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ""
if (import.meta.url === invokedPath) main()
