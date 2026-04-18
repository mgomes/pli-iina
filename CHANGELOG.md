# Changelog

## 1.1.10

- Fix overlay buttons (Skip Intro, Skip Credits, Next Episode) after recent IINA update. Register `overlay.onMessage` inside `iina.plugin-overlay-loaded` instead of pre-load — IINA now drops listeners registered before the webview finishes loading.

## 1.1.9

- Diagnostic-only release used to trace the broken overlay click pipeline.

## 1.1.8

- Use mpv `loadfile` for next episode playback.

## 1.1.7

- Center overlay buttons and tighten click targets.

## 1.1.6

- Fix overlay button click handling.

## 1.1.5

- Retry overlay initialization during playback.

## 1.1.4

- Show next episode sooner and set media title.

## 1.1.3

- Avoid URL globals in playback context requests.

## 1.1.2

- Build player context URLs without base URL resolution.

## 1.1.1

- Publish plugin releases from version tags.
