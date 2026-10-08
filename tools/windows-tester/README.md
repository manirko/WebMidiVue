# Biotron: тестировщик для Windows и Claude Сергея

Самостоятельный внутренний пакет для точного web4bcc0d85c9f7 + firmware1.10.10.
Запускает уже собранный инструмент и сохраняет доказательства. Прошивку не пишет.
Обычный запуск требует Python3.10+ и установленный Chrome/Edge. Наблюдатель
дополнительно требует Node.js20+. Playwright-core1.62.1 включён вместе с лицензией:
`npm install`, Git, WSL, Docker, права администратора и новый браузер не нужны.

Статус8 октября2026: точный веб прошёл37 автоматических проверок на Mac;6
программных/физических направлений оставались NOT RUN. Сам пакет проверяется
отдельно. Реального Windows/DAW PASS на компьютере Андрея нет. Пакет не является
подписанным установщиком и не изменяет производственный стенд или firmware latest.

## Сергею: короткий старт

Распакуй ZIP в локальную папку, например `C:\BiotronTester`. Открой там Claude
Code, дай ему прочитать `CLAUDE.md` и попроси: «Проведи доступные тесты по этому
пакету, сохрани первые ошибки. Физические действия давай по одному».
Claude Desktop может прочитать инструкции; запуск команд требует его доступного
локального инструмента или PowerShell. Доступов к компьютеру пакет не создаёт.

В PowerShell из распакованной папки:

```powershell
py -3 tester.py doctor
py -3 tester.py serve --browser chrome
```

Если `py` отсутствует, но работает `python`, замени `py -3` на `python`.
Если Python/Node отсутствует, Claude сначала фиксирует недостающий runtime и
предлагает обычную установку с официального сайта; без обхода защит/админ-запуска.
`doctor` не устанавливает программы и не подключается к MIDI.

Откроется отдельное тестовое окно по `http://127.0.0.1:8765/#/biotron`.
Разрешение MIDI/SysEx и первый Play подтверждает сам Сергей. Сначала небольшая
системная громкость. Для фоновых тестов звук может продолжиться/остановиться:
записать фактическое поведение. Не менять настройки всей Windows.
Ctrl+C останавливает только сервер; тестовое окно закрывается обычным способом.

## Когда нужно поймать зависание

Закрой предыдущее тестовое окно/сервер. Выполни одну команду:

```powershell
py -3 tester.py capture --browser chrome --minutes 10
```

Для Edge отдельно:

```powershell
py -3 tester.py capture --browser edge --minutes 10
```

Если программа стоит не в обычной папке, укажи точный путь на время этой сессии:

```powershell
$env:EDGE_PATH = 'D:\Programs\Edge\Application\msedge.exe'
```

Наблюдатель открывает видимый Chrome/Edge в своём профиле, не подменяет ОС и
не эмулирует MIDI. Каждую секунду записывает heartbeat страницы, JS heap/DOM,
состояние/часы AudioContext; сохраняет ошибки страницы, снимок и trace.
Он **не добавляет MIDI listeners**, не удерживает порт для DAW, не выдаёт
автоматически SysEx-разрешение и не генерирует ноты/Clock. Нужен известный
физический стимул: как долго касались растения, свет и ожидаемые ноты.
MIDI On/Off записывает сама DAW; audible output оценивает человек.

При timeout сначала сохраняется fault; серия не заменяется успешным retry.
Если окно зависло и trace недоступен, это тоже сохраняется. Затем закрыть только
его тестовое окно. Пакет не применяет `taskkill` ко всем браузерам.

Наблюдение конструктора AudioContext и Playwright могут влиять на поведение.
Поэтому повторить тот же короткий сценарий через `serve` без наблюдателя:
наблюдаемый PASS или отсутствие зависания не доказывает исправления его причины.
Фон проверяется с обычными browser policies; автозвук и fake MIDI не включены.

Для актуального HTTPS-сайта, пока доступен Mac Андрея:

```powershell
py -3 tester.py capture --browser chrome --site live --minutes 10
```

Он проверяет exact commit перед открытием. Недоступность туннеля/другая версия —
BLOCKED, не повод переключаться на производственный сайт. Локальный и live origin
имеют разные permissions/пресеты/PWA; не переносить выводы между ними молча.

## Что проверить последовательно

| ID | Проверка и ожидаемое доказательство |
|---|---|
| W01 | PCB, исходная firmware version/hash если известен, Windows/build, browser version, DAW/version, MAIN/EXTRA, USB adapter и audio output. В диагностиках должен быть web4bcc0d85c9f7. Неизвестное так и записать. |
| W02 | Без прибора изменить/сохранить локальный preset. Подключение не затирает draft; Apply отдельно. После изменения вернуть свой исходный preset. |
| W03 | Plant/light: реальное звучание, короткая/удержанная нота, отпускание. Stop не возобновляет звук от следующих входных нот; повторный Play работает. Проверить аппаратный touch Mute отдельно. |
| W04 | Chrome и Edge по одному: несколько минут заданного стимула и Start/Stop. При зависании записать время, действие, первое сообщение/trace, звук, recovery; затем отдельная попытка. |
| W05 | Ableton/REAPER: MIDI clip с On/Off и реальным звуком на названном receiver. MAIN и EXTRA отдельно; не считать отсутствие EXTRA провалом успешного MAIN music route. |
| W06 | Освободить порт веба -> DAW принимает ноты -> закрыть DAW -> reconnect web. Три реально завершённых цикла. На Windows одновременно открытый порт может мешать; отсутствие ошибок не доказывает release. |
| W07 | Фон/возврат; USB disconnect/reconnect. Записать реальные ноты до/после и восстановление, а не только видимый порт. Lock screen — отдельный наблюдаемый сценарий. |
| W08 | Один online load, затем сеть выключить, закрыть и открыть тот же test profile. Настройки/сравнения работают; incomplete cache не выдаётся за ready. На `127.0.0.1` сеть отключена, но локальный сервер должен оставаться включённым. Полностью server-off PWA проверять в браузере отдельно, не через capture, которому нужна metadata. |
| W09 | Проверка версии/Download & check: exact1.10.10, same/legacy/no-reply flow. Без согласованного W10 не нажимать BOOT/write. Download location выбирает браузер. |
| W10 | Только совместимая подтверждённая плата, независимое firmware-owner review exact diff, свой backup/settings и штатный rollback: browser flash -> readback/sound ->1.10.9 rollback -> readback/sound ->1.10.10 reflash. Восстановить свои настройки. Никаких erase, power cut или чужого raw sector. |
| W11 | NEW -> Compare sounds: отдельно все10 тембров,10 cues,10 upper treatments. Одинаковые volume/quality/output; записать выбор или «ни один» и причину в каждой группе, экспортировать feedback. Рендер и Play не присваивают LISTENED/APPROVED. |
| W12 | Слайдеры/курсор, Humanize built-ins1/user0, компактность, feedback Copy/optional mail, exact diagnostic preview. Скопировать диагностику до/после инцидента в results. |
| W13 | Если есть телефон+USB: отдельная фактическая проверка своего browser/OS/adapter, sound/settings/reconnect. Windows capture или эмулятор её не заменяют. |

Один прибор и один клиент MIDI за раз. Не посылать Clock или config CC из DAW
без отдельного выбранного теста. Исчезнувшая после ожидания нота остаётся
саморазрешившимся инцидентом, а не доказанной починкой.

## Результаты и возврат

Каждая попытка получает отдельную папку `results\<UTC-kind-id>`. Снимки/trace
могут содержать видимые введённые комментарии, диагностику, имя порта и путь
пользователя. Использовать тестовое окно только для Biotron. Просмотреть файлы
перед отправкой. Браузерные profiles/cookies не включаются в results ZIP.
Сам пакет ничего не отправляет; сеть используется приложением/metadata, включая
обычные online technical-event requests; на локальном сервере storage503.

Запись человеческого наблюдения, пример, только после реальной проверки:

```powershell
py -3 tester.py record --case W03 --result FAIL --note 'На Stop нота продолжилась; Chrome ...; firmware ...; повтор ...' --evidence 'results/ИМЯ-ПОПЫТКИ/first-capture-fault.json'
py -3 tester.py bundle
```

`record` лишь сохраняет предоставленное наблюдение с пометкой UNVERIFIED; не
проверяет его истинность и не создаёт customer approval. Добавлять видео/.mid/
diagnostics в соответствующую results-папку; файл может быть `.txt`/`.json`.
После просмотра отправить готовый `biotron-results-....zip` в HT×PL -> Biotron.
Не давать Claude доступ к аккаунтам/секретам Андрея; их в пакете нет.

## Карта файлов и данные

- `tester.py` — verify/doctor/serve/capture/record/bundle, Python standard library.
- `capture-browser.cjs` — ограниченный браузерный наблюдатель, existing Playwright.
- `test_tester.py` — проверки целостности, приватных путей, Windows discovery,
  ограничения сервера/экспорта. Локальный запуск: `py -3 test_tester.py`.
- `CLAUDE.md` — рабочие инструкции Claude Сергея, пределы и first-fault loop.
- `runtime/` — неизменённая опубликованная web4bcc0d85c9f7 с1.10.10/rollback.
- `vendor/playwright-core/` — та же версия1.62.1 и её LICENSE/NOTICE, без browser binary.
- `packet-manifest.json` — SHA256 каждого поставляемого файла; ZIP SHA отдельно в сообщении.
- `listening-30.zip` —30 проверенных WAV и параметры, альтернативное прослушивание.
- `results/`, `.tester-profiles/` — локальные данные после запуска; не коммитить.

Production/readiness решаются существующим product-loop после всех platform,
firmware-owner и human gates. В репозитории только helper source/docs; временные
данные и vendor/runtime остаются в ProjectData. При доработке — ветка manirko,
атомарный commit/push; готовый4bcc архив не перезаписывать.

Метод: [Playwright persistent context](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
с отдельным user data directory; [Python local HTTP server](https://docs.python.org/3/library/http.server.html)
используется только на loopback для внутреннего теста. Проверено8 октября2026.
