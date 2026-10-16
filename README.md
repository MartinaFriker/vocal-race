# Vokal-Rennen

Logopädisches Autorennen: Hold a vowel (A, E, I, O, U) as long and loud as you can and your car drives faster.

It is a web app (PWA). Once opened over HTTPS it can be added to the home screen of an iPhone, iPad or Android device, and after the first visit it works offline. If the fonts weren't saved on that first visit, it falls back to the system font until the next online visit.

## Files

| Path | What |
|---|---|
| `index.html` | The page |
| `css/style.css`, `js/app.js` | Styles and game logic |
| `assets/` | Car photos, track photos, intro video |
| `icons/` | Home-screen icons |
| `manifest.webmanifest` | App name, colours and icons for installing |
| `sw.js` | Service worker that caches everything for offline use |

## Install on a device

The microphone only works over HTTPS, so open the published address (for example GitHub Pages), not a local file.

- **iPhone / iPad (Safari):** Share button → *Zum Home-Bildschirm*.
- **Android (Chrome):** menu ⋮ → *App installieren* / *Zum Startbildschirm hinzufügen*.

## Publishing a change

After changing any file, raise `VERSION` in `sw.js` (for example `"v1"` → `"v2"`). Otherwise installed devices keep showing the old version from their offline cache. Devices pick up the new version the next time the app is opened online, and use it from the launch after that.

## Try it locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.
