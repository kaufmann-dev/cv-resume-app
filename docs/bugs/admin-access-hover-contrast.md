# Admin access hover contrast

- Fix timestamp: 2026-09-21 11:36:14 UTC (+0000)
- Git commit (before fix): 63effadbe9eb538379198888fac107cf21f6aace

## Symptom

Hovering the German **Admin-Zugang** button in dark mode made its label
invisible.

## Confirmed root cause

The generic `.auth-card button:hover` rule set every authentication button's
background to `var(--t1)`. The secondary button retained `var(--t1)` for its
text color, producing white text on a white background in dark mode.

## Changes

- Added a more specific secondary-button hover rule that uses the neutral
  hover surface, preserves the foreground color, and strengthens the border.
- Audited the other public and editor hover states; their foreground and
  background pairs remain matched and do not share this selector conflict.
