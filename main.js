import {
  getVariantConfig,
  getVariantConfigById,
  isLocalDevelopmentHostname
} from './variant-config.js';

let lang = 'en';
let theme = 'light';
let documentData = null;
let currentPasscode = '';
let activeVariant = getVariantConfig(window.location.hostname);

const API_BASE_URL = isLocalDevelopmentHostname(window.location.hostname)
  ? 'http://localhost:3001'
  : '';

const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

const authContainer = document.getElementById('auth-container');
const contentContainer = document.getElementById('cv-container');
const authError = document.getElementById('auth-error');
const passcodeInput = document.getElementById('passcode-input');

const openState = {};
const expandedState = {};

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL || window.location.origin);
}

function localize(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value;
  return value[lang] ?? value.en ?? value.de ?? '';
}

function applyVariantChrome() {
  document.title = localize(activeVariant.pageTitle);
  document.getElementById('login-btn').textContent = localize(activeVariant.authButtonLabel);
}

function renderVariantNote() {
  const noteElement = document.getElementById('variant-note');
  const note = localize(activeVariant.switchNote);

  if (!noteElement || !note) return;

  noteElement.innerHTML = `${note.text} <a href="${note.href}">${note.label}</a>`;
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

  return `<div class="entry"><div class="e-line"></div><div class="e-body">
    ${mobMeta ? `<div class="e-mob">${mobMeta}</div>` : ''}
    <div class="e-r1"><span class="entry-title">${title}</span><span class="entry-date">${date}</span></div>
    ${(subtitle || location) ? `<div class="e-r2"><span class="entry-subtitle">${subtitle}</span><span class="entry-location">${location}</span></div>` : ''}
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

async function handleLogin() {
  const passcode = document.getElementById('passcode-input').value;
  authError.textContent = '';

  try {
    const response = await fetch(buildApiUrl('/api/auth'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode, variant: activeVariant.id })
    });

    const result = await response.json();

    if (result.success) {
      documentData = result.data;
      currentPasscode = passcode;
      activeVariant = getVariantConfigById(result.variant);
      authContainer.style.display = 'none';
      contentContainer.style.display = 'block';
      render();
    } else {
      authError.textContent = result.error || 'Login failed';
    }
  } catch (error) {
    authError.textContent = 'Server error. Is the backend running?';
  }
}

document.getElementById('login-btn').addEventListener('click', handleLogin);
passcodeInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') handleLogin();
});

document.getElementById('btn-lang').addEventListener('click', () => {
  saveOpen();
  lang = lang === 'en' ? 'de' : 'en';
  applyVariantChrome();
  render();
});

document.getElementById('btn-theme').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  if (documentData) applyThemeIcons();
});

document.getElementById('btn-dl').addEventListener('click', () => {
  const downloadUrl = buildApiUrl('/api/download');
  downloadUrl.searchParams.set('passcode', currentPasscode);
  downloadUrl.searchParams.set('variant', activeVariant.id);
  window.location.href = downloadUrl.toString();
});

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

applyVariantChrome();
