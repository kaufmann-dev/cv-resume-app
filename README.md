# CV/Resume App

A small personal CV/resume app built with Vite on the frontend and Express on the backend. One deployment serves both `resume.kaufmann.dev` and `cv.kaufmann.dev`, with the rendered dataset selected from the current hostname at runtime.

## Features

- One shared app for both the resume and CV variants
- Hostname-based dataset selection via `variant-config.js`
- Passcode-protected access
- Shared login session across `resume.kaufmann.dev` and `cv.kaufmann.dev`
- Shared theme and language preferences across both subdomains
- PDF download through the authenticated backend
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
|-- style.css           # Styling
|-- resume.json         # Resume dataset
|-- cv.json             # CV dataset
|-- resume.pdf          # Current PDF download file
|-- deploy.sh           # Deployment helper for pull/build/restart
|-- cv-resume-app.service # Example systemd service file
|-- package.json
|-- package-lock.json
`-- passcodes.json      # Local/private passcodes file
```

## Variant Routing

- `resume.kaufmann.dev` loads `resume.json`
- `cv.kaufmann.dev` loads `cv.json`
- Unknown or local hostnames fall back to the resume variant

That mapping lives in `variant-config.js`.

## Passcodes

Create a `passcodes.json` file in the project root:

```json
[
  { "code": "your-code", "expires": "2026-12-31" }
]
```

Notes:

- Successful logins are stored in an `HttpOnly` session cookie
- On the real domains, that cookie is scoped to `.kaufmann.dev`
- Logging in on one subdomain automatically logs you in on the other
- On reload, the app automatically rechecks the shared session cookie
- If the passcode is expired or invalid, the cookie is cleared and the user must log in again

## Preferences

Theme and language are stored in first-party cookies:

- `kaufmann_dev_theme`
- `kaufmann_dev_lang`

On the production domains, those cookies are shared across `.kaufmann.dev`, so your theme and language follow you between `resume.kaufmann.dev` and `cv.kaufmann.dev`.

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

- the frontend talks to `http://localhost:3001`
- unknown or local hostnames default to the resume variant
- session cookies stay local to your localhost environment
- theme and language preferences still persist through cookies

## Production Deployment

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
