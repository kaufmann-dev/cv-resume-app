const ERROR_COPY = {
  en: {
    403: ['Access denied', "You don't have permission to view this page."],
    404: ['Page not found', "This page doesn't exist. It may have been moved, or the address has a typo."],
    500: ['Something went wrong', 'An unexpected error occurred. Try again in a moment.'],
    client: ['Request could not be completed', 'The request was invalid.'],
    status: 'Error',
    home: 'Back to start'
  },
  de: {
    403: ['Zugriff verweigert', 'Du hast keine Berechtigung, diese Seite anzusehen.'],
    404: ['Seite nicht gefunden', 'Diese Seite existiert nicht. Vielleicht wurde sie verschoben oder die Adresse enthält einen Tippfehler.'],
    500: ['Etwas ist schiefgelaufen', 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es gleich noch einmal.'],
    client: ['Anfrage konnte nicht ausgeführt werden', 'Die Anfrage war ungültig.'],
    status: 'Fehler',
    home: 'Zur Startseite'
  }
};

export function renderErrorPage(status, language = 'en') {
  const copy = ERROR_COPY[language] ?? ERROR_COPY.en;
  const [title, message] = copy[status] ?? (status >= 500 ? copy[500] : copy.client);

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; --bg: #ffffff; --t1: #111111; --t3: #6c6c6c; }
    @media (prefers-color-scheme: dark) { :root { --bg: #000000; --t1: #ffffff; --t3: #9f9f9f; } }
    * { box-sizing: border-box; margin: 0; }
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; background: var(--bg); color: var(--t1); font-family: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; text-align: center; }
    main { max-width: 400px; }
    .status { margin-bottom: 16px; color: var(--t3); font-size: 0.66rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; }
    h1 { font-size: 1.4rem; font-weight: 600; }
    p { margin-top: 8px; color: var(--t3); }
    a { display: inline-flex; margin-top: 24px; padding: 12px 28px; background: var(--t1); color: var(--bg); font-size: 0.7rem; font-weight: 600; letter-spacing: 0.12em; text-decoration: none; text-transform: uppercase; }
    a:focus-visible { outline: 2px solid var(--t1); outline-offset: 2px; }
  </style>
</head>
<body>
  <main>
    <div class="status">${copy.status} ${status}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">${copy.home}</a>
  </main>
</body>
</html>
`;
}
