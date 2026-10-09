# Web Settings simplification review

Status: isolated beta branch; no production deploy. Updated 2026-10-09.
Current audit snapshot and execution handoff: see “Implementation handoff — 2026-10-05” below.

## Normative engineering contract

This section is the code-review gate. The rest of the document records the
reasoning and staged plan. “Works” is necessary but not sufficient: a change
must also leave the project easier to explain, test, remove and maintain.

### Shape

1. **One owner per behaviour.** MIDI connection, sound, settings persistence,
   firmware update and PWA installation each have one state owner. Views render
   that state; they do not create a second lifecycle.
2. **Pure decisions, effects at the edge.** Encoding, parsing, validation and
   state transitions stay in plain modules. Vue components bind them to DOM,
   Web MIDI, Web Audio and service workers.
3. **No speculative abstraction.** A helper must remove at least two real
   copies or close one named failure with a test. “Might be useful” is not a
   reason for another layer, registry or wrapper.
4. **No compatibility by duplication.** Do not send two protocols, open every
   matching port or keep two state machines “just in case”. Detect a capability
   once, select one path and fail visibly on ambiguity.
5. **Bounded asynchronous work.** Every hardware/network operation is
   cancellable or generation-bound, has a timeout and returns controls to a
   retryable state. Background verification never owns a full-screen loader.
6. **Truthful states.** `connected`, `saved`, `offline`, `installed` and
   `updated` are shown only after their corresponding observable proof. A
   timeout is an explicit `unknown/error`, never success.

### Change budget

- Prefer deletion or reuse before adding a file or dependency.
- One behaviour change per commit; no repository-wide formatting alongside it.
- Report source files, source lines, largest file and direct dependencies before
  and after. Growth requires a named reason and human review of the ratchet.
- A production Vue file may not silently grow beyond 850 lines. Split by a real
  responsibility, not by arbitrary fragments.
- Product source is capped at 70 files and 10,679 lines. The 9 October sound
  palette/native-disclosure pass lowers the previous enforced 10,734-line cap;
  file and largest-file limits stay unchanged. The earlier 64-file/10,242-line
  figure predates the bounded audition, keyboard and diagnostic work.
  A feature that crosses the cap must remove equivalent debt or explicitly
  update this contract in a separate reviewed commit.
- A new dependency needs: browser/runtime purpose, why the platform cannot do
  it, bundle cost, maintenance owner and removal path.

### Evidence gate

- Tests exercise production modules; a rewritten model of the same logic is not
  proof by itself.
- Each bug fix carries the failing path and the recovery path. MIDI/device work
  includes no-reply, disconnect and stale-operation cases.
- `npm run test:biotron` must pass from the exact commit. Real hardware/Windows
  gates remain separate and cannot be inferred from mocks.
- Beta and production isolation is permanent. A beta feature cannot register a
  production service worker or silently change another device route.
- AI may propose or implement; it cannot approve its own architecture, physical
  behaviour, merge, deployment or customer claim.

### Reviewer stop conditions

Reject or split the change when its author cannot answer in five minutes:

- What single user-visible behaviour changed?
- Which module owns it now?
- What was deleted or made simpler?
- What exact failure and recovery tests protect it?
- How is it removed or rolled back without touching unrelated devices?

If the answer needs a long narrative, the change is too broad.

## Outcome first

Keep Vue 3 and the current Vue CLI build for now. The safest high-value path is
to extract a small framework-independent core while reducing the existing app
in measured steps. A rewrite to Vite, TypeScript, React, Electron or Tauri would
increase release risk before it fixes the known lifecycle and protocol debt.

This pass removes unused browser dependencies and dead app state, loads each
device only when its route opens, and scopes legacy global listeners to their
Vue component lifetime. The complete beta gate remains the release contract.
No production deployment is part of this branch.

## Evidence

- The complete deterministic beta gate passed before this review.
- The app has about 10k source lines and 2k test-script lines.
- Device routes were imported eagerly, so opening one device downloaded every
  device page.
- Eight direct dependencies had no repository reference. `cors` was incorrectly
  installed as a Vue browser plugin; CORS can only be granted by the server.
- Bootstrap JavaScript is limited to Collapse and Modal. A native accessible
  title replaces the 100+ KiB Tooltip/Popper path for one information icon.
- Font Awesome is imported as nine individual SVG assets instead of shipping
  seven font files and its complete global stylesheet for nine icons.
- The old MIDI send path calls a CPU-blocking `sleep()` about 40 times.
- Multiple legacy device pages added global document listeners without removing
  them. This pass routes them through one tested scope that clears on unmount.
- Two MIDI lifecycle implementations exist: device settings and the Sound Lab.
- Several page families keep near-duplicate Release/Test/Standalone variants.

Run `npm run audit:web` for the current mechanical inventory. The full test gate
also runs `npm run test:architecture`: known debt may decrease but cannot grow.

Current inventory on 2026-09-26, before physical beta acceptance: 64/64 source
files, 10,095/10,242 source lines, 3,609 test/script lines, zero eager-route
debt, zero CPU-blocking waits and zero unmanaged listener files. The largest
production file is `BiotronPageUpdated.vue` at 847/850 lines. These two nearly
full caps are explicit debt, not permission for a pre-release rewrite: the next
feature must first reduce or deliberately re-baseline them in its own review.

## Measured result of S0

Measured from clean production builds on 2026-08-30:

- Initial entry assets fell from about 719 KiB to 382 KiB (47% smaller).
- Initial compressed JS+CSS fell from about 171 KiB to 86 KiB (50% smaller).
- App JS fell from 152.5 KiB to 15.0 KiB; device code is loaded by route.
- The lockfile contains 1,109 package entries instead of 1,140.
- Seven Font Awesome font assets (about 1 MiB unpacked) no longer ship.
- Unmanaged component-listener files fell from 11 to zero.

The largest remaining first-load asset is Bootstrap CSS at about 222 KiB. Do
not purge it heuristically: 361 template references use Bootstrap-style classes.
A later visual-regression slice can compile a reviewed SCSS subset one component
family at a time.

## Toolchain security and migration boundary

`npm audit --omit=dev --package-lock-only` reported zero production dependency
vulnerabilities on 2026-08-30. The full development lockfile reported 21 issues
(10 high, 11 moderate) through the legacy Vue CLI build chain. Its automatic
`--force` proposal would downgrade the CLI plugin and is rejected.

Vue officially places Vue CLI in maintenance mode and recommends Vite for new
Vue projects: <https://vuejs.org/guide/scaling-up/tooling>. That makes a bounded
Vite equivalence spike sensible after S2, not a reason to mix a toolchain rewrite
with MIDI lifecycle changes. The migration must reproduce normal/beta isolation,
Workbox update behavior, all lazy offline chunks and every current browser test
before the old build can be removed.

## Recommended target

```text
App shell + lazy router + beta PWA
  └─ device registry (name, routes, capabilities)
      └─ thin Vue pages
          ├─ settings controller
          └─ sound controller
              └─ pure browser-independent core
                  ├─ MIDI session and port policy
                  ├─ protocol/version negotiation
                  ├─ paced, cancellable command queue
                  ├─ presets and validation
                  └─ firmware manifest validation
```

The core should use plain JavaScript modules and `node:test`. Vue remains a view
layer. Browser and hardware adapters stay at the edge, which makes most behavior
testable without Chrome or a connected instrument.

## Alternatives considered

1. **Ratchet the current app — do now.** Lazy routes, remove dead dependencies,
   manage every listener, replace blocking waits, share test infrastructure.
   Lowest risk and immediately useful.
2. **Pure core + thin Vue adapters — recommended target.** Extract behavior one
   module at a time while old pages remain operational. Best reliability-to-risk
   ratio.
3. **Device manifest + generic settings renderer — later.** Can remove most page
   duplication, but only after protocol/value semantics have golden tests for
   every device.
4. **Separate beta app entry — optional.** Stronger product isolation than build
   aliases, but creates a second shell to maintain. Consider only if beta and
   production navigation continue diverging.
5. **Toolchain/framework rewrite — reject for this incident.** Vite/TypeScript or
   another UI framework can improve developer ergonomics later, but a rewrite
   does not solve MIDI ownership, stale listeners or firmware compatibility.
6. **Desktop wrapper — separate product.** Packaging Web MIDI does not remove OS
   port ownership. Only revisit with a proven native MIDI/UF2 advantage.

## Staged plan and gates

| Priority | Change | Size | Risk | Proof required |
|---|---|---:|---:|---|
| P0 review | Physically verify cancellation during unplug/navigation | S | medium | real device + browser |
| P0 next | Version/capability negotiation; one wire protocol per session | M | high | released-firmware matrix + real device |
| Done | Shared Chrome/static-server test harness | S | low | identical browser scenarios before/after |
| P1 | Bootstrap SCSS subset, one component family at a time | M | medium | screenshots at desktop/mobile/200% zoom |
| P1 | Shared MIDI session core for Settings and Sound | M | medium | existing race suite + 100 reconnect cycles |
| P2 | Merge 90%+ duplicate Release/Test pages via route mode | L | high | golden presets/MIDI for every device |
| P2 | Isolated Vite build-equivalence spike | M | medium | byte/routes/PWA/update parity; no runtime diff |

Do not combine the first two rows: the queue is transport mechanics; protocol
selection is a firmware compatibility decision and needs its own rollback.

### S0 — mechanical reduction (this branch)

- Lazy-load device routes.
- Remove dead App state, two unreachable components and unused direct dependencies.
- Keep normal-production/PWA isolation tests green.
- Record entry bundle and route chunks before/after.

### S1 — lifecycle safety (listener slice completed)

- Keep every component-owned global listener inside the scoped-listener utility.
- Add a navigation stress test: visit A→B→A 100 times; one event must trigger
  exactly one handler and heap growth must remain bounded.
- One shared browser-test server/Chrome locator now serves both sound and PWA
  suites without changing their scenarios.

### S2 — non-blocking MIDI transport (timing slice completed)

- All 44 CPU-blocking waits now yield to the browser event loop while preserving
  released 100 ms pacing (and the Scala loader's 1 s pacing).
- One save operation is single-flight and the loader remains visible until its
  asynchronous sequence finishes.
- The old selector explicitly opens matching outputs instead of sending an
  invalid empty MIDI packet; non-matching inputs no longer receive handlers.
- BOOT waits for both legacy/current reset frames before navigating to firmware.
- Automated Chrome measured a 28.1 ms maximum event-loop gap during a complete
  offline Biotron settings write; the regression budget is 500 ms.
- A shared write session now cancels before the next MIDI message after device
  switch, disconnect, port close or component unmount. Unit tests prove it never
  continues on a replacement output.
- Before merge, verify the same cancellation paths with a real unplug and route
  change. Do not make the released pacing faster without firmware tests.
- Stop sending both current and deprecated protocols blindly. Negotiate once,
  cache the result for the connection, and fail visibly on ambiguity.
- Test queue saturation and old firmware; physical unplug/route tests remain a
  release gate even though deterministic cancellation tests are green.

### S3 — pure device core

- Extract MIDI session state, presets and protocol encoding from Vue components.
- Characterize each released device before combining duplicate pages.
- Remove a legacy page only after route, preset and MIDI golden tests pass.

### Release gate

Every stage must pass lint, normal production isolation, beta build/PWA tests,
fake-Web-MIDI lifecycle tests and browser tests. A current Chrome/Edge computer
with real hardware remains required for MIDI ownership, reconnect and offline
acceptance. Android remains experimental until an exact physical phone, OS,
Chrome version, adapter/cable and Biotron pass are recorded. Standard iPhone and
iPad browsers are a required negative-path check, not a supported USB path.

## Rules that keep the project easy for the firmware developer

- One behavior change per commit; tests and reason in the same commit.
- No repository-wide formatting and no force-push.
- Keep released wire bytes and pacing unless a golden test names the change.
- Prefer deletion and pure modules over a new framework or abstraction layer.
- A new helper must replace at least two copies or close a proven failure mode.
- Production and beta remain separate build contracts; neither deploys itself.

## Completed simplification pass — 2026-08-31

Compared with `a862c25`, the four atomic commits remove 524 net lines:

- source files: 60 → 59;
- product source lines: 10,049 → 9,515 (−534);
- test/script lines: 2,227 → 2,370 (+143 for cancellation, lifecycle and
  legacy-selector contracts);
- direct dev dependencies: −3; clean `npm ci` and the full gate pass;
- CPU-blocking MIDI waits: 44 → 0;
- unmanaged component/global listener files: 0;
- unreachable components: −2 files / −576 lines.

The product runtime was not deployed. Each commit is reviewable independently;
the final branch only stacks already-tested commits.

### Model routing contract

- Deterministic scripts measure reachability, references, bundle size and test
  results before any model judgment.
- SOL may perform one mechanical net-negative change at a time: remove proven
  dead code/dependencies, consolidate exact test-only duplicates, or maintain a
  ratchet. Wire bytes and UX must remain unchanged and the full gate is required.
- Strong review plus hardware evidence is mandatory for MIDI lifecycle,
  protocol/version negotiation, presets, firmware update, device identity,
  sound/LED meaning and any release decision.
- Ambiguity means stop and escalate; no model may turn an assumption into a
  customer claim, merge or deployment.

## Implementation handoff — 2026-10-05

Это инженерная декомпозиция аудита Astra/Ponytail от 05.10.2026. Она описывает работы и критерии приёмки; актуальная продуктовая очередь и решение о релизе остаются только в `product-loop brief --product biotron`. Все TD ниже открыты на дату аудита; существующая незакоммиченная repair пачка требует отдельного review. Документирование не означает, что правки выполнены или совместимость доказана.

### Точные состояния и источник измерений

- Web repo: `/Users/andreymanirko/Projects/Claude/WebMidiVue-ios-recovery`, ветка `codex/biotron-ios-recovery`.
- Базовый source commit: `3b4911fbfbbb8af4d76a624e5435b69ef75a7f7b`. Последующий docs-only коммит этого раздела не меняет source/build identity.
- Уже размещённый build: `3b4911fbfbbb`, URL `https://685fecc5.biotron-settings-beta.pages.dev/#/biotron/play`.
- Архив: `~/ProjectData/Playtronica/biotron-beta/release-candidates/3b4911fbfbbb/biotron-beta-3b4911fbfbbb.tar.gz`; SHA-256 `9c94cfa365eb849b7580e4a41d36d73b7ffabb3620fecfadfb183a4f32da5a54`.
- Аудит текущего рабочего source: SHA-256 `663ba9436c6c233ac541c694bf0b54c8bae9cd995a3b7c90743200d7d3c39838`. Метод: отсортированные относительные пути всех `src/**/*.{js,mjs,vue}`, затем для каждого `path + NUL + bytes + NUL`.
- Неподготовленный repair patch: `biotron-repair-review.patch`, SHA-256 `adcccd7df34935efd2a7016d8af14cb862ad339f91ccf12671aeb3e15a587eb8`. Он содержит также untracked settings test и **не входит** в опубликованный build.
- Audit artifacts: `~/Documents/Codex/2026-10-05/users-andreymanirko-projects-playtronica-product-experience/outputs/biotron-project-audit-2026-10-05.html` и `biotron-project-audit-evidence.zip` (SHA-256 `1fded7694eeb617f52b26f25517fa5a3cb2ae08a94244b09f562b0120c539be7`). Архив содержит probes и измерения; это статический снимок evidence, не новая база продукта.

Baseline 05.10.2026: 64 source files, 10475 source LOC (HEAD source — 10234), 4733 test/script LOC, 11 direct runtime dependencies. Все 64 source files достижимы в объединённом import graph normal/beta; это исключает удаление страниц по догадке «не используется». Регулярный поиск listeners сообщил 0 unmanaged files, но runtime probe воспроизвела утечку TD-04: эвристика не доказывает корректность.

`contract-check` повторно PASS, contract 1.31/schema 1.2; `brief` повторно OK, decision `prepare_private_preview`, blockers `private_preview_missing`, `exact_customer_outcome_missing`. `matches_current_product_code` ограничен TD-09 и не доказывает идентичность этого dirty checkout. В аудите прошли 52 product unit tests. Старый candidate имеет зарегистрированное automated pass; у нового рабочего дерева architecture и sound gzip gates FAIL, полного pass на clean exact commit нет. Физические Biotron/iPhone/DAW проверки отсутствуют.

### Уже имеющиеся локальные изменения: сохранить и проверить

В рабочем дереве есть firmware-request timeout/generation guard, блокировка Settings до readback, retry, calibration guards/watchdogs, audio-only Resume с timeout/attempt guard, диагностический clock/MIDI age, нейтральная first-sound формулировка и light-channel pitch bend. Их исходное evidence: 38 sound core/recovery tests, settings readback, diagnostics, lint, beta build, Chromium browser recovery с измеренным output signal. Это частичная проверка, не статус готового кандидата.

Перед продолжением снять `git status`, staged/unstaged diff и untracked inventory. Сопоставить с repair patch, не применять его повторно поверх уже внесённых изменений. Не делать reset/clean/stash, blanket add или коммит всей чужой пачки. Одна сессия редактирует репозиторий; один поведенческий срез — один коммит. Состояние docs-only HEAD проверять через `git log`, не ожидать старый HEAD после сохранения handoff.

### Порядок выполнения и границы

1. **Первый следующий срез — TD-01.** Превратить существующую source probe в failing regression, исправить отмену, проверить recovery; приложить source diff и результат. Для этого не нужны пересборка старого кандидата и физический прибор.
2. Затем независимые корректностные срезы TD-02/04/03 и TD-05…08. Review имеющейся repair пачки — до её включения в новый commit; смешанные изменения разделять без потери исходного состояния.
3. Ранние сокращения TD-14 и TD-19; далее по зависимостям TD-15/16/18/20. Общий MIDI owner TD-17 — после characterization и protocol evidence. Каждый крупный device-family перенос можно отложить, если он увеличивает риск текущей проверки.
4. Перед новым candidate record — TD-09/27; перед upload — TD-22; перед упаковкой — TD-21. TD-12/11 закрывают соответствующие UX/ownership ограничения. TD-23 завершает exact-candidate и аппаратную проверку выбранного набора изменений.
5. TD-13/24/25/26 — отдельные последующие решения. Firmware часть TD-10 также вне текущего разрешённого исполнения. **Все 27 задач не являются обязательным мегарелизом.** В один кандидат входит небольшой явно выбранный scope; остальные ограничения сохраняются в evidence.

P1 — существующий сбой или обязательная граница перед соответствующим claim/release; P2 — снижение сложности/UX и риск повторения; P3 — отложенный эксперимент. Это инженерная последовательность, не замена продуктового приоритета из brief. Жёсткие prerequisites указаны в карточках; этапы выше — рекомендуемый порядок. Размеры сокращения являются оценками до выполнения.

### Измеримый результат

| Что измерять | Исходное состояние 05.10.2026 | Критерий после |
|---|---|---|
| Late SysEx после Stop | 1 в воспроизведённой гонке | 0; retry работает |
| Retained settled Promise | 4000 после 1000 пар нот | 0 после settle; bounded soak |
| Legacy callback после unmount | Остался на первом из двух inputs | 0 после 100 циклов |
| Presets | Destructive upgrade/error hang воспроизведены | 0 потерь fixture; truthful tx completion |
| Page implementations | 7 близких вариантов | 3, оценка −840…1110 LOC |
| MIDI lifecycle owners | 3 | 1 после TD-17 |
| Runtime dependencies | 11 | 10 после TD-19 |
| Source budget | 64 files / 10475 LOC / SFC max 886 | ≤64 / ≤10242 / каждый SFC ≤850 либо отдельный reviewed contract change |
| Sound chunk | 26669 gzip bytes | ≤25600 на новой сборке |
| Пользовательский результат | Нет baseline completion/time/recovery для этого exact scope | Собрать baseline и повторный результат на одной задаче; выбрать порог до эксперимента |

Экономия page consolidation — около 8–11% текущего source. Оценки TD-16/17/18 и test LOC считать отдельными diff после предыдущих срезов; перекрывающиеся 673 duplicate lines не суммировать. Процент роста стабильности заранее неизвестен. Сначала доказываем перечисленные инварианты, затем измеряем реальные completed tests/outcomes. При малой выборке показывать числа и отдельные времена; не объявлять статистическое улучшение по одному успешному тесту.

### Карточки техдолга


#### TD-01 — Запретить поздний SysEx после Stop

**P1 · первый срез · источник: F1**

- Владелец реализации: Web · src/audio/midi.mjs
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: sendToPairedOutput ждёт output.open(), затем отправляет команду без повторной проверки поколения сессии. Проба закрыла сессию, разрешила open и получила позднюю команду калибровки F0 14 0D 7D 07 F7.
- Изменение: Захватить поколение операции; проверить актуальность после каждого await и непосредственно перед send. Закрыть устаревший открывшийся output; сохранить первичную ошибку и отдельно отразить ошибку cleanup.
- Готово, когда: Регрессия на настоящем MidiInputSession: задержанный open → Stop → open resolve/reject; send не вызван, stale output освобождён. Отдельно успешная отправка, повторное подключение, ошибка close, замена выбранного устройства.
- Измерение: Поздние sends: 1 в воспроизведённом сценарии → 0; повторный старт остаётся рабочим.
- Граница/риск: Не менять wire bytes, pacing и прошивку. Это одна правка поведения с отдельным коммитом и сильным review.


#### TD-02 — Освобождать завершённые Promise звукового движка

**P1 · источник: F2**

- Владелец реализации: Web · src/audio/elementary/engine.mjs
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: _pending растёт на setter Promise и очищается только через whenIdle. После 1000 note-on/off сохранено 4000 завершённых Promise при 0 активных голосов.
- Изменение: Хранить только незавершённые операции; обработать reject; сохранить семантику whenIdle и корректность операций, добавленных во время ожидания.
- Готово, когда: Реальный модуль: 1000 и 10000 пар нот; после settle коллекция пуста; нет unhandled rejection; barrier не заканчивается раньше необходимых setter; offline render и существующие проверки уровней эквивалентны.
- Измерение: Удерживаемые завершённые Promise: 4000 → 0; измерить также тренд heap на длинном прогоне, не объявлять устранение всех утечек.
- Граница/риск: Не переписывать DSP, пресеты или тембры ради изменения учёта Promise.


#### TD-03 — Сделать browser presets транзакционными и сохраняемыми

**P1 · источник: F3**

- Владелец реализации: Web · src/assets/js/PresetsIDB.js и его callers
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: Upgrade удаляет существующий store; request success принимается за сохранение до transaction complete; getPatch может зависнуть при open error; часть write API не возвращает результат.
- Изменение: Один небольшой transaction helper: complete/abort/error. Версионированная миграция без удаления пользовательских записей; обработать blocked/versionchange, отсутствующий preset и quota. Развести сохранение в браузере и Saved on Biotron.
- Готово, когда: Fixture предыдущей поддерживаемой схемы переживает upgrade и reload; put success + последующий tx abort не показывает Saved; open error, blocked, quota и missing key дают завершённую ошибку и рабочий retry.
- Измерение: Потерянных fixture presets при миграции: 0; неограниченных ожиданий и ложных Saved в fault tests: 0.
- Граница/риск: Никакой миграции живых пользовательских данных в ходе аудита. Перед выпуском миграции проверить путь экспорта/восстановления; простой code revert не считается откатом уже изменённой схемы.


#### TD-04 — Починить очистку legacy MIDI listeners

**P1 · источник: F4**

- Владелец реализации: Web · src/components/MidiComponents/DeviceSelector.vue
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: В итераторе используется input.id вместо input.value.id: два входа записываются по ключу undefined; после unmount первый обработчик остаётся.
- Изменение: Учёт реального port.id, снятие предыдущих подписок и защита pending mount; освобождать каждый собственный порт и listener.
- Готово, когда: Два matching input, повторное обнаружение, hotplug, unmount во время подключения и 100 mount/unmount циклов на настоящем компоненте. После cleanup все собственные callbacks сняты; новый mount получает ноты один раз.
- Измерение: Оставшихся callbacks после cleanup: ≥1 → 0; число callback на одно событие: 1.
- Граница/риск: Локальное исправление до объединения transport; не удалять legacy routes как будто они не используются.


#### TD-05 — Ограничить ожидание serviceWorker.ready

**P1 · источник: F5 / SW**

- Владелец реализации: Web · src/registerServiceWorker.js
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: Десятисекундный watchdog начинается после await serviceWorker.ready; сам ready может никогда не завершиться. Retry недостижим.
- Изменение: Охватить deadline всей операцией readiness/update; отменять UI-операцию по поколению; обрабатывать поздний resolve; возвращать Retry. Не показывать Offline ready без проверки требуемого cache.
- Готово, когда: ready никогда не resolves, resolves после timeout, update fails, worker отсутствует, повторный успешный retry. Установка и обновление не обрывают активную MIDI/audio сессию без явного действия пользователя.
- Измерение: Все сценарии заканчиваются в пределах установленного deadline + допуска теста; ложных offline/update success: 0.
- Граница/риск: Не добавлять SW в обычную production сборку и не отключать проверку кеша для зелёного теста.


#### TD-06 — Отмена UI при зависшем MIDI permission

**P1 · источник: F5 / permission**

- Владелец реализации: Web · src/audio/midiAccess.mjs, Play/Settings starting UI
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: Кешируется pending requestMIDIAccess Promise; пользователь не может завершить starting. Сам браузерный permission prompt не предоставляет стандартного AbortSignal.
- Изменение: Отделить жизненный цикл браузерного запроса от намерения пользователя. Cancel немедленно освобождает UI-попытку; поздний grant не подключает прибор без актуального намерения; повторный вход не создаёт цикл запросов.
- Готово, когда: Незавершающийся prompt, Cancel, поздний grant/deny, повторный user gesture, смена route. Нет неожиданного автоподключения и параллельных permission loops.
- Измерение: UI выходит из отменённой попытки без ожидания браузера; активных пользовательских попыток одновременно ≤1.
- Граница/риск: Не обещать программно закрыть системный prompt. Permission pending, denied и device absent — разные наблюдаемые состояния.


#### TD-07 — Stop и close не ждут бесконечный connect

**P1 · источник: F5 / close**

- Владелец реализации: Web · src/audio/midi.mjs
- Зависимости: TD-01, TD-06
- Долг/доказательство: close() ожидает pending connect, который может не завершиться; пользовательская отмена блокируется внешним Promise.
- Изменение: Разделить немедленное прекращение намерения и физический cleanup. Инвалидировать поколение, прекратить собственные sends и обработать позднее открытие/ошибку; ограничить ожидание cleanup и честно показать неполное освобождение.
- Готово, когда: connect никогда не resolves; close повторяется; поздний open; ошибка port.close; Stop → retry. После Stop не приходят собственные effects, cleanup не подвешивает навигацию.
- Измерение: Неограниченных UI-ожиданий Stop: 0; ложных подтверждений полного Release: 0.
- Граница/риск: Нельзя считать потерю локальной ссылки доказательством освобождения OS MIDI-порта. Подтвердить границу реальным DAW в TD-23.


#### TD-08 — Ограничить загрузку и запуск audio renderer

**P1 · источник: F5 / audio init**

- Владелец реализации: Web · engine.ensureReady и SoundLab start/recovery
- Зависимости: TD-02
- Долг/доказательство: Loading/init renderer не имеют общего deadline. Уже добавленный локально Resume timeout не покрывает каждый путь начальной загрузки.
- Изменение: Проверить имеющуюся recovery правку; добавить один владеющий операцией timeout/generation guard для init, очистить частично созданные ресурсы и дать повторный запуск через user gesture.
- Готово, когда: Зависшая загрузка worklet, init reject, поздний resolve после Stop, повторный старт, interrupted/suspended context. Сохраняются существующие проверки реального звукового выхода после Resume.
- Измерение: Зависших starting: 0 в fault tests; одновременно работающих renderer/audio graph после retry: 1.
- Граница/риск: Не reconnect MIDI и не recalibrate растение для audio-only recovery; не выдавать Chromium automation за iPhone проверку.


#### TD-09 — Развести artifact identity, checkout HEAD и dirty code

**P1 · перед новым candidate record · источник: F6**

- Владелец реализации: Product experience · product_experience.py / git_change_scope
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: Brief смотрит другой checkout ~/Projects/Claude/WebMidiVue. Совпадение commit может давать matches_current_product_code=true при грязном дереве; это не описывает текущую recovery папку.
- Изменение: Явно передавать/показывать implementation checkout в существующей конфигурации. Независимо вычислять commit alignment и staged/unstaged/untracked product changes. Истиной байтов кандидата остаётся immutable manifest, а не HEAD.
- Готово, когда: Fixture: equal HEAD + dirty source; docs-only diff; untracked source; staged change; другой worktree; missing repo; ancestor commit. Brief честно различает все случаи, не инвалидируя корректный старый архив.
- Измерение: False exact-product-code на dirty source fixtures: 0; отображённый путь совпадает с проверяемой папкой.
- Граница/риск: Отдельный product-experience срез, один редактор репозитория. До/после contract-check, brief, unit suite. Не создавать второй release tracker.


#### TD-10 — Закрепить версии и возможности firmware protocol

**P1 · до расширения совместимости · источник: F7**

- Владелец реализации: Web protocol tests + отдельный handoff владельцу firmware
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: DEVELOPING.md firmware содержит старое значение 123 для calibration и текущее 125. В текущем web/code 123 означает readback, 125 — calibration; это не доказывает поддержку всей выпущенной линейки.
- Изменение: Составить матрицу только из exact released artifact/code evidence: версия/хеш, readback, calibration/nonce, timeout/fallback. Добавить golden wire fixtures в web. Противоречивые firmware docs исправляет владелец отдельным разрешённым срезом.
- Готово, когда: Известный текущий протокол, подтверждённый legacy и unknown имеют отдельные fixtures; неизвестная capability даёт честный fallback без пробной изменяющей команды. Совместимость подтверждена на соответствующем устройстве.
- Измерение: Неподтверждённых строк supported в матрице: 0; wire bytes и pacing совпадают с fixtures.
- Граница/риск: Текущий запрет на изменения/прошивку устройства действует. Firmware-часть передана как долг, её выполнение требует отдельного scope; не отправлять два протокола наугад.


#### TD-11 — Честное владение устройством между вкладками и DAW

**P2 · аппаратная граница · источник: F8**

- Владелец реализации: Web · tabLease / MIDI release UX
- Зависимости: TD-07
- Долг/доказательство: Web Locks защищает один storage bucket/origin. Две immutable preview ссылки имеют разные origins; DAW в этот lock не входит.
- Изменение: Оставить same-origin защиту, показывать её реальный scope; опираться на port open/close errors и явный Release. Подготовить воспроизводимую проверку двух origins и DAW.
- Готово, когда: Две вкладки same origin; две разные immutable origins; DAW до/после Release; unplug/reconnect; закрытие вкладки. Нет утверждения «устройство свободно везде» по одному browser lock.
- Измерение: Ложных глобальных free/owned статусов в сценариях: 0; реальная передача DAW подтверждается отдельно.
- Граница/риск: Не заменять immutable URL mutable alias ради общего lock. OS-арбитраж не эмулировать обещаниями UI.


#### TD-12 — Один понятный путь Play → Settings → Release

**P2 · UX, ранние ошибки P1 · источник: F9**

- Владелец реализации: Web · SoundLab, DeviceFirstPlay, Settings, compatibility/diagnostics
- Зависимости: TD-05, TD-06, TD-08
- Долг/доказательство: Отсутствие calibration ACK иногда названо No plant signal. MIDI notes, работа audio engine и звук, услышанный человеком, смешиваются; диагностика перекладывается на человека.
- Изменение: Показывать наблюдаемый этап и один следующий шаг. Таймаут: «калибровка не подтверждена», без выдуманной причины. Простые Play/Settings/Release; advanced controls по необходимости; одно нейтральное outcome действие с автоконтекстом build/stage.
- Готово, когда: Пошаговые flow fixtures: unsupported capability, denied permission, нет прибора, no readback, timeout, notes без слышимого звука, recovery, release. Клавиатура, фокус, VoiceOver, 200% zoom, reduced motion; error/status доступны без цвета. Нет автоматической отправки diagnostics.
- Измерение: На заблокированном этапе: 1 основной CTA; обязательных ручных технических полей: 0. В пилоте измерить task completion, time-to-first-heard-sound, recovery success и ошибки; исходный UX baseline пока не измерен.
- Граница/риск: Универсальность означает общий понятный сценарий с capability-based fallback. Не обещать одинаковый USB path во всех браузерах. Текст timeout можно исправить раньше остальных зависимостей отдельным коммитом.


#### TD-13 — Изолированный и воспроизводимый production CI

**P1 · перед будущим production выпуском · источник: F10**

- Владелец реализации: Web · .github/workflows
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: Текущий workflow на master: npm install, build, publish action по @develop; нет полного gate и закреплённого CI runtime.
- Изменение: Отдельно согласованный срез: npm ci, закреплённые Node/runtime/action SHA, минимальные permissions, gate до artifact publication, публикация именно проверенного immutable artifact.
- Готово, когда: На безопасной fixture/непубликующей ветке: failing gate исключает publish, approved artifact identity сохраняется, feature branch не деплоит production, секреты не попадают в вывод.
- Измерение: Незакреплённых исполняемых action refs: 0; путей публикации в обход gate: 0.
- Граница/риск: Только описание долга сейчас. Пользователь запретил менять production; workflow исполнения production не менять и не запускать без отдельного разрешения.


#### TD-14 — Объединить Playtron Release/Test

**P2 · первый Ponytail срез · источник: P1 simplification**

- Владелец реализации: Web · PlaytronPageRelease.vue / PlaytronPageTest.vue, route props
- Зависимости: TD-04
- Долг/доказательство: 266 нормализованных строк совпадают: весь более короткий вариант. Дублирование удваивает места будущих исправлений.
- Изменение: Одна реализация страницы, явный route prop для Chords/варианта. Сохранить существующие URL, preset namespace и поведение; удалить доказанно заменённую копию после сверки всех ссылок.
- Готово, когда: Characterization до изменения: оба URL, defaults, Chords, preset load/save, MIDI golden traces. Те же assertions после; обычная и beta сборки сохраняют isolation.
- Измерение: Оценка net −240…260 source LOC; измерить diff и бюджет, не считать совпавшие строки готовой экономией.
- Граница/риск: Один device family за коммит. Не делать универсальный конструктор всех приборов.


#### TD-15 — Объединить варианты Scales и TouchMe

**P2 · источник: P2 simplification**

- Владелец реализации: Web · ScalesPage* и TouchMePage*
- Зависимости: TD-14, TD-03
- Долг/доказательство: Scales: 285 общих строк, 99% короткой версии; TouchMe: 342/340 общих строк, 97.2%/96.6%. Standalone имеет дополнительные key/synth/modes.
- Изменение: Два последовательных среза, по device family. Выразить реальные различия небольшими props/composition; сохранить Standalone функции и preset identity.
- Готово, когда: Каждый старый URL, mode, клавиатура/synth, presets, MIDI bytes/pacing и визуальное управление характеризованы до удаления копии. Тесты проверяют отличия, а не только общий happy path.
- Измерение: Оценка суммарно −600…850 source LOC. TD-14 + TD-15: семь вариантов → три реализации; −840…1110 LOC, примерно 8–11% от 10475.
- Граница/риск: Семь→три — уменьшение числа реализаций, не процент роста надёжности. Если различия не выражаются просто, остановить соответствующий срез, сохранить routes.


#### TD-16 — Единый preset controller и явные Vue events

**P2 · источник: P3 simplification**

- Владелец реализации: Web · device pages / presets event wiring
- Зависимости: TD-03, TD-14, TD-15
- Долг/доказательство: patchChanged встречается 9 раз, loadData 8; всего найдено 673 строки повторяющихся тел методов с пересечением с page consolidation.
- Изменение: После удаления вариантов повторно измерить остаток. Вынести один общий реально повторяемый preset lifecycle; заменить соответствующие document events на явные component events/props.
- Готово, когда: Browser preset vs device save различаются, повторный mount не дублирует subscriptions, preset namespaces совместимы, ошибка транзакции остаётся видимой.
- Измерение: Дополнительная оценка −120…220 LOC после TD-14/15; не прибавлять 673 к их экономии.
- Граница/риск: Никакого generic event bus или registry. Если осталось менее двух копий и нет именованного сбоя, helper не вводить.


#### TD-17 — Один владелец MIDI transport

**P2 · высокий риск · источник: P4 simplification**

- Владелец реализации: Web · legacy selector, BiotronDeviceSelector, audio/midi
- Зависимости: TD-01, TD-04, TD-06, TD-07, TD-10
- Долг/доказательство: Три реализации lifecycle занимают приблизительно 797 строк поверхности. Исправления cancellation/ownership приходится синхронизировать.
- Изменение: Общий минимальный владелец access/selection/open/close/generation/listeners; потребители note/audio и SysEx остаются отдельными. Сначала characterization всех трёх реализаций, затем по одному consumer.
- Готово, когда: Порядок событий, неоднозначные порты, readback, pacing, hotplug, cancellation и cleanup эквивалентны; старые lifecycle owners удалены. Сильный review и реальный прибор обязательны перед выпуском.
- Измерение: Цель 3 lifecycle owners → 1; оценка net −80…160 LOC. Подтвердить снижение числа владельцев по коду, не только названием нового helper.
- Граница/риск: Не обобщать wire protocol всех устройств в один неявный режим. Возврат одного consumer возможен отдельно; rollback не должен оставлять два активных owner.


#### TD-18 — Один владелец sound-session effects

**P2 · высокий риск · источник: P5 simplification**

- Владелец реализации: Web · SoundLab, DeviceFirstPlay, route policy, sessionState
- Зависимости: TD-02, TD-08
- Долг/доказательство: Эффекты audio/MIDI/recovery/route lifetime распределены между UI и route/session modules; SoundLab вырос до 876 строк.
- Изменение: Перенести 180–250 строк связанных effects к одному sound-session owner с явными start/stop/recover/release. UI отображает состояние; Play→Settings сохраняет намеренную сессию, уход из scope освобождает её.
- Готово, когда: Play↔Settings без дублирования engine, route-away release, background/foreground, Stop during init, audio-only recovery, repeated mount; existing output-signal и soak checks сохранены.
- Измерение: Перенос строк сам по себе не экономия. Оценка net −25…60 LOC; итоговый SFC ≤850 и один владелец каждой операции.
- Граница/риск: Не вводить state-machine framework. Предварительно назвать state transitions и единственный owner каждого effect.


#### TD-19 — Удалить лишнюю range-slider зависимость

**P2 · малый Ponytail срез · источник: P6 simplification**

- Владелец реализации: Web · SliderRangeCommand.vue, package.json / lockfile
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: multi-range-slider-vue используется только для импорта CSS 4417 bytes; его .multi-range-slider-bar-only class не используется, реальный компонент — @vueform/slider.
- Изменение: Повторно проверить refs/style side effects и удалить один import + dependency; согласовать lockfile через штатный package manager.
- Готово, когда: Dual-range значения, внешний вид, touch, keyboard и focus остаются корректными; нет ссылок в imports/config/scripts; сборочные budget checks после изменения.
- Измерение: Прямых runtime dependencies 11 → 10; −1 import. Реальные gzip bytes измерить, не приравнивать размер исходного CSS к bundle savings.
- Граница/риск: Не переписывать второй slider и не удалять @vueform/slider. Никакого npm audit fix --force.


#### TD-20 — Тестировать production modules без переписывания исходников

**P2 · источник: P7 simplification**

- Владелец реализации: Web · scripts/test-* и извлекаемые pure modules
- Зависимости: TD-16, TD-18
- Долг/доказательство: Часть тестов вырезает/заменяет строки исходников для VM; это хрупко и может отличаться от реального пути исполнения.
- Изменение: По мере появления настоящих module boundaries заменить только соответствующий string-rewrite harness на импорт и явные зависимости. Сначала перенести assertions, затем убрать старый scaffold.
- Готово, когда: Намеренная поломка защищаемого production path действительно краснит regression; сохраняются fail/recover и browser integration checks. Изменения тестов не маскируют старые дефекты.
- Измерение: Оценка −80…150 test LOC; список оставшихся source rewrites сокращается. Не устанавливать coverage % вместо проверки инвариантов.
- Граница/риск: Не ждать этого среза для TD-01…08 и не переписывать весь test runner заранее.


#### TD-21 — Вернуть текущие изменения в бюджеты сложности и bundle

**P1 · gate нового кандидата · источник: Audit caps / prior repair**

- Владелец реализации: Web · architecture ratchet, BiotronPageUpdated, SoundLab, sound chunk
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: Рабочее дерево: 10475/10242 LOC, BiotronPageUpdated 886/850, SoundLab 876/850. Последний локальный sound chunk 26669/25600 gzip bytes. Старый архив — отдельный успешно проверенный artifact.
- Изменение: После выбранных fix/simplify slices снова измерить. У BiotronPage выделить настоящую ответственность readback/calibration, у SoundLab использовать TD-18. Компенсировать новые файлы удалёнными копиями; lazy boundary и удаление ненужного кода до изменения cap.
- Готово, когда: test:architecture и test:pwa проходят на новой сборке; net files/LOC/gzip и причина изменений приложены. Если cap требуется поднять — отдельное human-reviewed изменение контракта, не правка теста ради PASS.
- Измерение: Дефицит сейчас: 233 source LOC, 36 строк BiotronPage и 26 SoundLab, 1069 sound gzip bytes. Количество source files уже 64/64.
- Граница/риск: Функциональные срезы можно исследовать с известным красным baseline, но нельзя назвать release gate зелёным. Это финальный gate, не требование выполнить все 27 задач перед первой полезной проверкой.


#### TD-22 — Исправить preview guard без ручного обхода

**P1 · до следующего upload · источник: Preview handoff gap**

- Владелец реализации: Web · scripts/biotron_preview_guard.py и его tests
- Зависимости: нет; сначала сверка текущего дерева
- Долг/доказательство: Preflight понимает только item.name, наблюдавшийся Wrangler выдаёт Project Name. Remote verifier пытается скачать _headers как обычный asset, хотя Cloudflare применяет его как конфигурацию; проверка выдаёт false failure.
- Изменение: Нормализовать явно поддержанные CLI JSON shapes с fail-closed поведением. Проверять _headers в архиве, а удалённо — фактические response headers; каждый публикуемый asset по-прежнему сверять byte/hash. Явно различить config-file count и served-file count.
- Готово, когда: Fixtures для обеих известных JSON форм, wrong project/account/malformed JSON; _headers не served, но headers правильные/отсутствуют; повреждённый любой served asset; SPA fallback вместо JS; неизменный archive hash. Guard остаётся закрытым при любой значимой ошибке.
- Измерение: Ручных wrapper/исключений на один deploy: цель 0; полнота проверки served assets 100% manifest-публикуемой части.
- Граница/риск: Изменение guard не требует пересобирать или повторно загружать 3b4911fbfbbb. Не использовать старый wrapper как постоянный обход; новый upload — только после exact approval.


#### TD-23 — Закрыть разрыв automated evidence → physical acceptance

**P1 · gate проверки и выпуска · источник: Audit validation gap**

- Владелец реализации: Web candidate evidence + product-loop existing release lane
- Зависимости: TD-09, TD-21, TD-22
- Долг/доказательство: У локальной repair пачки нет full gate на clean exact commit; реальный Biotron, iPhone/MIDIWeb и DAW не проверены. Product-loop не зарегистрировал существующий private preview, хотя старый архив и URL существуют.
- Изменение: Проверить/зарегистрировать существующий immutable preview штатной CLI после точной сверки evidence; не выдавать запись за deploy. Для изменённого кода подготовить один clean candidate, отдельный review и build-specific PHYSICAL-TEST.md. Включать только изменённое поведение и реальную аппаратную границу.
- Готово, когда: Архив, manifest, commit, visible build, полный gate и uploaded bytes согласованы. После разрешённого preview — focused owner test: computer first sound/settings/release; iPhone MIDIWeb first sound и recovery; обычный iOS browser — truthful fallback. Stop at first failure с diagnostics.
- Измерение: Непроверенных обязательных условий перед соответствующим claimed pass: 0. Physical pass и customer outcome хранятся отдельно; отсутствие устройства остаётся missing.
- Граница/риск: Новый preview требует показать точные build/commit/hash и дождаться подтверждения. Не пересобирать неизменённый кандидат. Для старого 3b4911fbfbbb его отдельная owner-проверка возможна без завершения всего нового долга; следовать его checklist, не переносить результат на новую сборку.


#### TD-24 — Позже: уменьшить Bootstrap CSS по проверенным семействам

**P3 · отложено · источник: Later / CSS**

- Владелец реализации: Web · styles / Bootstrap imports
- Зависимости: TD-14, TD-15
- Долг/доказательство: Большой CSS остаётся кандидатом на сокращение; нет доказательства, что heuristic purge безопасен для всех routes и динамических классов.
- Изменение: Сначала закрепить эталонные desktop/mobile состояния всех затрагиваемых routes. Затем собирать SCSS subset по одному семейству компонентов.
- Готово, когда: Modal/Collapse, validation, focus, controls, breakpoints и динамические состояния сохраняются; сравнение нормальной и beta сборок.
- Измерение: Source/gzip CSS до/после и число визуальных регрессий. Процент экономии пока неизвестен.
- Граница/риск: Не начинать ради текущей audio/MIDI неисправности, не обещать 94% purge и не удалять классы только по статическому поиску.


#### TD-25 — Позже: Vite equivalence spike

**P3 · отдельный эксперимент · источник: Later / tooling**

- Владелец реализации: Web · изолированный worktree toolchain
- Зависимости: TD-23
- Долг/доказательство: Legacy Vue CLI усложняет обновления; runtime npm audit от 05.10 показал 0 известных уязвимостей, но не проверяет весь dev graph. Миграция сама по себе не чинит lifecycle.
- Изменение: После стабилизации создать изолированный эквивалентный Vite build; измерить текущий dev dependency audit, время build и артефакты. Не совмещать с runtime refactor.
- Готово, когда: Normal/beta/firmware-mode isolation, lazy offline chunks, PWA install/update/retry, env aliases, CSP, exact candidate packaging и все browser tests воспроизведены до удаления старой сборки.
- Измерение: Время cold build, размер artifact, dependency graph и актуальные advisory до/после. Go/no-go по эквивалентности, без обещанной экономии заранее.
- Граница/риск: Прототип не production release. Сначала отдельное review решения о миграции; не устранять advisory принудительным несовместимым downgrade.


#### TD-26 — Позже: завершить переход product media/import pipeline

**P3 · product contour · источник: Later / product pipeline**

- Владелец реализации: Product experience + владельцы исходных систем
- Зависимости: TD-09
- Долг/доказательство: Переходные legacy imports и media sync создают дополнительную поверхность сверки; аудит не доказал, какие записи/скрипты можно удалить.
- Изменение: Новые reviewed derivatives направлять в существующие concepts product-loop. Измерить дубли/неразрешённые refs; оставить source media в AILIFE; составить обратимую миграцию и inventory внешних ссылок.
- Готово, когда: Stable refs, hashes, identity provenance и существующие outcomes сохраняются; contract-check/brief/unit suite эквивалентны; ссылки launchd/skills/scripts проверены до удаления.
- Измерение: Целевые duplicate/unresolved counts назначить только после baseline; LOC/число скриптов не оценены.
- Граница/риск: Не создавать CRM/roadmap/очередь заново, не копировать raw текст в git. Bulk migration/deletion требует отдельного разрешения, backup и тихого окна.


#### TD-27 — Связать обещанные исправления с проверенным feedback

**P1 · перед утверждением «всё включено» · источник: User feedback coverage / product learning**

- Владелец реализации: Product-loop existing observations → change → test → outcome
- Зависимости: TD-09
- Долг/доказательство: Аудит кода выявляет реальные failure paths, но не доказывает причину каждого клиентского симптома. У current change 2 linked observations, 0 exact exposures/outcomes; часть гипотез остаётся investigating/candidate.
- Изменение: Через brief выбрать только reviewed motivating observations текущего change; для каждой вызвать штатный handoff --observation-id … --target web_tool. Сопоставить symptom → implementation commit → regression → exact candidate → outcome в существующих records.
- Готово, когда: По каждому заявленному исправлению явно известно included / not included / unverified на exact build. Unknown остаётся unknown; приобретение/ответ/успешная прошивка не становятся доказательством исправленного sound/settings. Чтение первоисточника — только если конкретная связь неясна.
- Измерение: Обещаний «исправлено» без commit+regression evidence: 0. Реальный результат — completed tests per exact exposure и reviewed outcomes, по действующему контракту.
- Граница/риск: Никакого полного перечитывания архивов и новой таблицы клиентов. Этот инженерный handoff не подменяет source-linked product-loop handoff и не разрешает клиентскую рассылку.

### Общий протокол приёмки и отката

- По срезу: production-module regression с failure/recovery, relevant script lane из текущего package.json, `git diff --check`, before/after source/dep/bundle metrics. Не переписывать assertion под новую ошибку.
- Ранний fix может иметь точечный PASS при известных общих FAIL budgets; это явно зафиксированный partial result. Никакого candidate_ready до полного gate.
- Финальный изменённый кандидат: clean exact commit; один `npm run candidate:biotron` уже запускает полный `test:biotron`, normal isolation, beta/PWA и browser gate. Не запускать повторный полный build заранее только ради дублирования того же evidence; если gate упал — исправить и подготовить новый exact commit. Не перезаписывать существующий candidate ID.
- Старый неизменённый `3b4911fbfbbb` только сверять по архиву/evidence; ни rebuild, ни повторный upload не нужны для этого handoff. Новый preview: сначала точные build + commit + archive SHA-256, затем явное подтверждение Андрея, потом штатный guard без обходов.
- Под hardware scope выбранного кандидата использовать только его `PHYSICAL-TEST.md`. Browser mocks/emulation не закрывают physical pass; physical pass не закрывает customer outcome. Не отправлять ничего клиентам из этой работы.
- По умолчанию откат — отдельный revert одного проверенного коммита после сверки текущего дерева; не reset/force-push и не overwrite чужих edits. Для DB/schema — заранее проверенный путь сохранения/восстановления данных (TD-03); для transport — один активный owner, для SW — проверка кеша/обновления; старый preview не заменяется.
- TD-09/26/27 выполняются через границы product-loop и его обязательные checks. Команда `product-loop handoff` требует конкретный reviewed observation-id; общий аудит не даёт права придумать observation или импортировать raw conversation.
- Механические inventories — детерминированными скриптами; локальная модель допустима лишь для дешёвой проверяемой классификации. Correctness, architecture, protocol и release judgment — сильная модель + соответствующее человеческое review. Дополнительных framework/services/trackers не требуется.

### Механики и первичные источники

Ресерч выполнен 05.10.2026; источники объясняют механизмы, но не доказывают причину конкретного клиентского симптома. Локальные воспроизведения и ссылки на source paths приведены в полном аудите.

- Ponytail: удаление/повторное использование/платформа прежде новых слоёв; перед удалением проверяются все refs. [Audit skill](https://raw.githubusercontent.com/DietrichGebert/ponytail/main/skills/ponytail-audit/SKILL.md), [основной skill](https://raw.githubusercontent.com/DietrichGebert/ponytail/main/skills/ponytail/SKILL.md).
- MIDI access/ports/permissions: [W3C Web MIDI](https://www.w3.org/TR/webmidi/), [Chrome permission changes](https://developer.chrome.com/blog/web-midi-permission-prompt). TD-01/04/06/07/10/17.
- Audio lifecycle: [W3C Web Audio](https://www.w3.org/TR/webaudio/), [историческая WebKit interrupted issue](https://bugs.webkit.org/show_bug.cgi?id=273511). TD-08/18; старая issue не является диагнозом текущего iPhone.
- Setter Promise и renderer: [Elementary WebRenderer](https://www.elementary.audio/docs/packages/web-renderer). TD-02.
- Transaction complete и storage: [W3C IndexedDB](https://www.w3.org/TR/IndexedDB/), [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/). TD-03: browser storage не обещает бессрочной сохранности.
- ready/update/cache: [Service Workers ready](https://www.w3.org/TR/service-workers/#navigator-service-worker-ready), [Workbox updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates). TD-05/23.
- Origin-scoped locks: [W3C Web Locks](https://www.w3.org/TR/web-locks/). TD-11.
- iPhone experimental bridge и пределы эмуляции: [MIDIWeb vendor](https://midi.org/innovation-award/midiweb), [App Store](https://apps.apple.com/us/app/midiweb-browser/id6757226617), [Playwright emulation](https://playwright.dev/docs/emulation). TD-12/23: capabilities проверяются в exact runtime.
- Ownership/cleanup: [Vue unmounted lifecycle](https://vuejs.org/api/composition-api-lifecycle.html#onunmounted). TD-04/16/18/20.
- Доступные статусы/контролы и наблюдаемость: [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/). TD-12/23/27.
- CI и tooling: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use), [Vue tooling](https://vuejs.org/guide/scaling-up/tooling.html). TD-13/25.
