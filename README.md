# Resume App

A modern, semi-private resume application built with Vite (Frontend) and Express (Backend), featuring SQLite storage for resume data and access codes.

## Features

- **Secure Access**: Protected by passcode-based authentication.
- **Dynamic Content**: Resume data served from a SQLite database.
- **Multilingual Support**: Supports multiple languages (English and German).
- **Responsive Design**: Minimalist and clean UI that works on all devices.
- **PDF Export**: Secure download of the full resume in PDF format.

## Tech Stack

- **Frontend**: Vite, Vanilla JavaScript, CSS3
- **Backend**: Node.js, Express.js
- **Database**: SQLite (better-sqlite3)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd resume-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Initialize the database:
   ```bash
   node init-db.js
   ```

### Running the Application

1. Start the backend server:
   ```bash
   npm run server
   ```

2. Start the frontend development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:5173`.

## Deployment

To build the application for production:

```bash
npm run build
```

The output will be in the `dist` directory. The backend should be configured to serve these static files in a production environment.

## License

MIT
