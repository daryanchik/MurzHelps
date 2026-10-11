# MurzHelps

**Productivity, supervised.**

Meet Murz, your Senior Sleep Engineer and Full-Snack Developer. A desktop companion with configurable work intervals, breaks and a menu-bar timer.

Version **0.2.0 is in release preparation**. The release target is **macOS Apple Silicon**. Windows and Intel Mac builds remain experimental; Linux is only a build-verification target.

[Available releases](https://github.com/daryanchik/MurzHelps/releases) · [v0.2.0 release notes](docs/RELEASE-NOTES-v0.2.0.md) · [Validation report](docs/VALIDATION.md)

## Install

Until v0.2.0 is published, the releases page may show only the earlier v0.1.0 prototype. Do not mistake that installer for v0.2.0. A private repository's downloads require repository access.

Once an approved macOS Apple Silicon release is available:

1. Download its `.dmg` from the releases page.
2. Open the disk image and copy `MurzHelps.app` into Applications.
3. Launch the app. Use the cat silhouette in the macOS menu bar to open **Settings**, **Start Timer**, pause, or quit.

The app has no configured Apple Developer ID signing or notarization. If macOS reports an unidentified developer, first verify the download source, then follow [Apple's per-app “Open Anyway” instructions](https://support.apple.com/en-us/102445) in System Settings → Privacy & Security. Managed Macs may prevent this. Do not disable Gatekeeper system-wide.

## Develop

Use Node.js **24** (see `.nvmrc`) and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run check
npm start
```

`npm run check` runs TypeScript, unit/integration tests and the application build. `npm start` requires a regular desktop session. Settings persist; a new launch starts with the timer idle.

```sh
# Run on a Mac with Apple Silicon
npm run make -- --platform=darwin --arch=arm64
npm run check:package
npm run test:smoke
```

Forge writes the application and installer to `out/`. A DMG must be made on macOS. A `.app` cross-packaged on Linux is not a native launch or installation test. [Manual acceptance scenarios](docs/MANUAL-TESTS.md) cover native input, displays, sleep and installation.

## Icons

`assets/icons/murz-icon.png` is the single source photograph for the application icon. `build`, `start`, `package` and `make` automatically generate `assets/icon.png`, `assets/icon.ico` and `assets/icon.icns` using the locked `sharp` dependency. Generated icons are not committed. No ImageMagick, `iconutil`, local conversion app, or AI image generation is needed.

The four committed `tray*.png` files retain the original silhouette and are independent of the application photograph. Routine builds never regenerate the tray or `assets/murz.png`. `npm run assets` is a separate full asset-preparation command; use `npm run assets:icons` to regenerate only application icons.

## Website

The approved static landing page lives in **`web/`**. Its CSS, imagery and one-shot hover animation are preserved. Download buttons point to the releases listing until an actual v0.2.0 installer is published.

```sh
npm run check:web
npx playwright install --with-deps chrome firefox webkit
npm run test:web
```

Browser tests serve the site under `/MurzHelps/`, check 320–1440 px layouts, resource paths, links, and real MP4 hover playback. Chrome is used for its H.264 support; Playwright's Linux Chromium build may lack that codec. `MURZ_CHROME_PATH` can select an existing compatible Chrome executable.

Pull requests run only TypeScript, unit tests, the code build and static-resource checks. Native installers and full browser checks require explicit manual workflow inputs; Electron GUI smoke is a local command. The Pages workflow is prepared to deploy `web/` from `main`. It does not deploy pull requests. The intended URL is `https://daryanchik.github.io/MurzHelps/`; this is not a claim that the site is already live. [Release and Pages setup](docs/RELEASING.md) documents the remaining repository settings and approval steps.

## Known limits

- Developer ID signing and Apple notarization are not configured.
- Native macOS installation and compositor behavior require manual acceptance; automated tests do not establish those results.
- Windows and Intel Mac runtime support is not claimed for this release.
- On macOS, alpha hit testing is asynchronous; fast movement along the antialiased edge can differ by about one DIP.
- The original portrait is fitted without cropping, so it cannot fill most of a wide monitor's width while retaining its full height.
- The source has no open-source license grant (`UNLICENSED` in `package.json`).
