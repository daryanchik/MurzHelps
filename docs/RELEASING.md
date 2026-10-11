# Подготовка и выпуск v0.2.0

Рабочая ветка: `release/v0.2.0-preparation`. Результат текущего задания — исправленная кодовая база и Pull Request. Владелец самостоятельно собирает приложение на MacBook, проверяет и публикует релиз. Публикация релиза, создание тега, загрузка установщиков, merge и развёртывание сайта в этой работе не выполняются. Workflow сборки сам релиз не создаёт.

## Источники иконок

| Файл | Роль |
| --- | --- |
| `assets/icons/murz-icon.png` | Единственный исходник иконки приложения; настоящая фотография |
| `assets/icons/murz-icon.ico`, `assets/icons/murz-icon.icns` | Ранее добавленные экспорты; pipeline их не использует и не перезаписывает |
| `web/assets/murz-icon.png` | Существующий favicon сайта |
| `assets/icon.png`, `assets/icon.ico`, `assets/icon.icns` | Автоматические результаты `scripts/prepare-icons.mjs`; исключены из Git |
| `assets/tray.png`, `assets/tray@2x.png`, `assets/trayTemplate.png`, `assets/trayTemplate@2x.png` | Прежний силуэт трея; обычная сборка их не изменяет |
| `assets/icon.svg` | Старый исходник; больше не используется для иконки приложения и не входит в пакет |

`scripts/build.mjs` сначала генерирует иконки, затем проверяет runtime-ресурсы и собирает приложение. Forge вызывает его через `generateAssets` при `start`, `package` и `make`. Ручное создание отсутствующего ICO больше не требуется. Генератор использует только Node.js и уже зафиксированный `sharp`, сохраняет пропорции и прозрачность.

## Нативная сборка

На macOS Apple Silicon, из обычной desktop-учётной записи:

```sh
npm ci
npm run check
npm run check:web
npm run make -- --platform=darwin --arch=arm64
npm run check:package
npm run test:smoke
```

Результат maker находится в `out/make/`. Открыть созданный DMG, установить приложение и выполнить [MANUAL-TESTS.md](MANUAL-TESTS.md). Проверить фотографию в Finder/Get Info и прежний силуэт в верхней панели. Зафиксировать ОС, архитектуру, SHA-256 установщика и результат установки.

`npm run make -- --platform=win32 --arch=x64` предназначен для Windows; Squirrel на Linux дополнительно требует Wine/Mono. Успешная упаковка файлов не подтверждает поддержку Windows. Нативный DMG нельзя получить Linux maker-командой.

## GitHub Actions

`.github/workflows/build.yml` запускается для pull request и push в `main`. Автоматически выполняются только TypeScript, unit tests, сборка кода и статические ресурсы сайта. Electron GUI не запускается.

Нативная матрица macOS ARM64 (`macos-15`), экспериментальные macOS Intel и Windows x64 выполняется только при ручном `workflow_dispatch` с `build_installers: true`. Полные проверки Chrome, Firefox и WebKit отдельно включаются параметром `check_browsers: true`. Оба параметра по умолчанию выключены; в рамках задания ручной запуск не выполняется.

По умолчанию установщики остаются внутри временной CI-машины и **не загружаются**. Только после явного разрешения владельца ручной запуск workflow с `upload_installers: true` сохраняет их как CI artifacts на 14 дней. Это не GitHub Release. Для запуска на ветке выбрать нужный ref в Actions; файлы workflow должны быть доступны GitHub. Приватный репозиторий использует лимиты Actions своего плана.

## GitHub Pages

Подготовлен `.github/workflows/pages.yml`. Он проверяет ресурсы и публикует только содержимое **`web/`**, без перемещения сайта, backend или сборщика. Публикация происходит только из `main`: при изменениях сайта/его проверки/workflow или ручном запуске. Pull request не публикуется.

Настройки для владельца перед первой разрешённой публикацией:

1. Repository → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Убедиться, что разрешены Actions и environment `github-pages` допускает `main`.
3. После подтверждённого merge проверить workflow `Deploy website to GitHub Pages`.
4. Проверить `https://daryanchik.github.io/MurzHelps/`: изображения, видео, favicon, обе кнопки скачивания, View on GitHub, узкий экран и повторное наведение после ухода курсора.

На момент подготовки репозиторий приватный. GitHub Free поддерживает Pages для публичных репозиториев; Pages для приватных репозиториев требует подходящего платного плана. Видимость репозитория в этой работе не изменяется. Даже доступный публично сайт не делает приватные Releases доступными всем посетителям: для публичного скачивания отдельно нужен публично доступный выпуск. Ссылки сейчас ведут на настоящий список Releases; в нём есть предварительная v0.1.0. Прямую ссылку на v0.2.0 добавлять только после появления реального asset.

Размер сайта должен оставаться меньше 1 GB; ссылки на файлы относительные (`./assets/...`) и работают с префиксом `/MurzHelps/`. Workflow выдаёт минимальные `contents: read`, `pages: write`, `id-token: write` и не включает установщики в Pages artifact.

## Последовательность выпуска после проверки

1. Закрыть фактические блокеры из `VALIDATION.md`, включая нативный DMG и ручную установку.
2. Получить отдельное подтверждение merge и публикации; не считать review разрешением всех последующих действий.
3. После разрешённого merge собрать утверждённый коммит, сверить `package.json`, lockfile и release notes: `0.2.0`.
4. После разрешения загрузки сохранить проверенный ARM64 DMG, вычислить SHA-256. Не подменять его старым v0.1.0 или вспомогательным Linux ZIP.
5. После разрешения публикации создать `v0.2.0`, использовать `RELEASE-NOTES-v0.2.0.md`, прикрепить фактический DMG и checksum. Убрать статус черновика в release notes только после закрытия соответствующих проверок.
6. Проверить опубликованный URL и доступ без авторизации, затем при необходимости прописать именно этот URL в `SITE.downloadUrl`.

Developer ID signing / notarization не настроены. Инструкция установки описывает отдельное исключение Gatekeeper по документации Apple, без глобального отключения защиты.

## Официальные источники

- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Safely open apps on your Mac](https://support.apple.com/en-us/102445)
