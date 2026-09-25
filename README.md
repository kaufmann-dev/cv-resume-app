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
- Runtime dependencies: `express`, `express-session`, `pg`, `openid-client`, `cors`, `@modelcontextprotocol/sdk`, `zod`
- PostgreSQL stores all persistent application state

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
|-- storage.js          # PostgreSQL storage, sessions, one-time file import
|-- document-store.js   # Validation and revision-checked persistence
|-- document-model.js   # Visibility projection
|-- document-patch.js   # RFC 6902 patch and diff for granular edits
|-- mcp.js              # MCP tools and key management
|-- document.json.example # Template for shared content
|-- passcodes.json.example # Template for passcodes
|-- resume.pdf          # Initial PDF seed; uploads live in PostgreSQL
|-- deploy.sh           # Deployment helper for VPS
|-- package.json
|-- package-lock.json
```

## Variant Routing

- `resume.kaufmann.dev` shows resume-visible content from the shared PostgreSQL document
- `cv.kaufmann.dev` shows CV-visible content from the shared PostgreSQL document
- Unknown or local hostnames fall back to the resume variant

That mapping lives in `variant-config.js`.

## PostgreSQL Persistence

Set the required backend environment variable:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

Use a dedicated database reachable from the app container. URL-encode special characters in credentials. Use your provider's connection string and TLS parameters when applicable. The database role needs permission to create tables and indexes in its default schema and to read/write those tables: startup creates them automatically. Keep the existing OIDC and session environment variables.

PostgreSQL is the only runtime store. Content and visibility settings use JSONB with an atomic revision check; passcodes and API-key hashes use JSONB collections with transactional row locks; the PDF uses `bytea`; browser sessions use expiring database rows. All app processes read the database directly. Expired sessions are rejected immediately and cleaned up hourly. Database failures stop startup or fail the request; there is no file fallback.

### Initial import and shared content

On the first startup against a new database, the app imports `document.json`, `passcodes.json`, `api-keys.json`, and `resume.pdf`. For each file, the first existing source wins: `/data`, the old `DATA_DIRECTORY` if set, the project's `data/` directory, then its root. Empty lists are respected. Without a shared document, the importer merges `cv.json` and `resume.json`, retaining variant visibility and order. Matching content becomes visible in both variants; differing content stays separate.

Import validation, schema creation, and the migration record commit together in one transaction. Malformed input stops startup and rolls back; fix the source and redeploy to retry. A database lock serializes simultaneous startup. Originals remain untouched. Once migration version 1 exists in `app_migrations`, files are never imported again, so revoked keys and deleted content cannot return on restart. Do not delete that record.

**Existing file-based browser sessions are not imported. Everyone must log in again after this deployment.** API keys and viewer passcodes remain valid after import, subject to their existing expiry rules.

For a fresh installation without content files, the app creates an empty document and empty passcode/key lists and imports the repository PDF if available. Log in through OIDC to populate the app. To seed from examples, copy `document.json.example` and `passcodes.json.example` into `/data` as `document.json` and `passcodes.json` **before the first startup**. Never copy examples over existing production files.

The admin **Content** tab edits one shared list. The sidebar shows visibility and item counts; entry headings expand using the keyboard or pointer. Field visibility sits beside each field label, and bullets use multiline inputs. Choose CV, Resume, or Both for sections, items, rows, authors, bullets, tags, and individual content fields. New content defaults to Both. Hiding a parent hides its descendants, regardless of their visibility. Language selection remains independent of visibility.

Click **Save** to persist content. Switching tabs retains edits. Saves reject stale revisions from another editor or MCP client. **Reload** fetches the latest content, discarding local edits. Passcodes and API-key changes save immediately.

### MCP access

Create a named key in admin **API Keys** and copy it when displayed; only its hash is stored. Use the Copy button to copy a newly created key or the connection URL. The page lists named keys with creation dates; revoke keys there for immediate effect. Keys grant read/write access to all document content, but cannot manage passcodes or keys. Viewer passcodes and browser sessions cannot authenticate MCP requests.

Connect with Streamable HTTP at `https://resume.kaufmann.dev/api/mcp` (or the CV hostname) and the header `Authorization: Bearer YOUR_API_KEY`. Requests are stateless POSTs; GET and DELETE return 405. Available tools:

- `list_sections`: read section summaries (id, type, title, visibility, count) and the revision.
- `get_section`: read one section by id, optionally filtered for a variant or rendered as Markdown (`format: "markdown"`, `locale: "en" | "de"`).
- `get_document`: read all shared data and its revision.
- `preview_document`: read the filtered CV or resume, as JSON or Markdown (`format`, `locale`).
- `put_section`: create or replace one whole section, with optional positioning.
- `delete_section`: delete one section by id.
- `put_item`: append or replace one row/item inside a section.
- `delete_item`: delete one row/item by index.
- `patch_document`: apply granular RFC 6902 edits with a per-operation diff; `dryRun` previews without saving.
- `replace_document`: save the full document (bulk edits and migration only).

Every tool returns typed `structuredContent` alongside its human-readable text; Markdown reads keep the same structured JSON so a follow-up edit needs no second read. Every write tool needs the revision from any read; stale revisions are rejected with the current revision. Patch paths are JSON Pointers below the document root, e.g. `/sections/0/title/en` or `/sections/1/items/0/highlights/-` to append a bullet. Use `test` operations or `dryRun` to verify before committing.

Every section, entry, row, author, bullet, and tag has `visibility: "cv" | "resume" | "both"`, defaulting to `"both"` when omitted. Bullets and tags use `{ "text": "Content", "visibility": "both" }`; text may also be localized as `{ "en": "…", "de": "…" }`. Optional `fieldVisibility` controls individual fields, e.g. `{ "info": "cv" }`; unspecified fields are visible in Both. The MCP tool schema describes the full document structure.

### Example passcode import file (`passcodes.json`)
```json
[
  { "code": "your-code", "expires": "2026-12-31" }
]
```

Notes:

- **Viewer passcodes**: New viewer passcodes require an `expires` date. PostgreSQL is checked on every authenticated request, so expiry, edits, and deletion take effect immediately. Failed login attempts are limited to five per 15 minutes for each proxy-derived client IP; valid passcodes bypass the limiter.
- **Admin access**: The OIDC provider's access policy is the only admin admission control. OIDC admins can manage viewer passcodes in the editor.
- **Cookies**: Authentication uses an opaque `HttpOnly` server-side session cookie. Theme and language preferences remain separate and are also shared across subdomains.

## Authentication Setup

Viewer login uses app-owned passcodes from PostgreSQL; admin login uses confidential OIDC Authorization Code with PKCE S256, state, and nonce, and user-initiated admin logout uses provider logout redirection.

**Public Client: Off** (confidential client credentials are required)

**Callback URL:** `OIDC_CALLBACK_URL` (production: `https://resume.kaufmann.dev/auth/callback`)

**Logout Callback URL:** `OIDC_POST_LOGOUT_URL` (production: `https://resume.kaufmann.dev/`)

Token exchange uses `client_secret_post` for token endpoint authentication (`client_id` and `client_secret` as form parameters).

| Environment variable    |            Required            | Purpose                                                                |
| ----------------------- | :----------------------------: | ---------------------------------------------------------------------- |
| `DATABASE_URL`          |              Yes               | PostgreSQL connection string for all persistent state.                 |
| `OIDC_ISSUER_URL`       |              Yes               | Provider issuer URL used for discovery.                                |
| `OIDC_CLIENT_ID`        |              Yes               | Confidential client identifier.                                        |
| `OIDC_CLIENT_SECRET`    |              Yes               | Confidential client secret used at token exchange.                     |
| `OIDC_CALLBACK_URL`     |              Yes               | Exact callback URL; must end in `/auth/callback`.                      |
| `OIDC_POST_LOGOUT_URL`  |              Yes               | Post-logout redirect URL; must be an origin.                           |
| `SESSION_SECRET`        |              Yes               | Session cookie signing secret (at least 32 characters).                |
| `SESSION_COOKIE_DOMAIN` | Production only (optional dev) | Production required value `.kaufmann.dev`; omit for local development. |

## Local Development

### Prerequisites

- Node.js 22.12 or newer
- npm
- A reachable PostgreSQL database and `DATABASE_URL`

### Install
```bash
npm install
```

### Run the backend
```bash
npm run server
```
The backend runs at `http://localhost:3001`. Set `DATABASE_URL` and the Authentication Setup variables before starting. No writable `/data` directory is required; it is only an optional source for the first import.

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
- **Persistent Storage:** PostgreSQL owns persistent state. Keep `/data` attached for the first import, then remove the app volume after verification. The PostgreSQL service needs its own persistent storage and backups.
- **Required environment:** all production authentication variables in Authentication Setup (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_CALLBACK_URL`, `OIDC_POST_LOGOUT_URL`, `SESSION_SECRET`, `SESSION_COOKIE_DOMAIN`), plus `DATABASE_URL` and `NODE_ENV=production`.
- **Optional environment:** `PORT` defaults to `3001`.
- **Domains:** `https://resume.kaufmann.dev, https://cv.kaufmann.dev`.

### Migrating the existing deployment

1. Back up the existing `/data` volume. Confirm it contains the latest document, passcodes, API keys, and uploaded PDF. Keep it mounted at `/data` for the first deployment of this commit; a read-only mount is sufficient. For older deployments with individual mounts or `DATA_DIRECTORY`, keep those sources attached for import.
2. Provision a dedicated PostgreSQL database and add **`DATABASE_URL`** to the app's runtime environment. Keep the authentication variables. Pause edits and stop the old app before starting the new version so it cannot write to files after the import snapshot.
3. Redeploy this commit. Startup creates the schema and imports automatically; no pre/post-deployment command is needed. A failed import leaves no partial database state. Check the logs for `PostgreSQL storage ready; initial data import complete`.
4. Log in again and verify both CV and resume content, passcodes, existing MCP API keys, and the PDF. Confirm an edit survives a restart.
5. Remove the app's `/data` mount and any old file/session mounts, `DATA_DIRECTORY`, and `SESSION_STORE_PATH`, then redeploy. Keep the source backup until satisfied with the migration. The app now needs only the database connection for persistence.

Back up PostgreSQL after migration, including every `app_*` table. The old files are a pre-migration snapshot and will not reflect subsequent edits. To roll back to the old application, stop the new app and restore the pre-migration file backup; changes made in PostgreSQL must be exported separately or they will be absent from that rollback. Only share a database between deployments that should share content and credentials.

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

Create `/etc/cv-resume-app.env` with `DATABASE_URL` and the production Authentication Setup variables, keep it root-owned with mode `600`, then install the service:

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
- Ensure PostgreSQL is reachable by the service; `/data` only needs to be readable during the initial import

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
```

The service reads and writes PostgreSQL. During the first migration, ensure `www-data` can read existing import files; the importer never changes them. Remove legacy mounts and path variables after verification.

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

The PDF download is served by the backend, not directly by nginx static hosting. Admins replace it from the editor **PDF** tab, which shows the current file size and date. It uploads with `POST /api/pdf` (`Content-Type: application/pdf`, up to 10 MB); the upload is validated as a PDF and replaced atomically in PostgreSQL. `GET /api/pdf` reports the current file metadata. Both endpoints require admin access.

The current implementation:

- validates the current admin or viewer session before download
- re-checks viewer passcode revocation and expiry
- reuses the shared session cookie when available
- serves PDF bytes from PostgreSQL through the Express download endpoint
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
- `TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/TEST_DATABASE npm test` runs authentication, migration, visibility, persistence, MCP, and PDF upload tests against PostgreSQL. Use a disposable test database whose role can create schemas; each fixture creates and removes its own schema. Tests never use `DATABASE_URL`.
- `npm run preview` previews the Vite build locally
- `npm run server` starts the Express backend
