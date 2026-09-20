# CV/Resume App

A small personal CV/resume app built with Vite on the frontend and Express on the backend. One deployment serves both `resume.kaufmann.dev` and `cv.kaufmann.dev`, with content filtered from one shared document according to the current hostname.

## Features

- One shared app for both the resume and CV variants
- Hostname-based visibility filtering via `variant-config.js`
- App-owned viewer passcodes with OIDC-protected admin/editor access
- Shared login session across `resume.kaufmann.dev` and `cv.kaufmann.dev`
- Shared theme and language preferences across both subdomains
- PDF download through the authenticated backend
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

JSON data is stored in `DATA_DIRECTORY` (defaults to the project directory):

- `passcodes.json`: Authentication codes and their expiry dates.
- `document.json`: Shared content with visibility settings.
- `api-keys.json`: API-key hashes and metadata, created when a key is issued.

**IMPORTANT**: These files are excluded from Git (`.gitignore`) to prevent local development data from overwriting production data.

### Initializing Data
When deploying for the first time, you should copy the provided example files to create your initial dataset:
```bash
cp passcodes.json.example passcodes.json
cp document.json.example document.json
```

### Migration and shared content

When `document.json` is absent, startup merges `cv.json` and `resume.json` from `DATA_DIRECTORY`. Do not copy the example document when migrating existing content. Back up both sources before deployment. Matching parent fields are merged recursively with their child lists; identical content becomes visible in both variants. Differing fields remain separate entries with their original visibility. Matching is exact, including translations. CV order is retained, with resume-only content appended. Conflicting section IDs receive numeric suffixes.

Both source files are parsed and the result is validated before writing. Malformed data stops startup. Original files remain untouched for recovery and are never read again once `document.json` exists. With neither source present, startup creates an empty document. Run only one server process per data directory.

The admin **Content** tab edits one shared list. The sidebar shows visibility and item counts; entry headings expand using the keyboard or pointer. Field visibility sits beside each field label, and bullets use multiline inputs. Choose CV, Resume, or Both for sections, items, rows, authors, bullets, tags, and individual content fields. New content defaults to Both. Hiding a parent hides its descendants, regardless of their visibility. Language selection remains independent of visibility.

Click **Save** to persist content. Switching tabs retains edits. Saves reject stale revisions from another editor or MCP client. **Reload** fetches the latest content, discarding local edits. Passcodes and API-key changes save immediately.

### MCP access

Create a named key in admin **API Keys** and copy it when displayed; only its hash is stored. Use the Copy button to copy a newly created key or the connection URL. The page lists named keys with creation dates; revoke keys there for immediate effect. Keys grant read/write access to all document content, but cannot manage passcodes or keys. Viewer passcodes and browser sessions cannot authenticate MCP requests.

Connect with Streamable HTTP at `https://resume.kaufmann.dev/api/mcp` (or the CV hostname) and the header `Authorization: Bearer YOUR_API_KEY`. Requests are stateless POSTs; GET and DELETE return 405. Available tools:

- `get_document`: read shared data and its revision.
- `preview_document`: read the filtered CV or resume.
- `replace_document`: create, update, delete, or reorder content by saving the full document with the revision from `get_document`. Stale revisions are rejected.

Every section, entry, row, author, bullet, and tag has `visibility: "cv" | "resume" | "both"`. Bullets and tags use `{ "text": "Content", "visibility": "both" }`; text may also be localized as `{ "en": "…", "de": "…" }`. Optional `fieldVisibility` controls individual fields, e.g. `{ "info": "cv" }`; unspecified fields are visible in Both. The MCP tool schema describes the full document structure.

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
| `SESSION_STORE_PATH`    |               No               | Persistent session directory; defaults to `.sessions`.                 |

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
The backend runs at `http://localhost:3001`.

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

## Deployment with Coolify

Coolify is the recommended way to deploy this app using Docker/Nixpacks.

### 1. Persistent Storage (CRITICAL)
Since the JSON files and sessions are ignored by Git, you **must** use persistent mounts in Coolify. This keeps data, edits, viewer passcodes, and active server-side sessions across deployments.

In the Coolify dashboard, select the service, open **Storage**, and mount a writable data directory and the session directory:

| Source Path (on Host)      | Destination Path (in Container) |
| -------------------------- | ------------------------------- |
| `/data/cv-resume/content`  | `/app/data`                     |
| `/data/cv-resume/sessions` | `/app/.sessions`                |

Set `DATA_DIRECTORY=/app/data`. Put `passcodes.json`, `resume.pdf`, and either `document.json` or both legacy JSON files into this directory. New installations can copy the `.example` document and passcodes. Existing installations must copy their actual data before starting the new release, then replace the old individual file mounts. Persist the whole directory: atomic document/key replacement requires a writable parent and is incompatible with individual file mounts for those files.

### 2. Environment Variables
In the **Environment Variables** tab, add:

- Every production variable listed in Authentication Setup, with `SESSION_STORE_PATH=/app/.sessions`
- `DATA_DIRECTORY`: `/app/data`
- `PORT`: `3001`
- `NODE_ENV`: `production`

### 3. Domains & SSL
In the **General** settings:
- Add your domains: `https://resume.kaufmann.dev, https://cv.kaufmann.dev`
- Coolify will automatically provision Let's Encrypt certificates and configure the reverse proxy.

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
- The service creates `/var/lib/cv-resume-app/sessions` for encrypted server-side sessions

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
sudo mkdir -p /var/lib/cv-resume-app/data
sudo chown www-data:www-data /var/lib/cv-resume-app/data
sudo chmod 700 /var/lib/cv-resume-app/data
```

Set `DATA_DIRECTORY=/var/lib/cv-resume-app/data` in the service environment and copy the actual data files and `resume.pdf` there, owned by `www-data`. The directory must be writable for atomic content/key replacement.

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

## PDF Download

The PDF download is served by the backend, not directly by nginx static hosting.

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
- `npm test` runs authentication, migration, visibility, persistence, and MCP tests
- `npm run preview` previews the Vite build locally
- `npm run server` starts the Express backend
