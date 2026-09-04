# Habibi PWA

This repository contains a dependency-free, offline-first habit-tracking PWA.
It can be deployed to any static host.

Production: <https://habibi.vaneyghen.be/>

## Local preview

From the repository root:

```sh
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Tests

```sh
npm test
```

## Deploy

Create and publish the production bundle with:

```sh
npm run build
wrangler pages deploy dist/client --project-name habibi-habit-tracker-roel
```

On iPhone, open that URL in Safari, tap **Share**, choose **Add to Home Screen**,
and tap **Add**. Habibi then opens as a standalone app and works offline.

## Backups

**Backup JSON** creates the same current-format backup schema as the iOS app.
On iPhone it opens the share sheet so the file can be saved to Files, AirDrop,
or another destination. **Import JSON** accepts both the current count-based iOS
format and the original completion-set format. Import validation completes
before any existing data is replaced.
