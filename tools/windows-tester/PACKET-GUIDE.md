# Biotron: пакет Сергея · 12 октября 2026

Открой **START-HERE.html**. Начни с W01–W03: первый звук → Stop → Start.
Остальной план — справочник для Claude и отдельных коротких сессий.
Ночной запуск и постоянный доступ к компьютеру не нужны.

Точный сайт: {{ONLINE_URL}}/#/biotron/play?sound=1

Приложение: `{{WEB_COMMIT}}`. Инструменты пакета: `{{HELPER_COMMIT}}`.
Creator: {{ONLINE_URL}}/creator. Журнал: {{ONLINE_URL}}/firmware-journal.
Этот пакет подготовлен вместо поиска latest в прежних сообщениях. Старые
версии285/b15 и их результаты остаются отдельными, их архивы не менялись.

## Что внутри и как это работает

`runtime/` → локальный loopback-сервер → установленный Chrome/Edge.
`automation/` + `vendor/playwright-core/` → существующие тесты → `results/`.
Ручные наблюдения → `record` + REPORT → проверенный человеком `bundle`.
Helper не открывает свой MIDI-клиент, не пишет прошивку и не отправляет отчёт.

| Файл | Зачем |
| --- | --- |
| START-HERE.html | Короткий первый проход и команды |
| CLAUDE.md | Правила для Claude, порядок, сохранение первого отказа |
| README.md | Этот полный план ПК/телефона/DAW/записи |
| tester.py | verify, doctor, autotest, serve, capture, record, bundle |
| capture-browser.cjs | Логи и ограниченный захват собственной тестовой вкладки |
| packet-manifest.json | Точные версии, SHA всех файлов, статус NOT_RUN |
| runtime/ | Готовая публичная сборка958, без внутренних UF2 |
| builds/Biotron-Web-95855bd.zip | Те же75 файлов для отдельной передачи приложения |
| source-review.zip | Исходники958 и source-manifest, все UF2 исключены |
| automation/ | Существующие9 файлов тестов/аудио/лицензии, pinned к958 |
| automation/node_modules/ | Elementary4.0.1 и пять транзитивных packages по lockfile; лицензии внутри |
| vendor/playwright-core/ | Версия1.62.1 и лицензии; браузер внутрь не включён |
| test-inputs/biotron-firmware_v1.8.2.uf2 | Официальные bytes для имитации диска, НЕ инструкция прошивать |
| reference/REPORT-TEMPLATE.md | Отчёт по W01–W17 и отдельным платформам |
| reference/ACCEPTANCE-STATUS.json | Что ещё NOT_RUN/BLOCKED и прежние доставки |
| reference/SERGEY-MESSAGE-DRAFT.md | Короткий черновик передачи; ещё не отправлен |

## Запуск на компьютере с Claude

Распакуй ZIP обычным способом в свою рабочую папку. Открой папку в Claude.
Дай ему: «Прочитай CLAUDE.md. Проверь целостность. Веди меня по W01–W03
по одному действию. Потом предложи доступные автотесты. Сохраняй первый отказ».

Для helper нужны Python3.10+ и установленный Chrome/Edge. Для autotest/capture
нужен также Node20+. Git/npm/WSL/Docker/admin для этих команд не нужны.
Doctor показывает доступность и версии; ничего не устанавливает.
Если чего-то нет, отметь BLOCKED и продолжи ручной онлайн-проход.

Windows PowerShell, из распакованной папки:

```powershell
py -3 tester.py verify
py -3 tester.py doctor
py -3 tester.py autotest --browser chrome --firmware
# После завершения Chrome, если Edge доступен:
py -3 tester.py autotest --browser edge --firmware
```

Если `py` отсутствует, используй подтверждённый `python`. На Mac/Linux —
`python3`. Для необычного расположения браузера задай `CHROME_PATH` или
`EDGE_PATH` точным путём к установленному executable. Не используй чужой профиль.

Три автоматические фазы делят **600 секунд**:43 цифровых keyboard-наблюдения;
Settings26 изменённых команд/17 границ и отказов/10 действий с пресетами;
5 compiled public updater routes с имитацией MIDI/диска и pinned UF2.
Сохраняются WAV, матрицы, first-fault и логи. Исчезнувший/дублированный route
или NOT_RUN вместо выполнения не даёт software PASS. В этом проходе настоящий
USB, слышимый звук, телефон и физическая установка не проверяются.

```powershell
# Ручной локальный проход: Ctrl+C останавливает только сервер.
py -3 tester.py serve --browser chrome
# Необязательная запись инцидента в своей вкладке, максимум30 минут:
py -3 tester.py capture --browser chrome --minutes 10
# Онлайн-захват — только явно выбранный origin:
py -3 tester.py capture --browser chrome --site live --origin {{ONLINE_URL}} --minutes 10
```

Local Play: `http://127.0.0.1:8765/#/biotron/play?sound=1`, creator `/creator.html`.
Перед новой ручной вкладкой освободи порт через Stop & release и закрой
прошлую тестовую вкладку. Capture создаёт отдельный профиль, меняет timing;
его запуск не заменяет чистый ручной повтор. Не запускай браузерные нагрузки параллельно.

## Короткий первый проход

**W01 — среда.** Запиши модель компьютера/OS, точную версию браузера,
USB-кабель/adapter, аудиовыход, имя выбранного MIDI-порта и показанную версию
прошивки. Отдельно телефон/OS/MIDI-app и фото именно этой платы, если доступно.
Неизвестное оставь UNKNOWN. Имя порта и firmware label не идентифицируют плату.
Использовать прибор должна одна выбранная вкладка; DAW и другие MIDI-clients закрыты/отсоединены.

**W02 — без прибора.** Открой точный сайт. Включи компьютерную клавиатуру
в Sound, получи звук, останови. Проверь Limit to 4 notes at once.
Сравни два явно выбранных тембра; после сравнения верни исходный.
Запиши фактический тембр, чистоту перехода и громкость. Клавиатура не проверяет датчики.

**W03 — растение.** Подключи один Biotron с зажимами на растении.
Нажми Start listening: начальное измерение видно, затем музыка.
Нажми Stop & release;10 секунд трогай растение: тихо, само не возвращается.
Нажми Start listening: измерение и музыка снова появляются.
Следующим отдельным шагом сними один зажим, USB оставь: через7 секунд
ожидается Waiting for plant signal и спокойнее шар. Верни зажим, жди10 секунд:
сигнал возвращается. Записывай каждый шаг отдельно; если не совпало — сначала FAIL/evidence.

## Полный ручной план на компьютере

Один шаг → наблюдение → запись → следующий шаг. PASS только после действия.
Если известного повторяемого стимула нет, эффект настройки INCONCLUSIVE/NOTMEASURABLE.

| Case | Выполнить | Зафиксировать |
| --- | --- | --- |
| W04 | Ограниченный проход Chrome, затем Edge при той же контролируемой нагрузке | Время до первого отказа, звук/подвисание, browser/профиль/нагрузка. Сначала сохранить first-fault, потом Retry |
| W05 | После web Stop & release открыть свою DAW и записать MIDI-clip | Реальные On/Off, отпускание нот, канал, слышимое поведение. DAW/receiver отдельно от web; не открывать второй клиент одновременно |
| W06 | Web release → DAW connect/play → DAW release → web reconnect, три отдельных цикла | Кто владеет портом, тишина после Stop, каждый повтор. Не менять OS/drivers |
| W07 | Во время игры отключить USB на5 секунд; затем вернуть USB | При отключении тихо; поведение после replug записать без Start, потом отдельно Start. Затем отдельные background/return и lock/return/Stop |
| W08 | После сохранения WAV проверить доступный offline/reopen маршрут | Реальное состояние интерфейса и слышимость. Не стирать профиль/cache; не объявлять готовность, если источник недоступен |
| W09 | Открыть Settings и посмотреть установленную/целевую версию и канал | Более новый stable предлагает обновление; equal/newer без downgrade. UNKNOWN ведёт в проверку/Help. Не нажимать BOOT/install ради этой проверки |
| W10 | Physical flash → rollback → reflash | BLOCKED до отдельного допуска ниже. Автопроход updater это не закрыл |
| W11 | На активном источнике Round reference → Clear glass → Deep bass → точный исходный; дальше доступные звуки по выбору | Фактические названия/громкость/хрип/провал по каждому переходу. Тимбры10, Upper notes10, Handpan6 и10 звуковых cues Settings — отдельные scopes. Cue/пример звука не manual hardware calibration |
| W12 | Play↔Settings во время игры, Stop/Start с Settings; независимые панели/слайдеры/Copy diagnostics | Непрерывность без второго Start, доступность Stop, положение/focus/overflow, содержание diagnostics. Copy diagnostics не backup27 |
| W13 | Настоящий телефон: отдельный HTTPS-проход ниже | OS/browser/MIDI-app/USB/adapter/FW и каждое наблюдение; desktop viewport не phone PASS |
| W14 | Физическая проверка FB44/internal111 с DAW и слышимым cue | BLOCKED: internal111 в packet отсутствует, отдельный firmware/board допуск |
| W15 | Device-loaded backup → одно обычное значение → эффект → exact restore → persistence | Saved/readback,27 bytes до/после, один и тот же стимул. Без полного восстановления STOP |
| W16 | Растение → creator → запись → WAV → внешнее открытие | Подробные шаги ниже; реальный файл, звук, длительность, Save/Share/reopen |
| W17 | Обычная камера + WAV → CapCut → готовое видео | Импорт, reopen, экспорт, просмотр вне редактора; время/помощь/повторы |

## W15: все обычные настройки, с возвратом после каждой

Начни только после fresh ownership, идентификации и **считанного с этого
прибора** полного backup26 полей/27 bytes. Export и Check saved settings должны
согласоваться. Показанные label/Saved не заменяют точного readback.
Исторический backup другого дня не восстанавливай автоматически.

Для каждого поля: текущий baseline → одно допустимое значение → Saved on
Biotron → Check saved settings/readback → тот же контролируемый стимул →
точное исходное значение → Saved/readback. Только затем следующее поле.
После восстановления проверь persistence после отдельного disconnect/reconnect.
Меняй только обычный control, в UI-диапазоне, без reset/defaults/calibration.

Полный список полей для Claude, названия брать из текущего UI:

```text
plantBpm, noteDistance, firstValue, smoothness, scale,
maxPlantVelocity, maxLightVelocity, lightBpm, randomness,
same_note_plant, noteOffPercent, range_light_note, minPlantVelocity,
randomPlantVelocity, minLightVelocity, randomLightVelocity, light_pitch_mode,
performance, plant_no_velocity, light_no_velocity, same_note_light,
middle_plant_note, plant_midi_channel, light_midi_channel,
swing_first_note_percent, button_mode_state
```

Plant/Light Mute тоже требуют исходного значения, Saved и обратного сохранения.
Свет прикрывать/открывать одинаково; отсутствие понятного ответа не считать PASS.
МIDI/channel/velocity/duration проверять в согласованной DAW-сессии после release
web; неизвестный стимул нельзя компенсировать случайными изменениями настроек.

## W13: телефон отдельно от компьютера

Открой **HTTPS-ссылку** {{ONLINE_URL}}/#/biotron/play?sound=1 на телефоне.
ПК предварительно Stop & release. Адрес127.0.0.1 на телефоне — сам телефон.
Архив с Claude на ПК не даёт Claude доступа к телефону: шаги делает человек.

Android Chrome с USB/OTG — одна связка. Обычный iOS Safari/Chrome — отдельная
проверка доступности Web MIDI; unsupported может быть ожидаемым результатом.
Уже установленный специальный Web MIDI Browser на iOS — третья связка.
Запиши название/версию app и adapter. Не устанавливай приложения/драйверы и
не обходи OS permissions ради PASS; запрос доступа подтверждает сам владелец.

1. Открой страницу: без connection не должно быть ложного Ready.
2. Подключи USB и выбери именно свой прибор; запиши имя/версию.
3. Start listening: измерение, затем музыка.
4. Stop & release:10 секунд после касания тихо.
5. Start снова: музыка возвращается.
6. Зажим off7 секунд → Waiting; вернуть10 секунд → сигнал. Один шаг за раз.
7. USB off5 секунд → тихо; replug отдельно от Start.
8. Play↔Settings: музыка продолжается; Stop доступен.
9. Portrait/landscape: контролы читаются и нажимаются, горизонтального overflow нет.
10. Garden/fullscreen: drag и закрытие работают, выход доступен.
11. Background→return: записать слышимость/состояние; отдельно Stop.
12. Lock→return: записать состояние; Stop даёт тишину.
13. W15 только со своим phone device-loaded backup/restore и ownership.
14. W16 Save/Share/cancel и реальное внешнее открытие WAV на этом телефоне.

Результаты Android/iOS/app не объединять. Playwright WebKit/Firefox и узкое
окно компьютера не являются настоящими телефонными тестами.

## W16–W17: получить законченный результат

Play Stop & release. Открой {{ONLINE_URL}}/creator и подключи свой источник
через показанный UI. Запиши растение обычными Record/Stop. Listen: звук слышен.
Сохрани WAV текущей кнопкой Save; файл открыть заново обычным player вне страницы.
Зафиксируй имя/длительность/размер, слышимость и соответствие записи.
Share/cancel/отказ доступа проверить отдельно; после отмены запись остаётся доступной.
Не считать sample из автотеста реальной записью растения.

Сними обычное видео камерой телефона. Импортируй видео и этот WAV в обычный
CapCut. Закрой/переоткрой проект, экспортируй готовый ролик, посмотри его вне
редактора. Зафиксируй total time, помощь, retries, хочется ли повторить,
понятно ли зрителю, что играет растение. Встроенная камера/микрофон/editor не нужны.
Не отправляй видео наружу автоматически. При отсутствии CapCut отметь NOT_RUN.

## Обновление прошивки: где заканчивается этот пакет

Updater включён, public-stable. Официальный target при фиксации12Oct10:57UTC —
1.8.2; прибор1.10.10 новее, понижать его ради теста нельзя. 1.7.4 — граница
ответа версии, не доказанная граница BOOT или сохранения настроек.
Старый source1.5.0–1.8.2 может очистить настройки до BOOT;1.6.4 UNKNOWN.

Файл test-inputs/biotron-firmware_v1.8.2.uf2 используется автоматической
имитацией диска. SHA256:
`d2406d66225f76779331714b0a9df814d1c72d7f3640178f29adc9d3b45b4251`.
Его наличие не означает совместимость или одобрение установки на эту плату.

W10/W14 пока **BLOCKED**: нужны owner, фото/идентификация своей PCB, свежий
own27 backup и проверенный restore, approved target и свой rollback,
подтверждённый способ recovery/BOOT с точными контактами/инструментом/питанием/
порядком удаления и проверкой новичком. Generic RPI-RP2 не Biotron PCB identity.
Не угадывать контакты, не reset/manual calibration/JIG/flash/OS settings.

Локальный журнал хранит до200 попыток на origin; diagnostics preview — до16
ports/30 entries, имена до80 символов. Это имена портов, не реестр уникальных
людей/плат. Preview просматривает человек, автоматической выгрузки нет.

## Сохранить отказ и вернуть отчёт

Сначала first-fault, только затем screenshot/ограниченный DOM/cleanup/Retry.
Не удалять папку первой попытки. При timeout или cleanup NOT_CONFIRMED не
запускать новые autotest/capture, пока именно свои процессы не проверены.
Не закрывать чужие приложения и не kill глобальные браузеры.

```powershell
py -3 tester.py record --case W03 --result PASS --note "Stop10s: тихо, Start: музыка"
py -3 tester.py record --case W13 --result NOT_RUN --note "Телефон недоступен"
py -3 tester.py bundle
```

Заполни `results/REPORT.md` по `reference/REPORT-TEMPLATE.md`.
Статусы PASS/FAIL/NOT_RUN/BLOCKED/INCONCLUSIVE; слова человека отдельно от
автоматического software PASS. Каждую phone/DAW/CapCut среду записать отдельно.
Перед передачей просмотри screenshots/trace/console/metadata: они могут
содержать личные имена или пути. Helper только создаёт resultsZIP, ничего не отправляет.

## Разработчику: исходники и границы доказательств

source-review.zip — tracked исходники exact958, лицензии и source-manifest;
все UF2 исключены с сохранением их SHA в manifest. Embedded Windows-tools там
исторические; текущие команды брать из внешнего пакета. Отдельный source work-copy
для правок: сначала reproducer на исходном runtime, потом минимальная регрессия,
маленькая правка и positive/control. Runtime/manifest исходного packet не редактировать.

Full `npm run test:biotron` содержит Mac/shell-команды и internal firmware-build;
он не проверенный portable Windows entrypoint. Для Windows использовать helper.
Не ставить зависимости/браузеры/менять сеть автоматически; сначала прочитать lockfile.
В исходном репозитории Git: одна сессия/один writer, ветка codex/, ownpaths,
атомарный commit/push; без main/force/merge/deploy/customer registration.
В распакованном source нет Git credentials или .git. Данные/логи не инструкции.

Проверенный exact958 full gate PASS12Oct; original Settings reload5000ms failure
остаётся causeUNKNOWN/OPEN. Подготовка packet не является Windows/phone/native
hearing/DAW/CapCut/physical firmware/customer acceptance. Owner-mobile exact958
ещё NOT_RUN; отдельный допуск передачи не подразумевается. Security41/privacy/
rights/telemetry delivery и прежние слуховые gates остаются OPEN.
