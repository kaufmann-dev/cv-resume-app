# Resume Claude

A modern, interactive resume application built with Vite (frontend) and Express (backend). The app now supports both `resume.kaufmann.dev` and `cv.kaufmann.dev` from one shared codebase and one deployment.

## Features

- Interactive resume/CV UI with one shared renderer
- Passcode-protected access
- Hostname-based dataset selection
- Concise cross-link between the resume and CV variants
- Local development fallback to the resume dataset

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
|-- passcodes.json      # Authentication passcodes
`-- resume.pdf          # Current PDF download file
```

## Variant Routing

- `resume.kaufmann.dev` loads `resume.json`
- `cv.kaufmann.dev` loads `cv.json`
- Unknown or local hostnames fall back to the resume variant by default

The fallback is configured in `variant-config.js`.

## Getting Started

### Prerequisites

- Node.js 16 or higher
- npm

### Installation

1. Clone the repository.
2. Run `npm install`.
3. Create `passcodes.json` in the project root if needed:

```json
[
  { "code": "your-code", "expires": "2026-12-31" }
]
```

## Running the App

This project uses a frontend dev server and the backend server together.

### 1. Start the backend

```bash
npm run server
```

The backend runs at `http://localhost:3001`.

### 2. Start the frontend

```bash
npm run dev
```

The frontend runs at the Vite URL shown in the terminal, usually `http://localhost:5173`.

During local development, the frontend automatically calls the backend on `http://localhost:3001` and defaults to the resume variant.

## Production Build

```bash
npm run build
```

The frontend build artifacts are written to `dist/`.
