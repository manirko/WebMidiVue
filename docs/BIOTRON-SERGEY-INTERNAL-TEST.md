# Biotron — внутренний тест Сергея, 2026-10-07

Статус: подготовка, НЕ передано и НЕ допуск пользователям. Это операторская инструкция конкретного внутреннего изменения, не новый release tracker. Канон допуска: `product-experience/product-loop brief --product biotron`.

## Точный объект

Web runtime source: `30d978514f675d94950ae4a2af998a68e3a1e56e`, repository `manirko/WebMidiVue`, branch `codex/biotron-garden-release`. Последующие коммиты тестов/документации не меняют проверенные runtime-исходники; в архиве закреплён именно этот commit. Build mode: `biotron-firmware-beta`. Архив и hashes: `~/ProjectData/playtronica-firmware/biotron/sergey-internal-30d9785/`. Внутренний архив не является проверенным customer candidate.

Preview для Windows: **НЕ ВЫДАН**. localhost:49304 работает только на Mac Андрея. Не отправлять его Сергею как рабочую ссылку. Не просить устанавливать SDK, Node, Python, запускать CMD или admin. Пакет не отправляется до появления доступного точного preview и принятого пути firmware recovery на его плате.

Firmware 1.10.9 clean: SHA256 `823d044374268462d39b13c0e65dc2676cda2fb3d5162edba78aedccb0a09f3d`.
Rollback 1.9.8 beta08: SHA256 `38c7fd35ef5e456d86b03f50f380d499519835fa84b7516fbd7b1cd1012b91da`.
Оба проверены физически на Fibonacci Андрея; это не подтверждение совместимости неизвестной платы Сергея. Полная flash-копия устройства Андрея не распространяется и не является универсальным rollback для других устройств.

## До теста

Зафиксировать board marker, текущую версию, Windows, браузер и DAW. Не угадывать ревизию платы. При несовместимой/неизвестной плате прошивку не записывать. Экспортировать настройки и проверить доступный recovery. Один Biotron, проверенный data-кабель. Никаких одновременных изменений других приложений.

## Карточка A — Windows first sound и управление (оценка 10 минут)

Почему нужен Сергей: настоящий Windows host и физический слышимый выход.

1. Закрыть DAW, открыть exact preview, подключить Biotron. Выбран один responsive MIDI port; версия читается. Нажать Start listening. Дождаться подтверждения калибровки, услышать звук.
2. Развернуть Garden, drag, закрыть крестиком, повторить с Escape после drag. Звук не обрывается; закрытие срабатывает с первого клика.
3. Stop & release: новых нот нет, хвост затихает. Повторный Start восстанавливает звук без дублей. Play→Settings→Play сохраняет звук одной сессии; Settings показывает «Sound stays on». Release device for DAW отдельно останавливает её.
4. Отключить USB во время звука, подключить обратно и восстановить сессию. Нет зависшей ноты; UI различает потерю устройства и отсутствие звука.
5. Изменить один обратимый параметр, сохранить, replug, проверить readback и восстановить baseline.

Первый reset, потеря USB, stuck note, непонятный статус — STOP; не продолжать ради общего PASS. Сохранить diagnostics и короткое видео симптома. При отсутствии слышимого подтверждения звук BLOCKED, даже если MIDI counters растут.

## Карточка B — владение MIDI между браузером и DAW (оценка 5 минут)

1. В Settings нажать Release device for DAW; затем открыть DAW и включить Biotron input. Не направлять входную дорожку обратно в Biotron.
2. Проверить приход NoteOn/NoteOff и отсутствие хвоста после отпускания.
3. Закрыть DAW, вернуть устройство в Settings предложенным reconnect. Readback и Play снова работают без обязательного USB replug.

Не обещаем совместное владение Windows-портом. При FAIL зафиксировать первое действие, версии и topology; не включать экспериментальные browser flags.

## Карточка C — browser flash (отдельный допуск; сейчас BLOCKED)

Запускать только на подтверждённой совместимой плате с exact образами и проверенным восстановлением. Не совмещать с карточками A/B. Browser updater сейчас не предлагает downgrade/reinstall текущей версии. Полная запись через directory picker и reconnect readback на Windows ещё не доказаны. Native picotool PASS на Mac не закрывает этот пункт. Нельзя просить Сергея импровизировать обход или становиться первым recovery tester.

## Один ответ по каждой карточке

`Biotron 30d9785 / firmware <version> — PASS / FAIL / BLOCKED; Windows / browser / DAW / board marker; первый неуспешный шаг; что увидел и услышал; diagnostics/video при FAIL.`

Ни молчание, ни «вроде работает», ни успех другой версии не считаются PASS. Этот документ не означает, что Сергей получил пакет или прошёл тест.

## Уже имеющиеся evidence и границы

- Andrey, прошлый runtime f602996: крестик, Stop/Start, route lifecycle, USB recovery, persistence — сообщения пользователя в этой сессии. Это историческое evidence, не полный human acceptance нового runtime.
- CUA на exact 30d9785: первая установка, явное обновление, откат/повторное обновление веба на одном origin, две вкладки, отказ сервера файлов, Play→Settings→Play, закрытие полного экрана и Escape после фокуса iframe — PASS. AudioContext продолжал работать; физический выход динамика в этом прогоне не записывался. Подробности: `BIOTRON-PWA-UPDATE-QA-2026-10-07.md`.
- Machine: firmware-beta build/PWA budget и ordinary production isolation PASS на 30d9785. Полный customer release gate не заявлен.
- Реальные audio engine capture и controlled mute/stuck tests PASS; Garden+audio synthetic main-thread contention PASS на раннем runtime источнике той же сцены/engine. Это не физическая слышимость, слабая GPU, долгий soak или полная production UI instrumented acceptance.
- Native physical rollback cycle 1.10.9→1.9.8→1.10.9 PASS; browser file verification/BOOT ранее PASS; full browser write NOT VERIFIED.
- Старые билды до кнопки Update app нужно один раз закрыть во всех вкладках/окнах приложения и открыть снова. Новый UI не может переписать уже закешированный старый JavaScript.
- Live D1 logger delivery, clipboard payload, физический mobile/reduced-motion, слабый компьютер/долгий soak и права Garden/panorama остаются открытыми. Сцена сохранена для внутреннего исследования по текущему указанию пользователя; правами это не является.

После результата Сергея: воспроизвести FAIL, исправить в новом закреплённом candidate, повторить затронутую карточку; затем обязательные release gates и контрольный preview. Клиентам до этого не отправлять.
