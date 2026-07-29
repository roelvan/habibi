# Habibi PWA

This folder is a dependency-free, offline-first web version of the SwiftUI app.
It can be deployed as-is to any static host.

## Local preview

From the repository root:

```sh
python3 -m http.server 4173 --directory web
```

Then open <http://localhost:4173>.

## Tests

```sh
node --test web/tests/model.test.mjs
```

## Deploy

Publish the contents of `web/` at an HTTPS URL. No build command is needed. The
site root/output directory is `web`.

On iPhone, open that URL in Safari, tap **Share**, choose **Add to Home Screen**,
and tap **Add**. Habibi then opens as a standalone app and works offline.

## Backups

**Backup JSON** creates the same current-format backup schema as the iOS app.
On iPhone it opens the share sheet so the file can be saved to Files, AirDrop,
or another destination. **Import JSON** accepts both the current count-based iOS
format and the original completion-set format. Import validation completes
before any existing data is replaced.
