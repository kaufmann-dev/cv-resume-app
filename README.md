# CV/Resume App

A small personal CV/resume app built with Vite on the frontend and Express on the backend. One deployment serves both `resume.kaufmann.dev` and `cv.kaufmann.dev`, with the rendered dataset selected from the current hostname at runtime.

## Features

- One shared app for both the resume and CV variants
- Hostname-based dataset selection via `variant-config.js`
- Passcode-protected access
- Stored passcode in the browser for automatic re-auth on reload
- PDF download with explicit streaming and range support
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

- Successful logins are stored in browser `localStorage`
- On reload, the app automatically rechecks the stored passcode
- If the passcode is expired or invalid, it is cleared and the user must log in again

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
- unknown/local hostnames default to the resume variant

## Production Deployment

### Build the frontend

```bash
npm run build
```

The built frontend files are written to `dist/`.

### Backend

Run the Express server separately:

```bash
npm run server
```

You should keep it running with a process manager such as `systemd` or `pm2`.

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
- streams the PDF with `Content-Length`
- supports range requests for resumed downloads
- triggers the browser download from the frontend without navigating away from the app

## Scripts

- `npm run dev` starts the Vite dev server
- `npm run build` creates the production frontend build
- `npm run preview` previews the Vite build locally
- `npm run server` starts the Express backend
