# CV/Resume App

A small personal CV/resume app built with Vite on the frontend and Express on the backend. One deployment serves both `resume.kaufmann.dev` and `cv.kaufmann.dev`, with content filtered from one shared document according to the current hostname.

## Features

- One shared app for both the resume and CV variants
- Hostname-based visibility filtering via `variant-config.js`
- App-owned viewer passcodes with OIDC-protected admin/editor access
- Shared login session across `resume.kaufmann.dev` and `cv.kaufmann.dev`
- Shared theme and language preferences across both subdomains
- PDF download through the authenticated backend
- PDF replacement upload from the admin editor
- Shared content editor with visibility controls for sections, items, fields, bullets, tags, and authors
- Hosted MCP endpoint with API keys managed in admin API Keys
- Local development fallback to the resume variant

## Tech Stack

- Frontend: Vite, plain HTML/CSS/JavaScript
- Backend: Express
- Runtime dependencies: `express`, `express-session`, `session-file-store`, `openid-client`, `cors`, `@modelcontextprotocol/sdk`, `zod`
- No database and no SQLite dependency

## Project Structure

```text
resume-app-new/
|-- server.js           # Express backend server
|-- auth.js             # OIDC and server-side session configuration
|-- variant-config.js   # Hostname -> variant mapping
|-- index.html          # Frontend entry point
|-- main.js             # Frontend logic
|-- editor.js           # Visual editor logic
|-- style.css           # Styling
|-- document.json       # Shared document (ignored by git)
|-- document-store.js   # Validation, migration, persistence
|-- document-model.js   # Visibility projection
|-- document-patch.js   # RFC 6902 patch and diff for granular edits
|-- mcp.js              # MCP tools and key management
|-- api-keys.json       # API-key hashes (ignored by git)
|-- passcodes.json      # Local/private passcodes file (ignored by git)
|-- document.json.example # Template for shared content
|-- passcodes.json.example # Template for passcodes
|-- resume.pdf          # Current PDF download file
|-- deploy.sh           # Deployment helper for VPS
|-- package.json
|-- package-lock.json
```

## Variant Routing

- `resume.kaufmann.dev` shows resume-visible content from `document.json`
- `cv.kaufmann.dev` shows CV-visible content from `document.json`
- Unknown or local hostnames fall back to the resume variant

That mapping lives in `variant-config.js`.

## Passcodes & Data Persistence

All persistent state lives in `/data`. Mount one persistent volume at that path:

- `passcodes.json`: Authentication codes and their expiry dates.
- `document.json`: Shared content with visibility settings.
- `api-keys.json`: API-key hashes and metadata, created when a key is issued.
- `resume.pdf`: The authenticated PDF download.
- `sessions/`: Encrypted server-side login sessions.
- `.storage-migrated`: Records completion of the one-time storage migration.

**IMPORTANT**: These files are excluded from Git (`.gitignore`) to prevent local development data from overwriting production data.

### Initializing Data
When deploying for the first time, you should copy the provided example files to create your initial dataset:
```bash
mkdir -p /data
cp passcodes.json.example /data/passcodes.json
cp document.json.example /data/document.json
cp resume.pdf /data/resume.pdf
```

### Migration and shared content

Startup first migrates existing storage into `/data`. Before the migration marker exists, missing destination files are copied from the old `DATA_DIRECTORY` (if set), then the project’s `data/` directory, then its root. Existing destination files always win. Sessions are copied from the old `SESSION_STORE_PATH` (if set), then `.sessions/` or `sessions/` under those source directories. Source files remain untouched so existing file mounts can stay attached during migration. The app then reads and writes only `/data`, with sessions in `/data/sessions`; the old environment variables are migration inputs only. Missing source files cannot be recovered by migration.

When `/data/document.json` is absent, startup merges the migrated `cv.json` and `resume.json` there. Do not copy the example document when migrating existing content. Back up both sources before deployment. Matching parent fields are merged recursively with their child lists; identical content becomes visible in both variants. Differing fields remain separate entries with their original visibility. Matching is exact, including translations. CV order is retained, with resume-only content appended. Conflicting section IDs receive numeric suffixes.

Both source files are parsed and the result is validated before writing. Malformed data stops startup. Original files remain untouched for recovery and are never read again once `document.json` exists. With neither source present, startup creates an empty document. The migration marker is written only after copying and document validation succeed; a failed migration is retried on restart. After completion, removed keys and sessions are never re-imported from old storage. Run only one server process per data directory.

The admin **Content** tab edits one shared list. The sidebar shows visibility and item counts; entry headings expand using the keyboard or pointer. Field visibility sits beside each field label, and bullets use multiline inputs. Choose CV, Resume, or Both for sections, items, rows, authors, bullets, tags, and individual content fields. New content defaults to Both. Hiding a parent hides its descendants, regardless of their visibility. Language selection remains independent of visibility.

Click **Save** to persist content. Switching tabs retains edits. Saves reject stale revisions from another editor or MCP client. **Reload** fetches the latest content, discarding local edits. Passcodes and API-key changes save immediately.

### MCP access

Create a named key in admin **API Keys** and copy it when displayed; only its hash is stored. Use the Copy button to copy a newly created key or the connection URL. The page lists named keys with creation dates; revoke keys there for immediate effect. Keys grant read/write access to all document content, but cannot manage passcodes or keys. Viewer passcodes and browser sessions cannot authenticate MCP requests.

Connect with Streamable HTTP at `https://resume.kaufmann.dev/api/mcp` (or the CV hostname) and the header `Authorization: Bearer YOUR_API_KEY`. Requests are stateless POSTs; GET and DELETE return 405. Available tools:

- `list_sections`: read section summaries (id, type, title, visibility, count) and the revision.
- `get_section`: read one section by id, optionally filtered for a variant.
- `get_document`: read all shared data and its revision.
- `preview_document`: read the filtered CV or resume.
- `put_section`: create or replace one whole section, with optional positioning.
- `delete_section`: delete one section by id.
- `put_item`: append or replace one row/item inside a section.
- `delete_item`: delete one row/item by index.
- `patch_document`: apply granular RFC 6902 edits with a per-operation diff; `dryRun` previews without saving.
- `replace_document`: save the full document (bulk edits and migration only).

Every write tool needs the revision from any read; stale revisions are rejected with the current revision. Patch paths are JSON Pointers below the document root, e.g. `/sections/0/title/en` or `/sections/1/items/0/highlights/-` to append a bullet. Use `test` operations or `dryRun` to verify before committing.

Every section, entry, row, author, bullet, and tag has `visibility: "cv" | "resume" | "both"`, defaulting to `"both"` when omitted. Bullets and tags use `{ "text": "Content", "visibility": "both" }`; text may also be localized as `{ "en": "…", "de": "…" }`. Optional `fieldVisibility` controls individual fields, e.g. `{ "info": "cv" }`; unspecified fields are visible in Both. The MCP tool schema describes the full document structure.

### Example `passcodes.json`
```json
[
  { "code": "your-code", "expires": "2026-12-31" }
]
```

Notes:

- **Viewer passcodes**: Passcodes in `passcodes.json` must have an `expires` date. The file is checked on every authenticated request, so expiry, edits, and deletion take effect immediately. Failed login attempts are limited to five per 15 minutes for each proxy-derived client IP; valid passcodes bypass the limiter.
- **Admin access**: The OIDC provider's access policy is the only admin admission control. OIDC admins can manage viewer passcodes in the editor.
- **Cookies**: Authentication uses an opaque `HttpOnly` server-side session cookie. Theme and language preferences remain separate and are also shared across subdomains.

## Authentication Setup

Viewer login uses app-owned passcodes from `passcodes.json`; admin login uses confidential OIDC Authorization Code with PKCE S256, state, and nonce, and user-initiated admin logout uses provider logout redirection.

**Public Client: Off** (confidential client credentials are required)

**Callback URL:** `OIDC_CALLBACK_URL` (production: `https://resume.kaufmann.dev/auth/callback`)

**Logout Callback URL:** `OIDC_POST_LOGOUT_URL` (production: `https://resume.kaufmann.dev/`)

Token exchange uses `client_secret_post` for token endpoint authentication (`client_id` and `client_secret` as form parameters).

| Environment variable    |            Required            | Purpose                                                                |
| ----------------------- | :----------------------------: | ---------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`       |              Yes               | Provider issuer URL used for discovery.                                |
| `OIDC_CLIENT_ID`        |              Yes               | Confidential client identifier.                                        |
| `OIDC_CLIENT_SECRET`    |              Yes               | Confidential client secret used at token exchange.                     |
| `OIDC_CALLBACK_URL`     |              Yes               | Exact callback URL; must end in `/auth/callback`.                      |
| `OIDC_POST_LOGOUT_URL`  |              Yes               | Post-logout redirect URL; must be an origin.                           |
| `SESSION_SECRET`        |              Yes               | Session signing/encryption secret (at least 32 characters).            |
| `SESSION_COOKIE_DOMAIN` | Production only (optional dev) | Production required value `.kaufmann.dev`; omit for local development. |

## Local Development

### Prerequisites

- Node.js 22.12 or newer
- npm

### Install
```bash
npm install
```

### Run the backend
```bash
npm run server
```
The backend runs at `http://localhost:3001`. Provision `/data` with write access for your local user before starting; local development uses the same storage layout.

### Run the frontend
```bash
npm run dev
```
The frontend usually runs at `http://localhost:5173`.

In local development:

- The frontend talks to `http://localhost:3001`.
- Unknown or local hostnames default to the resume variant.
- Admin access requires a provider client with localhost callback and post-logout URLs plus the required Authentication Setup variables. Leave `SESSION_COOKIE_DOMAIN` unset.
- Session cookies stay local to your localhost environment.
- Theme and language preferences still persist through cookies.

## Coolify Deployment

- **Build Pack:** Nixpacks; `nixpacks.toml` starts `node server.js`.
- **Base Directory:** `/`. This is a server application, not a static site.
- **Persistent Storage:** one writable volume with destination `/data`. No individual persistent file mounts or separate session volume are needed after migration.
- **Required environment:** all production authentication variables in Authentication Setup (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_CALLBACK_URL`, `OIDC_POST_LOGOUT_URL`, `SESSION_SECRET`, `SESSION_COOKIE_DOMAIN`), plus `NODE_ENV=production`.
- **Optional environment:** `PORT` defaults to `3001`.
- **Domains:** `https://resume.kaufmann.dev, https://cv.kaufmann.dev`.

### Migrating the existing deployment

1. Keep the existing file/session mounts attached and add the volume at `/data`. Keep any old `DATA_DIRECTORY` and `SESSION_STORE_PATH` values for this first deployment; they identify migration sources. Ensure the latest `document.json` and `api-keys.json` are available in those sources before replacing an old container: unmounted files in a discarded container cannot be recovered.
2. Deploy this release. Startup copies available content, passcodes, API keys, PDF, and sessions into `/data` without overwriting files already there. It leaves originals intact. No pre/post deployment command is required.
3. Check the logs for `Storage migration complete. All persistent data is now in /data`, then verify your content and API keys in the admin UI. Keep `SESSION_SECRET` unchanged to preserve existing sessions.
4. Remove the old individual file mounts and separate session mount. Remove `DATA_DIRECTORY` and `SESSION_STORE_PATH`; `/data` is now the fixed storage location. Redeploy with only the `/data` volume.

Back up the entire `/data` volume. Do not remove `.storage-migrated` during normal operation: it prevents old revoked keys and deleted sessions from being imported again. A key already lost before migration must be recreated in **API Keys**.

## Production Deployment (Standard VPS)

### Build the frontend

```bash
npm run build
```

The built frontend files are written to `dist/`.

### Backend process

Do not run the backend only in an editor terminal for production. If you start it with `npm run server` and then close the terminal, editor, or SSH session, the Node process will stop.

For production, run the backend as a background service with `systemd`.

This repo already includes a reusable service file:

- `cv-resume-app.service`

Create `/etc/cv-resume-app.env` with the production Authentication Setup variables, keep it root-owned with mode `600`, then install the service:

```bash
sudo cp ./cv-resume-app.service /etc/systemd/system/cv-resume-app.service
sudo systemctl daemon-reload
sudo systemctl enable cv-resume-app
sudo systemctl start cv-resume-app
sudo systemctl status cv-resume-app
```

Useful commands later:

```bash
sudo systemctl restart cv-resume-app
sudo systemctl stop cv-resume-app
sudo journalctl -u cv-resume-app -f
```

Notes:

- This keeps the backend running after you close your editor or SSH session
- It also restarts automatically after crashes or server reboots
- `www-data` is safer than running the app as `root`
- If `npm` is installed somewhere else, check it with `which npm` and adjust `ExecStart`
- If you deploy to another path, update `WorkingDirectory` in `cv-resume-app.service`
- Provision `/data` as a writable directory for `www-data`; sessions are stored in `/data/sessions`

### Ownership

To avoid Git's "detected dubious ownership" warning:

- keep the repo owned by your deploy user or by `root`
- do not `chown -R` the repo to `www-data`
- let only the running service use `www-data`

Recommended simple setup on a small server:

```bash
sudo chown -R root:root /var/www/cv-resume-app
sudo find /var/www/cv-resume-app -type d -exec chmod 755 {} \;
sudo find /var/www/cv-resume-app -type f -exec chmod 644 {} \;
sudo chmod 755 /var/www/cv-resume-app/deploy.sh
sudo mkdir -p /data
sudo chown www-data:www-data /data
sudo chmod 700 /data
```

The service reads and writes `/data`. For the first migration, retain any old `DATA_DIRECTORY` or `SESSION_STORE_PATH` values in the environment so startup can copy that data, then remove them after migration completes. The directory must be writable for atomic content/key replacement.

If you already changed ownership to `www-data` and Git now refuses to run, reset it back to your deploy user or `root` and the warning should go away.

### Updating the app

This repo also includes a simple deployment helper:

- `deploy.sh`

Run it from the project directory on the server:

```bash
./deploy.sh
```

It will:

- `git pull --ff-only`
- `npm ci`
- `npm run build`
- restart the `cv-resume-app` systemd service

If your service has a different name, run:

```bash
SERVICE_NAME=your-service-name ./deploy.sh
```

### Nginx

Nginx should:

- serve the static files from `dist/`
- proxy `/api/` and `/auth/` requests to the Node server

Example shape:

```nginx
server {
    server_name resume.kaufmann.dev cv.kaufmann.dev;

    root /var/www/cv-resume-app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ ^/(api|auth)/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## PDF Download and Upload

The PDF download is served by the backend, not directly by nginx static hosting. Admins replace it from the editor **PDF** tab, which shows the current file size and date. It uploads with `POST /api/pdf` (`Content-Type: application/pdf`, up to 10 MB); the file is validated as a PDF and swapped atomically. `GET /api/pdf` reports the current file metadata. Both endpoints require admin access.

The current implementation:

- validates the current admin or viewer session before download
- re-checks viewer passcode revocation and expiry
- reuses the shared session cookie when available
- serves the file through the Express download endpoint
- triggers the browser download from the frontend with a normal navigation to `/api/download`

## Shared sessions across subdomains

Authentication is intentionally shared between:

- `resume.kaufmann.dev`
- `cv.kaufmann.dev`

That works because `SESSION_COOKIE_DOMAIN=.kaufmann.dev` scopes the opaque session cookie to both hosts. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS; authentication sessions have a 24-hour sliding idle limit and a seven-day absolute limit.

Credentialed browser requests are accepted only from `https://resume.kaufmann.dev`, `https://cv.kaufmann.dev`, and localhost development origins.

In production, make sure nginx forwards these headers to the Node app:

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For`

Without those forwarded headers, hostname-based variant selection and secure cookie behavior can be wrong.

## Scripts

- `npm run dev` starts the Vite dev server
- `npm run build` creates the production frontend build
- `npm test` runs authentication, migration, visibility, persistence, MCP, and PDF upload tests
- `npm run preview` previews the Vite build locally
- `npm run server` starts the Express backend
