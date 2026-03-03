# Resume Claude

A modern, interactive resume application built with Vite (Frontend) and Express (Backend). This application features a secure authentication system to access and download resume data.

## Features

- 📄 **Interactive Resume**: View professional experience and skills in a clean, modern interface.
- 🔒 **Secure Access**: Protected by passcode authentication.
- 📥 **PDF Download**: Securely download the resume in PDF format.
- ⚡ **Fast & Responsive**: Built with Vite for a smooth user experience.

## Project Structure

```
resume-app-new/
├── server.js          # Express backend server
├── index.html         # Frontend entry point
├── main.js            # Frontend logic
├── style.css          # Styling
├── resume.json        # Resume data (source of truth)
├── passcodes.json     # Authentication passcodes (ignored by git)
└── database.db        # Backend database (ignored by git)
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- npm (comes with Node.js)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd resume-app-new
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure passcodes:
   Create a `passcodes.json` file in the root directory (refer to the existing structure if available):
   ```json
   [
     { "code": "your-code", "expires": "2026-12-31" }
   ]
   ```

### Running the Application

This project requires both the frontend dev server and the backend server to be running.

#### 1. Start the Backend Server
```bash
npm run server
```
The server will start at `http://localhost:3001`.

#### 2. Start the Frontend Dev Server
In a new terminal:
```bash
npm run dev
```
The application will be available at the URL provided by Vite (usually `http://localhost:5173`).

## Building for Production

To create a production build of the frontend:
```bash
npm run build
```
The build artifacts will be located in the `dist/` directory.

## License

This project is private and intended for personal use.
