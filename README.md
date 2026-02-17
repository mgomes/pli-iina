# pli IINA Plugin

This plugin connects [pli](https://github.com/mgomes/pli) with [IINA](https://iina.io/) so Plex watch progress can be tracked while you watch in IINA.

When a video is opened from `pli` (which adds `X-Pli-*` query parameters to the URL), the plugin starts a session and reports playback state to `pli`.

## What it does

- Starts tracking when IINA loads a URL containing:
  - `X-Pli-Rating-Key`
  - `X-Pli-Callback`
  - optional `X-Pli-Duration`
- Sends JSON updates to `X-Pli-Callback`:
  - immediately on start (`playing`)
  - every 10 seconds (`playing` or `paused`)
  - when pause state changes
  - when playback ends or window closes (`stopped`)

## Report payload

The plugin sends `POST` requests with this JSON body:

```json
{
  "rating_key": "<plex rating key>",
  "time_ms": 123456,
  "duration_ms": 3600000,
  "state": "playing"
}
```

`state` is one of:

- `playing`
- `paused`
- `stopped`

## Build / package

This repo includes a `just` task to package the plugin:

```bash
just pack
```

This runs:

```bash
/Applications/IINA.app/Contents/MacOS/iina-plugin pack .
```

and creates an installable `.iinaplgz` archive.

## Install

1. Build (or download) the `.iinaplgz` package.
2. In IINA, open **Settings > Plugins**.
3. Install the plugin package.

## Notes

- Network permission is enabled in `Info.json`.
- The plugin only activates for URLs that include the `X-Pli-*` parameters.
