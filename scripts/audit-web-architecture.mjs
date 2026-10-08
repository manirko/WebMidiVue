import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceExtensions = new Set(['.js', '.mjs', '.vue'])
const walk = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
  const target = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(target) : sourceExtensions.has(path.extname(entry.name)) ? [target] : []
})
const relative = file => path.relative(root, file).split(path.sep).join('/')
const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]
const sources = files.map(file => ({file: relative(file), text: fs.readFileSync(file, 'utf8')}))
const matches = (text, expression) => [...text.matchAll(expression)].length

const unmanagedListenerFiles = sources
  .filter(({file}) => file.startsWith('src/components/'))
  .filter(({text}) => /(?:document|window)\.addEventListener\(/.test(text))
  .filter(({text}) => !/(?:document|window)\.removeEventListener\(/.test(text))
  .map(({file}) => file)
const unmanagedComponentListenerFiles = sources
  .filter(({file, text}) => file.startsWith('src/components/') && /\.addEventListener\(/.test(text))
  .filter(({text}) => !/\.removeEventListener\(/.test(text) && !/listenerScope\.on\(/.test(text))
  .map(({file}) => file)
const unclearedListenerScopeFiles = sources
  .filter(({file, text}) => file.startsWith('src/components/') && /listenerScope\.on\(/.test(text))
  .filter(({text}) => !/beforeUnmount\s*\(\)[\s\S]*?listenerScope\?\.clear\(\)/.test(text))
  .map(({file}) => file)
const largestFiles = sources
  .map(({file, text}) => ({file, lines: text.split('\n').length}))
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 10)
const largestProductFile = sources
  .filter(({file}) => file.startsWith('src/'))
  .map(({file, text}) => ({file, lines: text.split('\n').length}))
  .sort((a, b) => b.lines - a.lines)[0] || {file: '', lines: 0}
const main = sources.find(({file}) => file === 'src/main.js')?.text || ''
const sysEx = sources.find(({file}) => file === 'src/assets/js/SysExCommand.js')?.text || ''
const unawaitedDelayFiles = sources
  .filter(({file}) => file.startsWith('src/'))
  // Ищем незавершённый ТАЙМЕР, а не любое слово delay: el.delay / el.sdelay — это линии
  // задержки звукового графа Elementary, они не промисы и ждать их нечем.
  .filter(({text}) => text.split('\n').some(line =>
    /(?<!\bel\.s?)\bdelay\s*\(/.test(line) && !/\bawait\s+delay\s*\(|function\s+delay\s*\(/.test(line)))
  .map(({file}) => file)
const report = {
  sourceFiles: sources.filter(({file}) => file.startsWith('src/')).length,
  sourceLines: sources.filter(({file}) => file.startsWith('src/')).reduce((sum, {text}) => sum + text.split('\n').length, 0),
  scriptLines: sources.filter(({file}) => file.startsWith('scripts/')).reduce((sum, {text}) => sum + text.split('\n').length, 0),
  eagerDeviceRouteImports: matches(main, /^import .*@\/components\/(?!HomeComponent)/gm),
  clientServerMiddleware: /require\(['"]cors['"]\)|\.use\(cors\)/.test(main),
  blockingSleepImplementation: /do\s*\{[^}]*Date\.now\(\)[^}]*\}\s*while/s.test(sysEx),
  sleepCalls: sources.reduce((sum, {text}) => sum + matches(text, /\bsleep\s*\(/g), 0),
  unawaitedDelayFiles,
  unmanagedListenerFiles,
  unmanagedComponentListenerFiles,
  unclearedListenerScopeFiles,
  largestFiles
}

// Потолки 71/10850 → 64/10236 (04.09.2026): окно замены движка звука закрыто —
// src/audio/engine.mjs удалён вместе с хвостами (presets, volume, params, тембр
// glass, voices/patch слиты в движок и тембры, мёртвый pingpong, тест уровней на
// старом движке). Целевое «после» 64/10190 было назначено при появлении движка без
// подсчёта его собственного размера: без звука в src/ 62 файла / 9751 строка,
// движок на Elementary с семью звуками и мастер-цепью — 2 файла / ~500 строк.
// Потолок строк выставлен по факту после чистки, чтобы любой рост краснел.
// 10236 → 10242 (04.09.2026, сессия 3b): обновление прошивки — путь восстановления,
// когда страница открыта при приборе уже в режиме обновления (нет MIDI, есть диск
// RPI-RP2), и явная подсказка выбора диска; +6 строк в UpdateFirmwareComponent.vue.
// 07.10.2026: reviewed explicit PWA update + shared firmware reload guard.
// Actual final source 67/10299; bounded activation and cross-tab/firmware/audio fault
// regressions cover the new lifecycle. No dependency or safety-cap increase.
// 08.10.2026: Andrey explicitly adds 10 timbres + 10 cue sounds + 10 high-note
// treatments. +2 files (bank data and a lazy comparison page), +298 source lines
// including bounded register DSP and the pinned renderer resource cleanup.
// This is the scoped implementation budget, not firmware-owner/release approval.
// Pool caps, dependency versions, largest component and listener limits stay fixed.
// 08.10.2026 Sergey feedback: +1 shared diagnostic preview replaces two copy
// paths; local feedback editor, footer, cache-update race and exact built-in
// Humanize refresh. +99 lines, no backend, migration or dependency added.
const limits = {
  eagerDeviceRouteImports: 0,
  sleepCalls: 0,
  unmanagedListenerFiles: 0,
  sourceFiles: 70,
  sourceLines: 10697,
  largestProductFileLines: 850
}
const violations = [
  report.sourceFiles > limits.sourceFiles && `source files exceed the reviewed cap ${limits.sourceFiles}`,
  report.sourceLines > limits.sourceLines && `source lines exceed the reviewed cap ${limits.sourceLines}`,
  largestProductFile.lines > limits.largestProductFileLines && `${largestProductFile.file} exceeds ${limits.largestProductFileLines} lines`,
  report.eagerDeviceRouteImports > limits.eagerDeviceRouteImports && `eager device imports exceed ${limits.eagerDeviceRouteImports}`,
  report.clientServerMiddleware && 'server-only CORS middleware is installed in the browser app',
  report.blockingSleepImplementation && 'CPU-blocking sleep implementation returned',
  report.unawaitedDelayFiles.length > 0 && `non-blocking delays are not awaited: ${report.unawaitedDelayFiles.join(', ')}`,
  report.sleepCalls > limits.sleepCalls && `blocking-delay calls exceed the known baseline ${limits.sleepCalls}`,
  report.unmanagedListenerFiles.length > limits.unmanagedListenerFiles && `unmanaged listener files exceed the known baseline ${limits.unmanagedListenerFiles}`,
  report.unmanagedComponentListenerFiles.length > 0 && `unmanaged component listeners: ${report.unmanagedComponentListenerFiles.join(', ')}`,
  report.unclearedListenerScopeFiles.length > 0 && `listener scopes are not cleared: ${report.unclearedListenerScopeFiles.join(', ')}`
].filter(Boolean)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Web architecture: ${report.sourceFiles} source files, ${report.sourceLines} source lines, ${report.scriptLines} test/script lines`)
  console.log(`Lazy-route debt: ${report.eagerDeviceRouteImports}; blocking sleep: ${report.blockingSleepImplementation ? 'YES' : 'no'} (${report.sleepCalls} calls)`)
  console.log(`Unmanaged global-listener files: ${report.unmanagedListenerFiles.length}`)
  for (const file of report.unmanagedListenerFiles) console.log(`  - ${file}`)
  console.log(`Unmanaged component-listener files: ${report.unmanagedComponentListenerFiles.length}`)
  console.log(`Complexity caps: ${report.sourceFiles}/${limits.sourceFiles} source files, ${report.sourceLines}/${limits.sourceLines} lines, largest ${largestProductFile.lines}/${limits.largestProductFileLines}`)
  if (report.unclearedListenerScopeFiles.length) {
    console.log(`Uncleared listener scopes: ${report.unclearedListenerScopeFiles.join(', ')}`)
  }
  console.log('Largest files:')
  for (const item of report.largestFiles) console.log(`  ${String(item.lines).padStart(4)}  ${item.file}`)
}

if (process.argv.includes('--check')) {
  if (violations.length) {
    for (const violation of violations) console.error(`ARCHITECTURE REGRESSION: ${violation}`)
    process.exitCode = 1
  } else {
    console.log('Architecture ratchet passed. Size caps, blocking waits and listener ownership remain within contract.')
  }
}
