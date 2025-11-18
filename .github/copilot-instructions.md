## Quick context (what this repo is)

- Auuki is a browser-first Progressive Web App (PWA) for structured indoor cycling.
- Bundler: Parcel v2. Entry: `src/index.html` -> `src/index.js`. Service worker in `src/sw.js`.
- Tests: Jest (babel-jest). Storage tests rely on `fake-indexeddb`.

## How to run / test

- Dev server: `npm start` (Parcel).
- Dev TLS: `npm run starttls` (uses `./dev_cert/key.pem` + `./dev_cert/cert.pem`).
- Production build: `npm run build` (Parcel build).
- Tests: `npm test` (Jest). Jest transform is configured in `jest.config.js`.

## Architecture & important directories

- `src/` — main web app code (ES modules). Key entry files:
  - `src/index.html`, `src/index.js` (app boot)
  - `src/sw.js` (service worker cache list and lifecycle)
  - `src/functions.js` (utility library and global event bus `xf`)

- BLE and device stack: `src/ble/` — organized by service (ftms, fec, hrs, cps, etc.).
  - `src/ble/web-ble.js` centralizes UUIDs and Filters; `devices.js` and `connectable.js` manage connections.

- Views and UI: `src/views/` — Web Components / custom elements are defined per-file (e.g. `connection-switch.js`, `workout-list.js`). `src/views/views.js` imports them all.

- Data & storage: `src/fit/`, `src/models/`, `src/storage/` (IDB wrapper, local-storage, uuid).

## Key project patterns that agents should follow

- ESModules & browser-first code
  - Use import/export and `import.meta.url` (service worker registration uses it).
  - Modules assume a browser environment (`navigator`, `window`, `CustomEvent`, Web APIs).

- Global event bus (`xf`)
  - `xf` (from `src/functions.js`) is the preferred pub/sub/store pattern.
  - Dispatch: `xf.dispatch('namespace:action', payload)`; subscribe with `xf.reg('namespace:action', handler)` or `xf.sub`.
  - Example: `src/index.js` calls `xf.dispatch('app:start')` to bootstrap views and services.

- Naming / file conventions
  - Files and custom elements use kebab-case: `views/connection-switch.js` defines `<connection-switch>` behaviour.
  - BLE code is organized by spec (e.g., `ble/ftms/`, `ble/fec/`) so prefer placing protocol logic under those folders.

- Tests mirror source structure under `test/` (e.g. `test/ble/`, `test/fit/`, `test/views/`). Use existing tests as examples for mocking browser APIs.

## Integration points / gotchas

- Browser APIs: Web Bluetooth, Web Serial, Web USB are used. Many modules check `navigator.bluetooth` etc. Running unit tests requires mocks (see `fake-indexeddb` in devDependencies).
- Service worker caching: `src/sw.js` has an explicit resource list — keep it updated when moving files.
- Parcel specifics: Parcel v2 is used; module paths and `import.meta.url` rely on Parcel's handling of URLs.

## Useful files to reference when editing or extending

- Boot & registration: `src/index.js`, `src/sw.js`
- Utilities & bus: `src/functions.js` (read `XF` implementation and usage)
- BLE surface: `src/ble/web-ble.js`, `src/ble/devices.js`
- UI components: `src/views/*.js`, `src/views/views.js`
- Data & FIT: `src/fit/*`, `src/models/*`
- Tests: `test/` mirrors `src/` layout

## When to update this file

- If you add/remove top-level scripts in `package.json` (start/test/build).
- If you change the service worker cached resources in `src/sw.js`.

If anything here is incomplete or unclear, tell me which area you want me to expand (examples, code snippets, or more test-run tips) and I'll update the file.
