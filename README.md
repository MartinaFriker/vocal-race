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

## Vokal-Kart (second game mode)

`kart.html` is a 3D kart race (Three.js, loaded from jsDelivr and cached for offline use). The kart drives by itself; one chosen vowel steers left, another steers right, silence goes straight. Three computer karts race on the track and can be overtaken; 2 laps.

- Before the race each of the two vowels is held for 2 seconds, or a saved profile from the vowel test page is used.
- Opponent strength: Leicht / Mittel / Schwer. Arrow keys also steer (for testing on a computer).
- Code: `js/kart.js`; vowel detection reuses `js/vowel-analysis.js`.

## Vowel test page

`vokal-test.html` (open it directly, e.g. https://martinafriker.github.io/vocal-race/vokal-test.html) shows which vowel (A, E, I, O, U) the app hears, live, plus the first two formants on a vowel chart. It is a test bench for adding vowel recognition to the game.

- Recognition compares the shape of the spectrum (LPC envelope) with a template per vowel. F1/F2 are shown for information only.
- Built-in templates exist for children and adults. A personal profile (hold each vowel for 2 seconds) is much more accurate and is stored on the device.
- The analysis code is `js/vowel-analysis.js`, which the game can reuse later.

So far it has only been checked with synthesised voices. The pairs most likely to be confused are O/U and I/E.

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
