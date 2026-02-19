import {
  getVariantConfig,
  getVariantConfigById,
  isKnownVariant,
  isLocalDevelopmentHostname,
  resolveVariantId
} from './variant-config.js';

const DEFAULT_LANG = 'en';
const DEFAULT_THEME = 'light';
const PREF_COOKIE_MAX_AGE = 31536000;

let lang = DEFAULT_LANG;
let theme = DEFAULT_THEME;
let documentData = null;
let activeVariant = getInitialVariantConfig();

const API_BASE_URL = isLocalDevelopmentHostname(window.location.hostname)
  ? 'http://localhost:3001'
  : '';

const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

const authContainer = document.getElementById('auth-container');
const contentContainer = document.getElementById('cv-container');
const authError = document.getElementById('auth-error');
const passcodeInput = document.getElementById('passcode-input');
const downloadButton = document.getElementById('btn-dl');

const openState = {};
const expandedState = {};

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL || window.location.origin);
}

function getSharedPreferenceCookieDomain() {
  const hostname = window.location.hostname.toLowerCase();

  if (hostname === 'kaufmann.dev' || hostname.endsWith('.kaufmann.dev')) {
    return '.kaufmann.dev';
  }

  return '';
}

function getCookieValue(name) {
  const encodedName = `${name}=`;
  const cookiePart = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(encodedName));

  if (!cookiePart) {
    return '';
  }

  return decodeURIComponent(cookiePart.slice(encodedName.length));
}

function setCookieValue(name, value, options = {}) {
  const {
    maxAge = PREF_COOKIE_MAX_AGE,
    domain = getSharedPreferenceCookieDomain()
  } = options;

  const securePart = window.location.protocol === 'https:' ? '; Secure' : '';
  const domainPart = domain ? `; Domain=${domain}` : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${domainPart}${securePart}`;
}

function getStoredTheme() {
  const storedTheme = getCookieValue('kaufmann_dev_theme');
  return storedTheme === 'dark' ? 'dark' : DEFAULT_THEME;
}

function getStoredLanguage() {
  const storedLanguage = getCookieValue('kaufmann_dev_lang');
  return storedLanguage === 'de' ? 'de' : DEFAULT_LANG;
}

function persistTheme() {
  setCookieValue('kaufmann_dev_theme', theme);
}

function persistLanguage() {
  setCookieValue('kaufmann_dev_lang', lang);
}

function localize(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value;
  return value[lang] ?? value.en ?? value.de ?? '';
}

function getMessage(value) {
  return localize(value);
}

function getRequestedLocalVariantId() {
  if (!isLocalDevelopmentHostname(window.location.hostname)) {
    return '';
  }

  const requestedVariant = new URLSearchParams(window.location.search).get('variant');
  return isKnownVariant(requestedVariant) ? requestedVariant : '';
}

function getInitialVariantConfig() {
  const requestedLocalVariantId = getRequestedLocalVariantId();

  if (requestedLocalVariantId) {
    return getVariantConfigById(requestedLocalVariantId);
  }

  return getVariantConfig(window.location.hostname);
}

function getVariantNoteHref(note) {
  if (!note?.href) return '';

  if (!isLocalDevelopmentHostname(window.location.hostname)) {
    return note.href;
  }

  const targetVariantId = resolveVariantId(note.href);

  if (!targetVariantId) {
    return note.href;
  }

  const localUrl = new URL(window.location.href);
  localUrl.searchParams.set('variant', targetVariantId);
  return localUrl.toString();
}

function applyVariantChrome() {
  document.title = localize(activeVariant.pageTitle);
  document.getElementById('login-btn').textContent = localize(activeVariant.authButtonLabel);
}

function renderVariantNote() {
  const noteElement = document.getElementById('variant-note');
  const note = localize(activeVariant.switchNote);

  if (!noteElement || !note) return;

  noteElement.innerHTML = `${note.text} <a href="${getVariantNoteHref(note)}">${note.label}</a>`;
}

function saveOpen() {
  document.querySelectorAll('details[data-id]').forEach((detailsElement) => {
    openState[detailsElement.dataset.id] = detailsElement.open;
  });
}

function mkEntry(item) {
  const title = localize(item.title);
  const subtitle = localize(item.subtitle);
  const location = localize(item.location);
  const date = localize(item.date);
  const highlights = (item.highlights || []).map(localize);
  const mobMeta = [date, location].filter(Boolean).join(' &#183; ');
  const hasTitle = Boolean(title);
  const hasSubtitle = Boolean(subtitle);
  const hasLocation = Boolean(location);
  const hasDate = Boolean(date);
  const useInlineMeta = hasTitle && !hasSubtitle && (hasDate || hasLocation);
  const inlineMeta = useInlineMeta ? `
      <span class="entry-meta">
        ${hasDate ? `<span class="entry-date">${date}</span>` : ''}
        ${(hasDate && hasLocation) ? '<span class="entry-meta-sep">&#183;</span>' : ''}
        ${hasLocation ? `<span class="entry-location entry-location-inline">${location}</span>` : ''}
      </span>
    ` : '';
  const showSecondRow = hasSubtitle || (hasLocation && !useInlineMeta);
  const secondRowClass = hasSubtitle ? 'e-r2' : 'e-r2 e-r2--meta-only';

  return `<div class="entry"><div class="e-line"></div><div class="e-body">
    ${mobMeta ? `<div class="e-mob">${mobMeta}</div>` : ''}
    <div class="e-r1"><span class="entry-title">${title}</span>${useInlineMeta ? inlineMeta : (hasDate ? `<span class="entry-date">${date}</span>` : '')}</div>
    ${showSecondRow ? `<div class="${secondRowClass}">${hasSubtitle ? `<span class="entry-subtitle">${subtitle}</span>` : ''}${hasLocation ? `<span class="entry-location">${location}</span>` : ''}</div>` : ''}
    ${highlights.length ? `<ul>${highlights.map((highlight) => `<li>${highlight}</li>`).join('')}</ul>` : ''}
    ${item.tags?.length ? `<div class="tags">${item.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
    ${item.link?.href ? `<a class="proj-link" href="${item.link.href}" target="_blank" rel="noopener">${localize(item.link.label) || 'Open GitHub'}</a>` : ''}
  </div></div>`;
}

function mkSection(section) {
  const ui = documentData.ui;
  const isOpen = section.id in openState ? openState[section.id] : section.open;
  const expanded = !!expandedState[section.id];

  let body = '';

  if (section.type === 'info') {
    body = `<div class="info-grid">${section.rows.map((row) => `<div class="il">${localize(row.label)}</div><div class="iv">${localize(row.value)}</div>`).join('')}</div>`;
  } else if (section.type === 'entries') {
    const items = section.items || [];
    const cut = section.showMoreAt;

    if (cut && !expanded) {
      body = items.slice(0, cut).map(mkEntry).join('');
      body += `<div class="show-more-wrap"><button class="show-more-btn" data-sec="${section.id}">${localize(ui.showMore)} (${items.length - cut})</button></div>`;
    } else if (cut && expanded) {
      body = items.map(mkEntry).join('');
      body += `<div class="show-more-wrap"><button class="show-more-btn" data-sec="${section.id}">${localize(ui.showLess)}</button></div>`;
    } else {
      body = items.map(mkEntry).join('');
    }
  } else if (section.type === 'pub') {
    body = `<div class="pub">${localize(section.content)}</div>`;
  }

  return `<details data-id="${section.id}"${isOpen ? ' open' : ''}><summary><h2>${localize(section.title)}</h2>${CHEV}</summary><div class="sec-body">${body}</div></details>`;
}

function applyThemeIcons() {
  const darkMode = theme === 'dark';
  const sun = document.getElementById('ico-sun');
  const moon = document.getElementById('ico-moon');
  const label = document.getElementById('theme-lbl');

  if (sun) sun.style.display = darkMode ? '' : 'none';
  if (moon) moon.style.display = darkMode ? 'none' : '';
  if (label) label.textContent = darkMode ? localize(documentData.ui.themeLight) : localize(documentData.ui.themeDark);
}

function render() {
  if (!documentData) return;

  document.documentElement.lang = lang;
  document.getElementById('dl-lbl').textContent = localize(documentData.ui.downloadPdf);
  document.getElementById('btn-lang').textContent = lang === 'en' ? 'DE' : 'EN';
  document.getElementById('cv-body').innerHTML = documentData.sections.map(mkSection).join('');
  renderVariantNote();
  applyVariantChrome();
  applyThemeIcons();
}

function showAuthenticatedView() {
  authContainer.style.display = 'none';
  contentContainer.style.display = 'block';
}

function showAuthView(message = '') {
  contentContainer.style.display = 'none';
  authContainer.style.display = 'flex';
  authError.textContent = message;
}

async function authenticate(options = {}) {
  const {
    passcode = '',
    suppressErrors = false
  } = options;

  authError.textContent = '';

  try {
    const payload = { variant: activeVariant.id };

    if (passcode) {
      payload.passcode = passcode;
    }

    const response = await fetch(buildApiUrl('/api/auth'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      if (!suppressErrors) {
        showAuthView(result.error || 'Login failed');
      }

      return false;
    }

    documentData = result.data;
    activeVariant = getVariantConfigById(result.variant);
    showAuthenticatedView();
    render();
    return true;
  } catch (error) {
    if (!suppressErrors) {
      showAuthView('Server error. Is the backend running?');
    }

    return false;
  }
}

async function handleLogin() {
  const passcode = passcodeInput.value.trim();

  if (!passcode) {
    authError.textContent = getMessage({
      en: 'Please enter a passcode',
      de: 'Bitte Passcode eingeben'
    });
    return;
  }

  const success = await authenticate({ passcode });

  if (success) {
    passcodeInput.value = '';
  }
}

function handleDownload() {
  if (!documentData) {
    showAuthView(getMessage({
      en: 'Your session has ended. Please sign in again.',
      de: 'Deine Sitzung ist beendet. Bitte erneut anmelden.'
    }));
    return;
  }

  const downloadUrl = buildApiUrl('/api/download');
  downloadUrl.searchParams.set('variant', activeVariant.id);
  window.location.assign(downloadUrl.toString());
}

async function restoreStoredSession() {
  authContainer.style.visibility = 'hidden';

  const restored = await authenticate({ suppressErrors: true });

  authContainer.style.visibility = '';

  if (!restored) {
    showAuthView();
  }
}

document.getElementById('login-btn').addEventListener('click', handleLogin);
passcodeInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') handleLogin();
});

document.getElementById('btn-lang').addEventListener('click', () => {
  saveOpen();
  lang = lang === 'en' ? 'de' : 'en';
  persistLanguage();
  applyVariantChrome();
  render();
});

document.getElementById('btn-theme').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  persistTheme();
  document.documentElement.setAttribute('data-theme', theme);
  if (documentData) applyThemeIcons();
});

downloadButton.addEventListener('click', handleDownload);

document.getElementById('cv-body').addEventListener('click', (event) => {
  const button = event.target.closest('.show-more-btn');
  if (!button) return;

  const sectionId = button.dataset.sec;
  saveOpen();
  expandedState[sectionId] = !expandedState[sectionId];
  render();
});

window.addEventListener('beforeprint', () => {
  saveOpen();
  document.querySelectorAll('details[data-id]').forEach((detailsElement) => {
    detailsElement.open = true;
  });
});

window.addEventListener('afterprint', () => {
  document.querySelectorAll('details[data-id]').forEach((detailsElement) => {
    detailsElement.open = !!openState[detailsElement.dataset.id];
  });
});

lang = getStoredLanguage();
theme = getStoredTheme();
document.documentElement.setAttribute('data-theme', theme);
applyVariantChrome();
restoreStoredSession();
