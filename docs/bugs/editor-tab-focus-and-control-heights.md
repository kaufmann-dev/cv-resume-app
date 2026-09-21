# Editor tab focus and control heights

- Fix timestamp: 2026-09-21 11:40:15 UTC (+0000)
- Git commit (before fix): 63effadbe9eb538379198888fac107cf21f6aace

## Symptom

Keyboard focus on editor tabs rendered as a detached black outline, and the
new-section type select was shorter than the adjacent add button.

## Confirmed root cause

The shared editor focus rule applied a 3 px external outline to every button.
The type select used padding for its height, while the add button used a 36 px
minimum height.

## Changes

- Kept the tab focus indicator but inset it by 2 px so it stays within the
  tab boundary.
- Added a shared 40 px editor control height for buttons, tabs, selects, and
  single-line inputs. The affected type select and adjacent add button now
  both measure 40 px.
