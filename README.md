# Project-to-Text Manager

Windows-only Electron desktop application for managing local source projects and converting selected text files into one structured Markdown or TXT document.

## Requirements

- Windows 10 x64 or newer
- Node.js 20 or newer
- npm 10 or newer

## Development

```powershell
npm install
npm run dev
```

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## Windows installer

```powershell
npm run dist:win
```

The per-user NSIS installer is written to `release/Project-to-Text Manager-Setup-<version>-x64.exe`.

Before publishing releases:

1. Replace `REPLACE_WITH_GITHUB_OWNER` in `electron-builder.yml` and `dev-app-update.yml`.
2. Confirm the GitHub repository value (`project-to-text-manager`) in the same files.
3. Optionally add repository secrets `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` for Authenticode signing. Unsigned personal releases are supported but may trigger Windows SmartScreen warnings.
4. Push a version tag such as `v1.0.1`, or run the `Release Windows` workflow manually. The workflow validates, optionally signs, and publishes through `GITHUB_TOKEN`.
5. Keep the package version and release tag aligned.

Minor updates download only after user action and install only after explicit restart confirmation. Major updates additionally require explicit confirmation that all local application configuration will be reset; no automatic backup is created.

## Architecture

- `src/main`: Electron lifecycle, validated IPC, persistence, updater, watcher, scan/preflight/conversion/task services.
- `src/preload`: narrow context-isolated desktop API.
- `src/shared`: Zod models, IPC schemas, presets, selection and output rules.
- `src/renderer`: Fluent UI React shell and Zustand state.
- `tests`: domain, filesystem, preflight, encoding, integrity, collision, and recovery tests.

No CLI, Workspace, source editor, persistent Conversion History, localization, or light theme is included.



