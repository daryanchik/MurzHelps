# MurzHelps v0.2.0 — Murz has learned to tell time

Draft release notes. No v0.2.0 tag or GitHub Release has been created by this preparation work.

Murz now supervises work intervals and breaks from the macOS menu bar.

## Included in v0.2

- Configurable work and break durations, with an optional advance reminder.
- A menu-bar timer with start, pause, resume, restart and manual-break controls.
- Saved settings and timer handling for sleep and screen locking.
- The existing transparent cat overlay and dismiss control.
- A photographic application icon featuring the real Murz, with the original menu-bar silhouette preserved.

## Release-preparation fixes

- Fixed `ENOENT: assets/icon.ico` by generating PNG, ICO and ICNS from one committed photograph before every build.
- Removed the old SVG path from application-icon generation; builds no longer replace the photograph with a silhouette.
- Aligned Forge's bundle icon and Windows installer icon paths.
- Added clean-build icon regression tests and packaged-asset validation.
- Corrected landing-page links and static fallback markup while preserving the approved design and hover behavior.
- Prepared automated website checks and GitHub Pages deployment from `web/`.

## Installation and availability

The release target is **macOS Apple Silicon**. A v0.2.0 installer is not yet published. Native DMG creation, installation acceptance and owner approval are release gates; their actual status is recorded in [VALIDATION.md](VALIDATION.md).

When published, the real installer will appear on the [repository's releases page](https://github.com/daryanchik/MurzHelps/releases). No provisional installer URL is used.

Apple Developer ID signing and notarization are not configured. See the [installation instructions](../README.md#install) for Gatekeeper handling. Windows, Intel Mac and Linux support is not announced for this release.

## Known limitations

- Native click-through, always-on-top behavior, multiple displays, notifications and real sleep/wake need acceptance on the target Mac.
- macOS hit testing is asynchronous at the transparent edge.
- The cat's original photograph is preserved without cropping or regeneration.

See [VALIDATION.md](VALIDATION.md) for executed checks and [MANUAL-TESTS.md](MANUAL-TESTS.md) for remaining native scenarios.
