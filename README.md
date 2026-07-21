# CV/Resume App

A small personal CV/resume app built with Vite on the frontend and Express on the backend. One deployment serves both `resume.kaufmann.dev` and `cv.kaufmann.dev`, with the rendered dataset selected from the current hostname at runtime.

## Features

- One shared app for both the resume and CV variants
- Hostname-based dataset selection via `variant-config.js`
- App-owned viewer passcodes with OIDC-protected admin/editor access
- Shared login session across `resume.kaufmann.dev` and `cv.kaufmann.dev`
- Shared theme and language preferences across both subdomains
- PDF download through the authenticated backend
- Built-in visual editor for real-time content updates
- Local development fallback to the resume variant

## Tech Stack

- Frontend: Vite, plain HTML/CSS/JavaScript
- Backend: Express
- Runtime dependencies: `express`, `express-session`, `session-file-store`, `openid-client`, `cors`
- No database and no SQLite dependency

## Project Structure

```text
resume-app-new/
|-- server.js           # Express backend server
|-- auth.js             # OIDC and server-side session configuration
|-- variant-config.js   # Hostname -> variant -> file mapping
|-- index.html          # Frontend entry point
|-- main.js             # Frontend logic
|-- editor.js           # Visual editor logic
|-- style.css           # Styling
|-- resume.json         # Resume dataset (ignored by git)
|-- cv.json             # CV dataset (ignored by git)
|-- passcodes.json      # Local/private passcodes file (ignored by git)
|-- resume.json.example # Template for resume data
|-- cv.json.example     # Template for CV data
|-- passcodes.json.example # Template for passcodes
|-- resume.pdf          # Current PDF download file
|-- deploy.sh           # Deployment helper for VPS
|-- package.json
|-- package-lock.json
```

## Variant Routing

- `resume.kaufmann.dev` loads `resume.json`
- `cv.kaufmann.dev` loads `cv.json`
- Unknown or local hostnames fall back to the resume variant

That mapping lives in `variant-config.js`.

## Passcodes & Data Persistence

The application's data is stored in three JSON files:

- `passcodes.json`: Authentication codes and their expiry dates.
- `resume.json`: Content for the resume variant.
- `cv.json`: Content for the CV variant.

**IMPORTANT**: These files are excluded from Git (`.gitignore`) to prevent local development data from overwriting production data.

### Initializing Data
When deploying for the first time, you should copy the provided example files to create your initial dataset:
```bash
cp passcodes.json.example passcodes.json
cp cv.json.example cv.json
cp resume.json.example resume.json
```

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

**Callback URL:** `OIDC_CALLBACK_URL` (production: `/auth/callback`)

**Logout Callback URL:** `OIDC_POST_LOGOUT_URL` (production: `/`)

Token exchange uses `client_secret_post` for token endpoint authentication (`client_id` and `client_secret` as form parameters).

| Environment variable    |            Required            | Purpose                                                                                 |
| ----------------------- | :---------------------------: | --------------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`       |              Yes              | Provider issuer URL used for discovery.                                                  |
| `OIDC_CLIENT_ID`        |              Yes              | Confidential client identifier.                                                           |
| `OIDC_CLIENT_SECRET`    |              Yes              | Confidential client secret used at token exchange.                                         |
| `OIDC_CALLBACK_URL`     |              Yes              | Exact callback URL; must end in `/auth/callback`.                                        |
| `OIDC_POST_LOGOUT_URL`  |              Yes              | Post-logout redirect URL; must be an origin.                                             |
| `SESSION_SECRET`        |              Yes              | Session signing/encryption secret (at least 32 characters).                               |
| `SESSION_COOKIE_DOMAIN` | Production only (optional dev) | Production required value `.kaufmann.dev`; omit for local development.                    |
| `SESSION_STORE_PATH`    |              No               | Persistent session directory; defaults to `.sessions`.                                    |

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

In the Coolify dashboard, select the service, open **Storage**, and add one file mount for each data file plus a directory mount for sessions:

| Source Path (on Host)            | Destination Path (in Container) |
| -------------------------------- | ------------------------------- |
| `/data/cv-resume/passcodes.json` | `/app/passcodes.json`           |
| `/data/cv-resume/resume.json`    | `/app/resume.json`              |
| `/data/cv-resume/cv.json`        | `/app/cv.json`                  |
| `/data/cv-resume/sessions`       | `/app/.sessions`                |

The source paths must exist on the host. Before the first start, initialize the three JSON source files from the repository's `.example` templates.

### 2. Environment Variables
In the **Environment Variables** tab, add:

- Every production variable listed in Authentication Setup, with `SESSION_STORE_PATH=/app/.sessions`
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
sudo chown www-data:www-data /var/www/cv-resume-app/passcodes.json
sudo chmod 600 /var/www/cv-resume-app/passcodes.json
```

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
- `npm test` runs focused authentication and session tests
- `npm run preview` previews the Vite build locally
- `npm run server` starts the Express backend
