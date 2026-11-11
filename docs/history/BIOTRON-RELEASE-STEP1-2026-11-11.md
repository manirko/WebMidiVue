# Biotron settings · шаг 1 · 11.11.2026

**Результат частичный: два исправления, два открытых пункта.** Четыре исправленных дефекта и готовность к выпуску не заявляются. Работа только в `claude/biotron-release-20261111`, база `a00680b` (runtime `e02b11e`). Прошивка, firmware assets, master и сетевые деплои не менялись; сообщения людям не отправлялись.

Вход: `NOW.md`, `ROADMAP.md`, `FEEDBACK.md` рабочего дерева `biotron-plan-20261109`, разделы от 09.11.2026. Рамка 20–21.11: только сайт настроек, прошивка остаётся 1.8.2. Из плана взяты только пункты 2–5; W07, Help, облегчение Settings, снятие beta-пометки и выпуск сюда не входят. Новая переписка в этой сессии не читалась; это проверка заданных источников, не свежая сверка всего фидбека aiplay.

Среда 11.11: macOS 15.6.1 / 24G90, arm64; Node v24.11.1, npm 11.6.2; изолированный headless Google Chrome 157.0.8103.39. Источник: `environment.json` в каталоге доказательств. Lock-файл не менялся; SHA-256 установленного и репозиторного package-lock совпал: `b2b5a428ad029bd71f82851993dc95ab1c4fe533cd0c33d027f0370fdc98ac86`.

## a. Таймаут версии · Сергей 33681

Источник: [33681, 03.11.2026](https://t.me/c/1797899795/33681). В исходном beta-пути первый запрос с неизвестной версией уже предлагает Check firmware. Отдельно воспроизведён опасный путь повторной проверки: ранее прочитанная версия 1.7.4 остаётся после таймаута, в том числе после загрузки Settings; публичная 1.8.2 при таком состоянии считается обновлением. Production-путь Biotron также передавал `versionAware=false`.

- **До:** `node scripts/test-biotron-settings-connection.js` на исходном runtime → exit **1**, `version timeout retained an installable stale version`; actual `1.7.4`, expected `''`. Лог `33681-base-repro.log`.
- **Изменение:** таймаут выбранного устройства очищает версию независимо от загрузки настроек; повторная проверка очищает её до запроса. Ответ другого устройства игнорируется. Production Biotron использует существующий version guard. Нового способа обновления нет. Ограничение production: старый DeviceSelector не передаёт версию через firmware_version и не предоставляет requestFirmwareVersion; guard оставляет установку закрытой. Работающий retry/known-version путь в legacy production не заявляется; интеграция перед master остаётся открытой (пункт 10 исходного плана).
- **После:** тот же тест → exit **0**, `33681-final-restore.log`. Существующая firmware suite проверяет неизвестную/некорректную версию, отказ метаданных, запрет отката и отсутствие BOOT/записи через подставные эффекты.
- **Отрицательный контроль:** в отдельной временной копии оставить новые тесты, вернуть `BiotronPageUpdated.vue` к `a00680b` → exit **1**, `33681-final-revert.log`; восстановить исправление → exit **0**. Живое рабочее дерево во время candidate gate не менялось.

Коммит: `7c1a4be` · `fix(biotron): invalidate firmware offers on version timeout (Sergey 33681)`.

## b. Каналы Plant 1 / Light 2 · Сергей 33687

Источник: [33687, 03.11.2026](https://t.me/c/1797899795/33687). **Веб-дефект не воспроизведён; пункт НЕ ИСПРАВЛЕН и остаётся открытым для прибора.**

- **До:** новый тест на точной базе `a00680b` → exit **0**, `33687-exact-base.log`. Все четыре заводских веб-пресета содержат 1/2; реальные SysExCommand отправляют `[f0 14 0d 7f 00 00 f7]` и `[f0 14 0d 7f 01 01 f7]`. Readback 1/2 остаётся 1/2, сохранённый 2/3 остаётся 2/3. Тест перехватывает штатную инициализацию пресетов, не изображает физический прибор.
- **Проверка причины, только чтение:** в теге firmware `1.8.2` `src/params.c` содержит внутренние каналы 1/2, а `PLSDK/src/music.c:note_on` формирует `NOTE_ON | channel_id`: на проводе это MIDI 2/3. В прочитанном firmware checkout `3d908d5e8e01b73332adcc50d8795fdf40ccefbd` readback переводит внутренний канал через `+1`. Это объясняет наблюдение, но не устанавливает бинарник прибора Сергея. Команды/строки/exit codes — `33687-firmware-source-readonly.json`.
- **После:** runtime каналов не менялся; новый тест входит в `test:settings-readback`. Исходники пресетов и readback побайтно совпадают с `a00680b` (`source-checks.json`). Подмена прочитанного 2/3 на 1/2 скрыла бы фактические MIDI-каналы; автоматической перезаписи прибора нет.
- **Контроль теста:** временно убрать `-1` при кодировании канала в baseline-копии → exit **1**, `33687-oracle-control.log`. Это искусственная поломка для проверки теста, **не** revert исправления: исправления здесь нет.

Коммит только теста: `47e096a` · `test(biotron): preserve preset and readback channel evidence (Sergey 33687)`.

## c. Light не звучит · Сергей 33688

Источник: [33688, 03.11.2026](https://t.me/c/1797899795/33688). **Тишина синтезатора от входящей Light-ноты не воспроизведена; пункт НЕ ИСПРАВЛЕН и остаётся открытым.**

- **До:** на точном runtime `a00680b` raw MIDI `[0x91,64,68]` и `[0x92,64,68]` прошли через настоящие MidiInputSession, biotronVoiceLevel и Elementary DSP в OfflineAudioContext. Ограниченный тест из существующего PCM-harness → exit **0**, `33688-exact-base-focused-retry.log`.
- PCM для MIDI-канала 2: peak **0.09630138**, RMS **0.06504662**; для MIDI-канала 3: peak **0.01446359**, RMS **0.00959725**. Порог детектора тишины: RMS > 0.0001 и peak > 0.001. Числа — программный сигнал, не подтверждение слышимости человеком.
- **После:** профиль громкости и маршрутизация Light не менялись. Тот же raw-MIDI PCM-тест добавлен в `test:sound:levels`; он проверяет оба канала отдельно от теста каналов Settings.
- **Контроль теста:** временно обнулить только Light gain в baseline-копии → exit **1**, `Light MIDI produced silent PCM`, для 0x92 peak/RMS **0/0** (`33688-oracle-control.log`). Это чувствительность детектора, **не** revert несуществующего исправления.
- Первые дополнительные baseline-прогоны не завершились: полный остановлен после зависания браузера (exit **1**); первый ограниченный — timeout **124**. Их логи сохранены (`33688-exact-base.log`, `33688-exact-base-focused.log`). Повтор с 30-секундным watchdog завершился exit **0**; старые неудачи не заменены этим PASS.

Коммит только теста: `973e12d` · `test(biotron): measure raw Light MIDI through the synth (Sergey 33688)`.

## d. Limit 4 выключает генератор и клавиатуру · Сергей 33686

Источник: [33686, 03.11.2026](https://t.me/c/1797899795/33686).

- **До:** `node scripts/test-sound-recovery.js` на базе → exit **1**, `Limit 4 stopped the generator`, `33686-base-repro.log`. Старый changeQuality вызывал общий Stop, сбрасывая движок и клавиатурный режим. Первый черновик теста падал на неполной заглушке capabilities; он сохранён в `33686-before.log`, исправленный baseline-тест выше подтверждает именно поведение дефекта.
- **Изменение:** существующий движок меняет пул 4/8 и DSP-граф, сохраняя последние удержанные голоса, контекст, MIDI-сессию, клавиатурный режим и example. Общий Stop больше не вызывается. Отдельно браузерный прогон выявил блокировку клавиш после фокуса на checkbox: audio running, keyboard on, active voices 0 (`audition-r3-artifacts/failure-state.json`, exit **1**). Добавлен тест фокуса: до исправления exit **1**, после exit **0** (`33686-focus-before.log`, `33686-focus-after.log`). Только отмеченный checkbox Limit 4 сохраняет игровой ввод и удержанные ноты; обычные, disabled и текстовые поля по-прежнему блокируют клавиатуру. Убрана только ставшая неверной фраза Switching stops sound; браузерные ожидания остановки заменены проверкой продолжающегося звука.
- **После:** `node --test scripts/test-sound-core.mjs scripts/test-sound-recovery.js` → exit **0**, `33686-final-restore.log`. Проверены оба направления, лимит/вытеснение, удержанные и последующие MIDI/keyboard ноты; браузерные проверки охватывают keyboard и example при открытом/закрытом Sound.
- PCM RMS до/после переключений: **0.08822963 / 0.08763421 / 0.08849984 / 0.08790678** (`33688-before.log`, проверка Limit 4 в том же PCM-harness).
- **Отрицательный контроль:** в отдельной копии вернуть `engine.mjs`, `soundSessionEffects.mjs`, `core.mjs` и `SoundLab.vue` к базе, сохранив новые тесты → exit **1**, `33686-final-revert.log`; восстановить исправление → exit **0**. Код Stop/прошивка/MIDI-протокол не менялись.

Коммит: `8d81071` · `fix(biotron): keep sound running across Limit 4 toggles (Sergey 33686)`.

## Полные проверки

Все строки ниже — программные проверки на Mac, не физическая приёмка.

| Команда | Exit code | Доказательство |
|---|---:|---|
| `npm run candidate:biotron -- --output-root /tmp/biotron-release-20261111/candidates` | **0** | `candidate-final.log`, `candidate-final-result.json` |
| Внутри candidate: полный `npm run test:biotron` — quick, production isolation/build, firmware browser/build, general beta/build, все обязательные browser lanes | **0** | тот же полный лог, без пропуска упавшей lane |
| `npm run build:biotron-beta` | **0** | `build-final.log`, `build-final-result.json` |
| `npm run test:auditions:browser` (после исправления фокуса) | **0** | `audition-r4.log`, `audition-r4-result.json`; повтор внутри final candidate также **0** |
| `npm run test:qa-runner` | **0** | `test-qa-runner.log`, `test-qa-runner.json` |
| `npm run test:build-destination` | **0** | `test-build-destination.log`, `extra-checks.json` |
| `npm run test:audio:realtime` | **0** | `test-audio-realtime.log`, `extra-checks.json` |
| `npm run test:audio:load` | **0** | `test-audio-load.log`, `extra-checks.json` |
| `npm run test:ui-performance` | **0** | `test-ui-performance.log`, `extra-checks.json` |
| `git diff --check a00680b..HEAD` | **0** | проверено перед записью отчёта и после коммита |
| aiplay `python3 ledger.py --check` | **0** | `aiplay-ledger-check.log`; источники/предметные статусы не менялись |

Точный проверенный source commit: `973e12de4088f5198fa41a53b7ae3438c0e751b6`. Полный gate: 2026-11-11T11:03:55.355990+00:00 → 2026-11-11T11:13:22.855347+00:00. После него добавлен только этот отчёт; runtime и тесты не менялись. Дополнительный 600-секундный soak не запускался (это отдельная необязательная команда репозитория).

Локальный candidate: `973e12de4088`, manifest **74 файла**, `verification_status=verified`; архив SHA-256 `f2de0b8abadec3bbbdbe804b2b06cd58dbdf1df46af684ecf691af875614123f`. Это локальная инженерная сборка; preview не опубликован, product-loop candidate/release state не менялся.

Первый candidate gate на `b5bdac0` → exit **1**: устаревший тест ждал `Sound stopped. Press Listen to example to start again.` (`candidate.log`). Исправлено только ожидание требуемого поведения, затем повторён полный gate. Прошлый FAIL сохранён. Второй полный gate на `22dc8c7` → exit **1**: audition-browser после 100 запусков ждал закрытия при Limit 4 (`candidate-r2.log`, DOM/trace в `candidate-r2-audition-failure`). Ожидания переключения заменены проверками непрерывной сессии и явным Stop; проверка injected close failure сохранена за кнопкой Stop. Автоматический review отклонил снятие production version guard из-за риска отката при неизвестной версии; снятие не выполнено, защита и assertion сохранены. Предварительный offline-запуск sound:levels завершился exit **1** на `ENOTCACHED` для esbuild, до аудиопроверок (`33686-pcm.log`); штатные последующие запуски использовали заданный harness и зафиксированную версию esbuild.

## Состав изменений

Вывод `git diff --name-only a00680b..HEAD` после коммита этого отчёта:

```text
docs/history/BIOTRON-RELEASE-STEP1-2026-11-11.md
scripts/test-audition-browser.js
scripts/test-biotron-settings-connection.js
scripts/test-settings-readback.mjs
scripts/test-sound-browser.js
scripts/test-sound-core.mjs
scripts/test-sound-elementary.js
scripts/test-sound-recovery.js
src/audio/core.mjs
src/audio/elementary/engine.mjs
src/audio/soundSessionEffects.mjs
src/components/BiotronPage/BiotronPageUpdated.vue
src/components/SoundLab/SoundLab.vue
```

Raw evidence и локальный архив: `~/ProjectData/WebMidiVue/biotron-release-20261111-step1/`. `SHA256-MANIFEST.json` содержит хеши сохранённых файлов. Логи не сокращались и не заменялись после повторных PASS. Большие данные в git не добавлены. Ограниченная baseline-фикстура Light и инструкция повтора сохранены в `baseline-test-fixtures/`. Проверки UI используют synthetic/fake MIDI; реальных BOOT/записей прошивки не было.

## НЕ ПРОВЕРЕНО

- Настоящий Biotron, в том числе сохранение/чтение и ноты обоих датчиков на прошивке 1.8.2. Бинарник прибора Сергея не установлен.
- Windows, реальное USB-отключение/W07, Chrome/Edge Сергея и Opera GX.
- Слышимость, громкость, характер Light и остальных звуков человеком; физический аудиовыход.
- Ручной PASS Сергея и разрешение Андрея на выпуск. Локальный candidate/archive не является допуском к выпуску; продуктовые release gates не закрывались.

Потом: остальные пункты уже утверждённого плана до 20.11; новых идей нет.
