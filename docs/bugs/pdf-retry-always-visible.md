# Spurious Retry button on PDF tab

- Fix timestamp: 2026-09-20 21:14:49 UTC (+0000)
- Git commit (before fix): d17a61466a13253abc6421d0fbcfc754b25896b7

## Symptom

On the admin PDF tab, the Retry button rendered permanently next to
"Download current PDF", even when the file metadata loaded successfully
and no retry was possible or needed.

## Confirmed root cause

`renderPdf` in `editor.js` hid the button with the `hidden` property, but
`.ed-btn` in `editor.css` sets `display: inline-flex`. Author styles beat
the browser's built-in `[hidden] { display: none }` rule, so the button
ignored `hidden` and always rendered.

## Changes

- `editor.css`: added `.editor-overlay [hidden] { display: none !important; }`
  so `hidden` wins over component display rules everywhere in the editor.
- `editor.js` (`renderPdf`): Retry and the download control are now toggled
  via their wrapping rows, shown only in their respective states
  (download when a file exists, retry only after a load failure).
- `editor.js` (`renderPdf`): "Download current PDF" is now an anchor with
  the shared `.ed-btn` style instead of a bare blue text link.
