# Cookie Switcher

[中文](./README.md) | English

Save a site's current login state (cookies, optionally localStorage) as an "identity" and switch back to it with one click.

A Manifest V3 Chrome extension with local encrypted storage and an optional startup password.

## Features

- **One-click identity switching**: Save the current login state as an "identity"; when you need to swap accounts, click once to switch and reload the page.
- **Configurable cookie scope**:
  - `Include subdomains`: covers every subdomain under `*.example.com` for a more thorough switch.
  - `This domain only`: only touches cookies owned by the current hostname, leaving the parent domain (e.g. `.example.com`) untouched.
- **localStorage snapshot**: Optionally save/restore the page's localStorage (isolated per origin; only written when the origin matches).
- **Three entry points** (the latter two are off by default and can be enabled in settings):
  - Toolbar popup
  - Page right-click menu
  - Draggable in-page floating panel; its dock corner can be configured (top-left / top-right / bottom-left / bottom-right) with a "Reset position" button
- **Local encrypted storage**: Cookies are stored encrypted with AES-256-GCM by default. The key is randomly generated and non-extractable, persisted in IndexedDB, so no plaintext credentials exist in the extension's storage directory.
- **Startup password (optional)**: Locks the UI only; independent of data encryption. Verified with PBKDF2-SHA256, the unlocked state lives in memory and is lost on browser restart, with a cooldown after repeated failures.
- **Import / Export**: Export as JSON; on import, fields are sanitized and validated (domain ownership checked, count and size limited).
- **Clear site cookies**: Logs out of the current page; saved identities are unaffected.
- **Internationalization**: Built-in Simplified Chinese, English and Japanese UI, optionally following the browser language.
- **Quick access scope**: `All / Whitelist only / Exclude blacklist`, with domain rules automatically including subdomains.

## Tech Stack

- TypeScript 5
- React 18 + React DOM
- Vite 6 (the main build handles extension pages and the service worker; a separate IIFE build handles the content script)
- Chrome Extension Manifest V3
- No third-party runtime dependencies (the packaging scripts are pure Node)

## Project Structure

```
src/
  background/    service worker: message handling, cookie I/O, encryption, lock, quick access
    index.ts       message routing and core business logic
    cookies.ts     cookie capture / write / clear (incl. CHIPS partitions, __Host- prefix handling)
    crypto.ts      AES-GCM encryption, key stored in IndexedDB
    storage.ts     identity and settings persistence, serialized read/write
    lock.ts        optional startup password (PBKDF2)
    quickAccess.ts registration / rebuild of the context menu and floating panel
    inject.ts      localStorage read/write (injected via scripting)
    notice.ts      on-page result banner
  content/       in-page floating panel (IIFE content script)
  popup/         toolbar popup
  options/       management page (identities, settings, about)
  shared/        shared types, domain utils, quick-access scope, message protocol, i18n
public/
  manifest.json  extension manifest
  _locales/      localized extension name and description
  icons/         icons
scripts/
  dev.mjs        watch build for development
  make-icons.mjs icon generation
  pack.mjs       zip / crx packaging (CRX3 signing)
```

## Development

Requires Node.js ≥ 18.

```bash
npm install      # install dependencies
npm run dev      # watch both the main build and the content script build
```

Open `chrome://extensions` in your browser, enable "Developer mode", choose "Load unpacked", and point it at the `dist/` directory in the project root. `dist/` updates automatically as you edit source; click refresh on the extensions page to apply changes.

### Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Watch build for development (outputs to `dist/`) |
| `npm run build` | Type check + generate icons + full build |
| `npm run typecheck` | TypeScript type check only |
| `npm run icons` | Generate all icon sizes from `logo.png` |
| `npm run pack` | Build and package into zip and crx |
| `npm run pack:zip` | Package zip only (store upload / distribution) |
| `npm run pack:crx` | Package crx only (local install) |

Packaged artifacts go to `release/`. The crx signing key is generated on first run at `.keys/crx.pem`; back it up and do not commit it (already ignored in `.gitignore`).

## Permissions

| Permission | Purpose |
| --- | --- |
| `cookies` | Read / write / clear site cookies |
| `storage` | Save identities and settings (`unlimitedStorage` provides a larger quota) |
| `scripting` | Inject scripts to read/write localStorage, show the result banner, mount the floating panel |
| `tabs` | Read the current tab and reload the page after switching |
| `contextMenus` | Provide the page right-click menu shortcut |
| `<all_urls>` | Perform the above on any site |

## Design & Security Notes

- **Data stays on your machine** and is never uploaded; uninstalling the extension deletes it.
- Switching an identity **clears cookies within the site's scope first, then writes the snapshot**, so the previous state is not preserved.
- The UI clearly indicates whether storage is encrypted (`Encrypted locally` / `Not encrypted locally`).
- Imported data is rebuilt field by field, rejecting out-of-scope domains and oversized content, to avoid injecting cookies for unintended sites.
- "Forgot password" can only reset the lock by **discarding all saved identities**.

> Saved cookies are equivalent to login credentials. Keep encrypted storage on, store exported files safely, and avoid using this on shared computers.

## Usage Example

1. Open the target site and log in to the account you want to save.
2. Click the toolbar icon, enter a name (e.g. "Work") and a cookie scope, then choose "Save current identity".
3. To swap accounts, open the icon on the same site and click the matching identity for a one-click switch; if "Reload the page after switching" is on, the page reloads automatically.
