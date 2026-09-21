# Mixed-language authentication screen

- Fix timestamp: 2026-09-21 11:13:28 UTC (+0000)
- Git commit (before fix): d44d270b682dbe8d5ce2af061fab114c7503b15e

## Symptom

When German was selected, the authentication screen combined German and
English copy. The resume button was localized, while the access heading,
passcode placeholder, separator, and administrator sign-in button remained in
English.

## Confirmed root cause

Those four strings were hard-coded in `index.html`. `applyVariantChrome` only
localized the variant button and document chrome, so changing the language did
not update the authentication card.

## Changes

- Added stable IDs for the authentication heading and separator label.
- Localized the heading, passcode placeholder, separator, and administrator
  sign-in button from `applyVariantChrome`.
- Updated the document language attribute when authentication chrome is
  applied, including before a session is restored.
