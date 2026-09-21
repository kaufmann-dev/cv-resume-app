# Editor select options unreadable

- Fix timestamp: 2026-09-21 11:44:23 UTC (+0000)
- Git commit (before fix): 367551d52843caba6b60a2b919dc29ee20ef69a9

## Symptom

The visibility selector displayed stacked arrow artifacts, and CV and Resume
were invisible when the native option menu opened in dark mode.

## Confirmed root cause

Custom SVG arrows were layered with Chromium's native select controls.
Options inherited the light foreground color, while the native popup retained
a light background.

## Changes

- Restored the native select arrow and removed the custom background image.
- Defined the option foreground and background from the active theme.
- Used an inset focus outline for selects, matching editor tabs.
