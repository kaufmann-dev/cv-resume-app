# CV/Resume App

A small personal CV/resume app built with Vite on the frontend and Express on the backend. One deployment serves both `resume.kaufmann.dev` and `cv.kaufmann.dev`, with the rendered dataset selected from the current hostname at runtime.

## Features

- One shared app for both the resume and CV variants
- Hostname-based dataset selection via `variant-config.js`
- Passcode-protected access
- Shared login session across `resume.kaufmann.dev` and `cv.kaufmann.dev`
- Shared theme and language preferences across both subdomains
- PDF download through the authenticated backend
- Built-in visual editor for real-time content updates
- Local development fallback to the resume variant

## Tech Stack

- Frontend: Vite, plain HTML/CSS/JavaScript
- Backend: Express
- Runtime dependencies: `express`, `cors`
- No database and no SQLite dependency

## Project Structure

```text
resume-app-new/
|-- server.js           # Express backend server
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
- **Admin Passcode**: The `ADMIN_PASSCODE` set via environment variable never expires.
- **Normal Passcodes**: Passcodes in `passcodes.json` must have an `expires` date and will be checked on every login.
- **Cookies**: Successful logins are stored in an `HttpOnly` session cookie scoped to `.kaufmann.dev`. Theme and language preferences are also shared across subdomains.

## Local Development

### Prerequisites
- Node.js 20 LTS or 22 LTS recommended
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
- **Admin Access**: To use the visual editor locally, you must provide the `ADMIN_PASSCODE` environment variable when starting the server (e.g., `$env:ADMIN_PASSCODE="secret"; npm run server`).
- Session cookies stay local to your localhost environment.
- Theme and language preferences still persist through cookies.

## Deployment with Coolify

Coolify is the recommended way to deploy this app using Docker/Nixpacks.

### 1. Persistent Storage (CRITICAL)
Since the JSON files are ignored by Git, you **must** use **File Mounts** in Coolify. This ensures your data persists across deployments and can be edited through the app's dashboard.

**Detailed Steps:**
1. In the Coolify dashboard, select your **Service**.
2. Go to the **Storage** tab.
3. Add a new **File Mount** for each data file:
   | Source Path (on Host) | Destination Path (in Container) |
   | :--- | :--- |
   | `/data/cv-resume/passcodes.json` | `/app/passcodes.json` |
   | `/data/cv-resume/resume.json` | `/app/resume.json` |
   | `/data/cv-resume/cv.json` | `/app/cv.json` |
   *Note: The Source Path should match the directory you created on your server in Step 1. The Destination Path `/app/` is the standard for Nixpacks builds.*
4. **Initial Data**: If the app fails to start because files are missing, SSH into your server and manually create the source files using the `.example` templates provided in the repo.

### 2. Environment Variables
In the **Environment Variables** tab, add:
- `ADMIN_PASSCODE`: Your secure admin passcode (Mandatory for admin/editor access). **Runtime only**
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

Install it on the server like this:

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
sudo chown root:www-data /var/www/cv-resume-app/passcodes.json
sudo chmod 640 /var/www/cv-resume-app/passcodes.json
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
- proxy `/api/` requests to the Node server

Example shape:

```nginx
server {
    server_name resume.kaufmann.dev cv.kaufmann.dev;

    root /var/www/cv-resume-app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
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

- validates the passcode before download
- reuses the shared session cookie when available
- serves the file through the Express download endpoint
- triggers the browser download from the frontend with a normal navigation to `/api/download`

## Shared sessions across subdomains

Authentication is intentionally shared between:

- `resume.kaufmann.dev`
- `cv.kaufmann.dev`

That works because the backend sets the login cookie for `.kaufmann.dev`.

In production, make sure nginx forwards these headers to the Node app:

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For`

Without those forwarded headers, hostname-based variant selection and secure cookie behavior can be wrong.

## Scripts

- `npm run dev` starts the Vite dev server
- `npm run build` creates the production frontend build
- `npm run preview` previews the Vite build locally
- `npm run server` starts the Express backend
