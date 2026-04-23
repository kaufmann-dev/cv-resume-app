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
const SUPPORTED_LANGUAGES = ['en', 'de'];

let lang = DEFAULT_LANG;
let editorLang = DEFAULT_LANG;
let theme = DEFAULT_THEME;
let documentData = null;
let activeVariant = getInitialVariantConfig();
let sessionCapabilities = { canEdit: false };
let editorState = {
  visible: false,
  draft: null,
  dirty: false,
  activeSectionId: '',
  sectionTemplate: 'generic'
};

const API_BASE_URL = isLocalDevelopmentHostname(window.location.hostname)
  ? 'http://localhost:3001'
  : '';

const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

const authContainer = document.getElementById('auth-container');
const contentContainer = document.getElementById('cv-container');
const authError = document.getElementById('auth-error');
const passcodeInput = document.getElementById('passcode-input');
const downloadButton = document.getElementById('btn-dl');
const editorToggleButton = document.getElementById('btn-editor');

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureLocalizedString(value = '') {
  if (typeof value === 'string') {
    return { en: value, de: value };
  }

  if (value && typeof value === 'object') {
    return {
      en: value.en ?? value.de ?? '',
      de: value.de ?? value.en ?? ''
    };
  }

  return { en: '', de: '' };
}

function getLocalizedDraftValue(value, language = editorLang) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value[language] ?? value.en ?? value.de ?? '';
}

function setLocalizedDraftValue(value, language, nextText) {
  const localized = ensureLocalizedString(value);
  localized[language] = nextText;
  return localized;
}

function normalizePublication(publication = {}) {
  const normalizedAuthors = Array.isArray(publication.authors)
    ? publication.authors.map((author) => {
      if (typeof author === 'string') {
        return { name: author, highlighted: false };
      }

      return {
        name: author?.name ?? '',
        highlighted: Boolean(author?.highlighted)
      };
    })
    : [];

  return {
    title: ensureLocalizedString(publication.title),
    institution: ensureLocalizedString(publication.institution),
    year: String(publication.year ?? ''),
    authors: normalizedAuthors
  };
}

function normalizeDocumentData(data) {
  const normalized = clone(data);

  normalized.sections = (normalized.sections || []).map((section) => {
    const nextSection = { ...section };

    if (nextSection.title != null) {
      nextSection.title = ensureLocalizedString(nextSection.title);
    }

    if (nextSection.type === 'pub') {
      if (Array.isArray(nextSection.publications)) {
        nextSection.publications = nextSection.publications.map(normalizePublication);
      } else if (typeof nextSection.content === 'string' && nextSection.content.trim()) {
        nextSection.publications = [{
          title: { en: '', de: '' },
          institution: { en: '', de: '' },
          year: '',
          authors: [],
          legacyContent: nextSection.content
        }];
      } else {
        nextSection.publications = [];
      }
    }

    if (nextSection.type === 'entries') {
      nextSection.items = (nextSection.items || []).map((item) => ({
        ...item,
        title: item.title != null ? ensureLocalizedString(item.title) : ensureLocalizedString(''),
        subtitle: item.subtitle != null ? ensureLocalizedString(item.subtitle) : ensureLocalizedString(''),
        location: item.location != null ? ensureLocalizedString(item.location) : ensureLocalizedString(''),
        date: item.date != null ? ensureLocalizedString(item.date) : ensureLocalizedString(''),
        link: item.link
          ? {
            ...item.link,
            label: item.link.label != null ? ensureLocalizedString(item.link.label) : ensureLocalizedString('')
          }
          : undefined,
        highlights: (item.highlights || []).map((hl) => ensureLocalizedString(hl)),
        tags: (item.tags || []).map((tag) => String(tag))
      }));
    }

    if (nextSection.type === 'info') {
      nextSection.rows = (nextSection.rows || []).map((row) => ({
        ...row,
        label: ensureLocalizedString(row.label),
        value: ensureLocalizedString(row.value)
      }));
    }

    return nextSection;
  });

  return normalized;
}

function publicationToHtml(publication) {
  if (publication.legacyContent) {
    return publication.legacyContent;
  }

  const authors = (publication.authors || [])
    .map((author) => {
      const name = author.name?.trim();
      if (!name) return '';
      return author.highlighted ? `<strong>${name}</strong>` : name;
    })
    .filter(Boolean)
    .join(' &amp; ');

  const title = localize(publication.title);
  const institution = localize(publication.institution);
  const year = String(publication.year ?? '').trim();

  const left = [authors, year ? `(${year})` : ''].filter(Boolean).join(' ');
  const right = [title ? `<em>${title}</em>` : '', institution].filter(Boolean).join(' ');

  return [left, right].filter(Boolean).join('. ');
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
  const linkLabel = localize(item.link?.label) || item.link?.href || '';
  const hasTitle = Boolean(title);
  const hasSubtitle = Boolean(subtitle);
  const hasLocation = Boolean(location);
  const hasDate = Boolean(date);
  const hasLink = Boolean(item.link?.href);
  const promoteDateToTopRow = hasSubtitle && hasDate && !hasLocation && !hasLink;
  const mobileMetaParts = [];

  if (promoteDateToTopRow) {
    // On mobile the promoted top-row date is already visible, so avoid duplicating it.
  } else if (hasLink) {
    if (hasDate) {
      mobileMetaParts.push(`<span class="entry-date">${date}</span>`);
    }

    if (hasDate && linkLabel) {
      mobileMetaParts.push('<span class="entry-meta-sep">&#183;</span>');
    }

    if (linkLabel) {
      mobileMetaParts.push(`<a class="entry-link entry-link--mobile" href="${item.link.href}" target="_blank" rel="noopener">${linkLabel}</a>`);
    }
  } else {
    if (hasLocation) {
      mobileMetaParts.push(`<span class="entry-location">${location}</span>`);
    }

    if (hasLocation && hasDate) {
      mobileMetaParts.push('<span class="entry-meta-sep">&#183;</span>');
    }

    if (hasDate) {
      mobileMetaParts.push(`<span class="entry-date">${date}</span>`);
    }
  }

  const mobMeta = mobileMetaParts.join('');
  const useInlineMeta = hasTitle && !hasSubtitle && !hasLink && (hasLocation || hasDate);
  const topRightMeta = hasLink
    ? `<a class="entry-link" href="${item.link.href}" target="_blank" rel="noopener">${linkLabel}</a>`
    : (hasLocation
      ? `<span class="entry-location">${location}</span>`
      : (promoteDateToTopRow ? `<span class="entry-date">${date}</span>` : ''));
  const inlineMeta = useInlineMeta ? `
      <span class="entry-inline-meta entry-inline-meta--text">
        ${hasLocation ? `<span class="entry-location">${location}</span>` : ''}
        ${(hasLocation && hasDate) ? '<span class="entry-meta-sep">&#183;</span>' : ''}
        ${hasDate ? `<span class="entry-date">${date}</span>` : ''}
      </span>
    ` : '';
  const bottomRightMeta = !useInlineMeta && hasDate && !promoteDateToTopRow ? `<span class="entry-date">${date}</span>` : '';
  const showSecondRow = hasSubtitle || Boolean(bottomRightMeta);
  const firstRowClass = promoteDateToTopRow ? 'e-r1 e-r1--date-first' : 'e-r1';
  const secondRowClass = hasSubtitle ? 'e-r2' : 'e-r2 e-r2--meta-only';

  return `<div class="entry"><div class="e-line"></div><div class="e-body">
    ${mobMeta ? `<div class="e-mob">${mobMeta}</div>` : ''}
    <div class="${firstRowClass}"><span class="entry-title">${title}</span>${useInlineMeta ? inlineMeta : topRightMeta}</div>
    ${showSecondRow ? `<div class="${secondRowClass}">${hasSubtitle ? `<span class="entry-subtitle">${subtitle}</span>` : ''}${bottomRightMeta}</div>` : ''}
    ${highlights.length ? `<ul>${highlights.map((highlight) => `<li>${highlight}</li>`).join('')}</ul>` : ''}
    ${item.tags?.length ? `<div class="tags">${item.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
  </div></div>`;
}

function mkSection(section) {
  const ui = documentData.ui;
  const isOpen = section.id in openState ? openState[section.id] : section.open;
  const expanded = !!expandedState[section.id];

  let body = '';

  if (section.type === 'info') {
    body = `<div class="info-grid">${(section.rows || []).map((row) => `<div class="il">${localize(row.label)}</div><div class="iv">${localize(row.value)}</div>`).join('')}</div>`;
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
    const publications = Array.isArray(section.publications) ? section.publications : [];

    if (publications.length) {
      body = `<div class="pub">${publications.map((publication) => `<div class="pub-item">${publicationToHtml(publication)}</div>`).join('')}</div>`;
    } else {
      body = `<div class="pub">${localize(section.content)}</div>`;
    }
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
  renderEditorToggle();
}

function showAuthenticatedView() {
  authContainer.style.display = 'none';
  contentContainer.style.display = 'block';
}

function showAuthView(message = '') {
  contentContainer.style.display = 'none';
  authContainer.style.display = 'flex';
  authError.textContent = message;
  hideEditor();
}

function renderEditorToggle() {
  if (!editorToggleButton) return;
  editorToggleButton.style.display = sessionCapabilities.canEdit ? 'inline-flex' : 'none';
  editorToggleButton.textContent = editorState.visible ? 'Close Editor' : 'Edit';
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function getEditorRoot() {
  return document.getElementById('editor-root');
}

function markDraftDirty() {
  editorState.dirty = true;
  const badge = document.getElementById('editor-dirty');
  if (badge) {
    badge.style.visibility = 'visible';
  }
}

function clearDirtyState() {
  editorState.dirty = false;
  const badge = document.getElementById('editor-dirty');
  if (badge) {
    badge.style.visibility = 'hidden';
  }
}

function sectionTemplates() {
  return {
    generic: {
      entries: {
        title: { en: 'Section title', de: 'Abschnittstitel' },
        item: {
          title: { en: 'New title', de: 'Neuer Titel' },
          subtitle: { en: '', de: '' },
          location: { en: '', de: '' },
          date: { en: '', de: '' },
          highlights: [],
          tags: []
        }
      },
      info: {
        title: { en: 'Information', de: 'Informationen' },
        row: { label: { en: 'Label', de: 'Bezeichnung' }, value: { en: 'Value', de: 'Wert' } }
      },
      pub: {
        title: { en: 'Publications', de: 'Publikationen' },
        publication: {
          title: { en: 'Publication title', de: 'Publikationstitel' },
          institution: { en: 'Institution', de: 'Institution' },
          year: '',
          authors: [{ name: '', highlighted: true }]
        }
      }
    },
    work: {
      entries: {
        title: { en: 'Work Experience', de: 'Berufserfahrung' },
        item: {
          title: { en: 'Company', de: 'Unternehmen' },
          subtitle: { en: 'Role', de: 'Rolle' },
          location: { en: 'City, Country', de: 'Stadt, Land' },
          date: { en: 'Month YYYY – Present', de: 'Monat YYYY – Heute' },
          highlights: [
            { en: 'Impact bullet point', de: 'Leistungsstarker Stichpunkt' }
          ],
          tags: []
        }
      }
    },
    education: {
      entries: {
        title: { en: 'Education', de: 'Bildungsweg' },
        item: {
          title: { en: 'Institution', de: 'Institution' },
          subtitle: { en: 'Degree', de: 'Abschluss' },
          location: { en: 'City, Country', de: 'Stadt, Land' },
          date: { en: 'YYYY – YYYY', de: 'YYYY – YYYY' },
          highlights: [],
          tags: []
        }
      }
    }
  };
}

function buildEditorShell() {
  const root = getEditorRoot();
  if (!root) return;

  root.innerHTML = `
    <div class="editor-backdrop"></div>
    <aside class="editor-panel">
      <header class="editor-header">
        <div>
          <h3>Visual Editor</h3>
          <p>Edit ${activeVariant.id}.json in ${editorLang.toUpperCase()}.</p>
        </div>
        <div class="editor-actions-row">
          <span class="editor-dirty" id="editor-dirty" style="visibility:hidden;">Unsaved changes</span>
          <button type="button" class="editor-btn" id="editor-save-btn">Save</button>
          <button type="button" class="editor-btn editor-btn-secondary" id="editor-close-btn">Close</button>
        </div>
      </header>
      <div class="editor-toolbar">
        <label>
          Document
          <select id="editor-variant-select">
            <option value="resume">resume.json</option>
            <option value="cv">cv.json</option>
          </select>
        </label>
        <label>
          Language
          <select id="editor-lang-select">
            <option value="en">EN</option>
            <option value="de">DE</option>
          </select>
        </label>
        <label>
          New section template
          <select id="editor-template-select">
            <option value="generic">Generic</option>
            <option value="work">Work</option>
            <option value="education">Education</option>
          </select>
        </label>
        <label>
          Section type
          <select id="editor-section-type-select">
            <option value="entries">Entries</option>
            <option value="info">Info</option>
            <option value="pub">Publication</option>
          </select>
        </label>
        <button type="button" class="editor-btn" id="editor-add-section-btn">Add Section</button>
      </div>
      <div id="editor-message" class="editor-message"></div>
      <div class="editor-content" id="editor-content"></div>
    </aside>
  `;

  root.querySelector('.editor-backdrop').addEventListener('click', () => hideEditor());
  root.querySelector('#editor-close-btn').addEventListener('click', () => hideEditor());
  root.querySelector('#editor-save-btn').addEventListener('click', () => saveEditorDraft());

  const variantSelect = root.querySelector('#editor-variant-select');
  variantSelect.value = activeVariant.id;
  variantSelect.addEventListener('change', async (event) => {
    await switchEditorVariant(event.target.value);
  });

  const langSelect = root.querySelector('#editor-lang-select');
  langSelect.value = editorLang;
  langSelect.addEventListener('change', () => {
    editorLang = langSelect.value;
    renderEditorContent();
  });

  const templateSelect = root.querySelector('#editor-template-select');
  templateSelect.value = editorState.sectionTemplate;
  templateSelect.addEventListener('change', () => {
    editorState.sectionTemplate = templateSelect.value;
  });

  root.querySelector('#editor-add-section-btn').addEventListener('click', () => {
    const sectionType = root.querySelector('#editor-section-type-select').value;
    addSection(sectionType);
  });
}

function setEditorMessage(text, mode = 'info') {
  const messageNode = document.getElementById('editor-message');
  if (!messageNode) return;

  messageNode.textContent = text;
  messageNode.dataset.mode = mode;
}

function moveInArray(items, index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= items.length) return;
  [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
}

function newSectionId(base = 'section') {
  const sections = editorState.draft.sections || [];
  let suffix = sections.length + 1;
  let id = `${base}-${suffix}`;

  while (sections.some((section) => section.id === id)) {
    suffix += 1;
    id = `${base}-${suffix}`;
  }

  return id;
}

function addSection(sectionType = 'entries') {
  const templates = sectionTemplates();
  const selected = templates[editorState.sectionTemplate] || templates.generic;

  if (!['entries', 'info', 'pub'].includes(sectionType)) {
    setEditorMessage('Invalid section type.', 'warning');
    return;
  }

  const baseTemplate = selected[sectionType] || templates.generic[sectionType];
  const section = {
    id: newSectionId(sectionType),
    title: clone(baseTemplate.title),
    open: false,
    type: sectionType
  };

  if (sectionType === 'entries') {
    section.items = [clone(baseTemplate.item)];
  } else if (sectionType === 'info') {
    section.rows = [clone(baseTemplate.row)];
  } else if (sectionType === 'pub') {
    section.publications = [normalizePublication(baseTemplate.publication)];
  }

  editorState.draft.sections.push(section);
  editorState.activeSectionId = section.id;
  markDraftDirty();
  renderEditorContent();
}

function addEntryItem(section) {
  section.items = section.items || [];
  section.items.push({
    title: { en: '', de: '' },
    subtitle: { en: '', de: '' },
    location: { en: '', de: '' },
    date: { en: '', de: '' },
    highlights: [],
    tags: []
  });
}

function addInfoRow(section) {
  section.rows = section.rows || [];
  section.rows.push({
    label: { en: '', de: '' },
    value: { en: '', de: '' }
  });
}

function addPublication(section) {
  section.publications = section.publications || [];
  section.publications.push({
    title: { en: '', de: '' },
    institution: { en: '', de: '' },
    year: '',
    authors: [{ name: '', highlighted: true }]
  });
}

function buildSectionCard(section, index) {
  const isActive = editorState.activeSectionId === section.id;
  return `
    <article class="editor-section ${isActive ? 'editor-section-active' : ''}" data-section-index="${index}">
      <header class="editor-section-header">
        <button type="button" class="editor-section-title" data-select-section="${section.id}">${escapeHtml(getLocalizedDraftValue(section.title)) || section.id}</button>
        <div class="editor-inline-actions">
          <button type="button" class="editor-btn editor-btn-secondary" data-move-section="up" data-section-index="${index}">↑</button>
          <button type="button" class="editor-btn editor-btn-secondary" data-move-section="down" data-section-index="${index}">↓</button>
          <button type="button" class="editor-btn editor-btn-danger" data-delete-section="${index}">Delete</button>
        </div>
      </header>
      <div class="editor-section-meta">
        <label class="editor-field">
          <span>Section ID</span>
          <input type="text" data-change-path="sections.${index}.id" data-kind="plain" value="${escapeHtml(section.id)}" />
        </label>
        <label class="editor-field">
          <span>Section Type</span>
          <input type="text" value="${escapeHtml(section.type)}" disabled />
        </label>
        <label class="editor-field">
          <span>Open by default</span>
          <input type="checkbox" data-change-path="sections.${index}.open" data-kind="checkbox" ${section.open ? 'checked' : ''} />
        </label>
      </div>
      ${buildLocalizedEditor(`sections.${index}.title`, 'Section title', section.title)}
      ${buildSectionBody(section, index)}
    </article>
  `;
}

function buildLocalizedEditor(path, label, value) {
  const valueForCurrentLanguage = escapeHtml(getLocalizedDraftValue(value));
  return `
    <label class="editor-field">
      <span>${label} (${editorLang.toUpperCase()})</span>
      <input type="text" data-change-path="${path}" data-kind="localized" value="${valueForCurrentLanguage}" />
    </label>
  `;
}

function buildStringListEditor(items = [], path, label) {
  return `
    <div class="editor-list-group">
      <div class="editor-list-header">
        <span>${label}</span>
        <button type="button" class="editor-btn editor-btn-secondary" data-list-add="${path}">Add</button>
      </div>
      ${(items || []).map((item, index) => `
        <div class="editor-list-row">
          <input type="text" data-change-path="${path}.${index}" data-kind="plain" value="${escapeHtml(String(item ?? ''))}" />
          <button type="button" class="editor-btn editor-btn-secondary" data-list-move="up" data-path="${path}" data-index="${index}">↑</button>
          <button type="button" class="editor-btn editor-btn-secondary" data-list-move="down" data-path="${path}" data-index="${index}">↓</button>
          <button type="button" class="editor-btn editor-btn-danger" data-list-delete="${path}" data-index="${index}">Delete</button>
        </div>
      `).join('')}
    </div>
  `;
}

function buildLocalizedListEditor(items = [], path, label) {
  return `
    <div class="editor-list-group">
      <div class="editor-list-header">
        <span>${label}</span>
        <button type="button" class="editor-btn editor-btn-secondary" data-localized-list-add="${path}">Add</button>
      </div>
      ${(items || []).map((item, index) => `
        <div class="editor-list-row">
          <input type="text" data-change-path="${path}.${index}" data-kind="localized" value="${escapeHtml(getLocalizedDraftValue(item))}" />
          <button type="button" class="editor-btn editor-btn-secondary" data-list-move="up" data-path="${path}" data-index="${index}">↑</button>
          <button type="button" class="editor-btn editor-btn-secondary" data-list-move="down" data-path="${path}" data-index="${index}">↓</button>
          <button type="button" class="editor-btn editor-btn-danger" data-list-delete="${path}" data-index="${index}">Delete</button>
        </div>
      `).join('')}
    </div>
  `;
}

function buildEntriesSectionEditor(section, index) {
  const items = section.items || [];

  return `
    <div class="editor-list-group">
      <div class="editor-list-header">
        <span>Entries</span>
        <div class="editor-inline-actions">
          <label class="editor-field editor-field-inline">
            <span>Show more at</span>
            <input type="number" min="1" data-change-path="sections.${index}.showMoreAt" data-kind="number" value="${section.showMoreAt ?? ''}" />
          </label>
          <button type="button" class="editor-btn" data-add-entry="${index}">Add entry</button>
        </div>
      </div>
      ${items.map((item, itemIndex) => `
        <div class="editor-item-card">
          <div class="editor-inline-actions">
            <strong>Entry ${itemIndex + 1}</strong>
            <button type="button" class="editor-btn editor-btn-secondary" data-move-entry="up" data-section-index="${index}" data-entry-index="${itemIndex}">↑</button>
            <button type="button" class="editor-btn editor-btn-secondary" data-move-entry="down" data-section-index="${index}" data-entry-index="${itemIndex}">↓</button>
            <button type="button" class="editor-btn editor-btn-danger" data-delete-entry="${index}" data-entry-index="${itemIndex}">Delete</button>
          </div>
          ${buildLocalizedEditor(`sections.${index}.items.${itemIndex}.title`, 'Title', item.title)}
          ${buildLocalizedEditor(`sections.${index}.items.${itemIndex}.subtitle`, 'Subtitle', item.subtitle)}
          ${buildLocalizedEditor(`sections.${index}.items.${itemIndex}.location`, 'Location', item.location)}
          ${buildLocalizedEditor(`sections.${index}.items.${itemIndex}.date`, 'Date', item.date)}
          ${buildLocalizedEditor(`sections.${index}.items.${itemIndex}.link.label`, 'Link label', item.link?.label ?? { en: '', de: '' })}
          <label class="editor-field">
            <span>Link URL</span>
            <input type="text" data-change-path="sections.${index}.items.${itemIndex}.link.href" data-kind="plain" value="${escapeHtml(item.link?.href ?? '')}" />
          </label>
          ${buildLocalizedListEditor(item.highlights || [], `sections.${index}.items.${itemIndex}.highlights`, 'Bullet points')}
          ${buildStringListEditor(item.tags || [], `sections.${index}.items.${itemIndex}.tags`, 'Tags')}
        </div>
      `).join('')}
    </div>
  `;
}

function buildInfoSectionEditor(section, index) {
  const rows = section.rows || [];

  return `
    <div class="editor-list-group">
      <div class="editor-list-header">
        <span>Information rows</span>
        <button type="button" class="editor-btn" data-add-row="${index}">Add row</button>
      </div>
      ${rows.map((row, rowIndex) => `
        <div class="editor-item-card">
          <div class="editor-inline-actions">
            <strong>Row ${rowIndex + 1}</strong>
            <button type="button" class="editor-btn editor-btn-secondary" data-move-row="up" data-section-index="${index}" data-row-index="${rowIndex}">↑</button>
            <button type="button" class="editor-btn editor-btn-secondary" data-move-row="down" data-section-index="${index}" data-row-index="${rowIndex}">↓</button>
            <button type="button" class="editor-btn editor-btn-danger" data-delete-row="${index}" data-row-index="${rowIndex}">Delete</button>
          </div>
          ${buildLocalizedEditor(`sections.${index}.rows.${rowIndex}.label`, 'Label', row.label)}
          ${buildLocalizedEditor(`sections.${index}.rows.${rowIndex}.value`, 'Value (HTML allowed)', row.value)}
        </div>
      `).join('')}
    </div>
  `;
}

function buildPubSectionEditor(section, index) {
  const publications = section.publications || [];

  return `
    <div class="editor-list-group">
      <div class="editor-list-header">
        <span>Publications</span>
        <button type="button" class="editor-btn" data-add-publication="${index}">Add publication</button>
      </div>
      ${publications.map((publication, pubIndex) => `
        <div class="editor-item-card">
          <div class="editor-inline-actions">
            <strong>Publication ${pubIndex + 1}</strong>
            <button type="button" class="editor-btn editor-btn-secondary" data-move-publication="up" data-section-index="${index}" data-pub-index="${pubIndex}">↑</button>
            <button type="button" class="editor-btn editor-btn-secondary" data-move-publication="down" data-section-index="${index}" data-pub-index="${pubIndex}">↓</button>
            <button type="button" class="editor-btn editor-btn-danger" data-delete-publication="${index}" data-pub-index="${pubIndex}">Delete</button>
          </div>
          ${buildLocalizedEditor(`sections.${index}.publications.${pubIndex}.title`, 'Title', publication.title)}
          ${buildLocalizedEditor(`sections.${index}.publications.${pubIndex}.institution`, 'Institution', publication.institution)}
          <label class="editor-field">
            <span>Year</span>
            <input type="text" data-change-path="sections.${index}.publications.${pubIndex}.year" data-kind="plain" value="${escapeHtml(publication.year ?? '')}" />
          </label>
          <div class="editor-list-group">
            <div class="editor-list-header">
              <span>Authors</span>
              <button type="button" class="editor-btn editor-btn-secondary" data-add-author="sections.${index}.publications.${pubIndex}.authors">Add author</button>
            </div>
            ${(publication.authors || []).map((author, authorIndex) => `
              <div class="editor-list-row">
                <input type="text" data-change-path="sections.${index}.publications.${pubIndex}.authors.${authorIndex}.name" data-kind="plain" value="${escapeHtml(author.name ?? '')}" />
                <label class="editor-field editor-field-inline editor-checkbox-inline">
                  <input type="checkbox" data-change-path="sections.${index}.publications.${pubIndex}.authors.${authorIndex}.highlighted" data-kind="checkbox" ${author.highlighted ? 'checked' : ''} />
                  <span>Bold</span>
                </label>
                <button type="button" class="editor-btn editor-btn-secondary" data-list-move="up" data-path="sections.${index}.publications.${pubIndex}.authors" data-index="${authorIndex}">↑</button>
                <button type="button" class="editor-btn editor-btn-secondary" data-list-move="down" data-path="sections.${index}.publications.${pubIndex}.authors" data-index="${authorIndex}">↓</button>
                <button type="button" class="editor-btn editor-btn-danger" data-list-delete="sections.${index}.publications.${pubIndex}.authors" data-index="${authorIndex}">Delete</button>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildSectionBody(section, index) {
  if (section.type === 'entries') {
    return buildEntriesSectionEditor(section, index);
  }

  if (section.type === 'info') {
    return buildInfoSectionEditor(section, index);
  }

  if (section.type === 'pub') {
    return buildPubSectionEditor(section, index);
  }

  return '<p>Unsupported section type</p>';
}

function resolvePath(path) {
  const chunks = path.split('.');
  let node = editorState.draft;

  for (let i = 0; i < chunks.length - 1; i += 1) {
    const key = chunks[i];
    const isIndex = /^\d+$/.test(key);
    const resolvedKey = isIndex ? Number(key) : key;

    if (node[resolvedKey] == null) {
      const nextChunk = chunks[i + 1];
      node[resolvedKey] = /^\d+$/.test(nextChunk) ? [] : {};
    }

    node = node[resolvedKey];
  }

  return { node, key: /^\d+$/.test(chunks[chunks.length - 1]) ? Number(chunks[chunks.length - 1]) : chunks[chunks.length - 1] };
}

function getValueAtPath(path) {
  return path.split('.').reduce((acc, part) => {
    if (acc == null) return undefined;
    return acc[/^\d+$/.test(part) ? Number(part) : part];
  }, editorState.draft);
}

function deleteAtPath(path, index) {
  const list = getValueAtPath(path);
  if (!Array.isArray(list)) return;
  list.splice(index, 1);
}

function addToPath(path, value) {
  const list = getValueAtPath(path);
  if (!Array.isArray(list)) return;
  list.push(value);
}

function movePathItem(path, index, direction) {
  const list = getValueAtPath(path);
  if (!Array.isArray(list)) return;
  moveInArray(list, index, direction === 'up' ? -1 : 1);
}

function handleEditorInputChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }

  const path = target.dataset.changePath;
  const kind = target.dataset.kind;

  if (!path || !kind) return;

  const { node, key } = resolvePath(path);

  if (kind === 'localized') {
    node[key] = setLocalizedDraftValue(node[key], editorLang, target.value);
  } else if (kind === 'checkbox') {
    node[key] = Boolean(target.checked);
  } else if (kind === 'number') {
    const parsed = Number(target.value);
    node[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  } else {
    node[key] = target.value;
  }

  markDraftDirty();
}

function attachEditorEvents() {
  const container = document.getElementById('editor-content');
  if (!container) return;

  container.addEventListener('input', handleEditorInputChange);
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.dataset.selectSection) {
      editorState.activeSectionId = button.dataset.selectSection;
      renderEditorContent();
      return;
    }

    if (button.dataset.moveSection) {
      const index = Number(button.dataset.sectionIndex);
      moveInArray(editorState.draft.sections, index, button.dataset.moveSection === 'up' ? -1 : 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.deleteSection) {
      const index = Number(button.dataset.deleteSection);
      editorState.draft.sections.splice(index, 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.addEntry) {
      const sectionIndex = Number(button.dataset.addEntry);
      addEntryItem(editorState.draft.sections[sectionIndex]);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.deleteEntry) {
      const sectionIndex = Number(button.dataset.deleteEntry);
      const entryIndex = Number(button.dataset.entryIndex);
      editorState.draft.sections[sectionIndex].items.splice(entryIndex, 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.moveEntry) {
      const sectionIndex = Number(button.dataset.sectionIndex);
      const entryIndex = Number(button.dataset.entryIndex);
      moveInArray(editorState.draft.sections[sectionIndex].items, entryIndex, button.dataset.moveEntry === 'up' ? -1 : 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.addRow) {
      const sectionIndex = Number(button.dataset.addRow);
      addInfoRow(editorState.draft.sections[sectionIndex]);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.deleteRow) {
      const sectionIndex = Number(button.dataset.deleteRow);
      const rowIndex = Number(button.dataset.rowIndex);
      editorState.draft.sections[sectionIndex].rows.splice(rowIndex, 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.moveRow) {
      const sectionIndex = Number(button.dataset.sectionIndex);
      const rowIndex = Number(button.dataset.rowIndex);
      moveInArray(editorState.draft.sections[sectionIndex].rows, rowIndex, button.dataset.moveRow === 'up' ? -1 : 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.addPublication) {
      const sectionIndex = Number(button.dataset.addPublication);
      addPublication(editorState.draft.sections[sectionIndex]);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.deletePublication) {
      const sectionIndex = Number(button.dataset.deletePublication);
      const pubIndex = Number(button.dataset.pubIndex);
      editorState.draft.sections[sectionIndex].publications.splice(pubIndex, 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.movePublication) {
      const sectionIndex = Number(button.dataset.sectionIndex);
      const pubIndex = Number(button.dataset.pubIndex);
      moveInArray(editorState.draft.sections[sectionIndex].publications, pubIndex, button.dataset.movePublication === 'up' ? -1 : 1);
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.listAdd) {
      addToPath(button.dataset.listAdd, '');
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.localizedListAdd) {
      addToPath(button.dataset.localizedListAdd, { en: '', de: '' });
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.addAuthor) {
      addToPath(button.dataset.addAuthor, { name: '', highlighted: false });
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.listDelete) {
      deleteAtPath(button.dataset.listDelete, Number(button.dataset.index));
      markDraftDirty();
      renderEditorContent();
      return;
    }

    if (button.dataset.listMove) {
      movePathItem(button.dataset.path, Number(button.dataset.index), button.dataset.listMove);
      markDraftDirty();
      renderEditorContent();
    }
  });
}

function renderEditorContent() {
  const container = document.getElementById('editor-content');
  if (!container || !editorState.draft) return;

  container.innerHTML = editorState.draft.sections.map((section, index) => buildSectionCard(section, index)).join('');
}

async function switchEditorVariant(variantId) {
  if (!isKnownVariant(variantId)) {
    return;
  }

  try {
    const url = buildApiUrl('/api/document');
    url.searchParams.set('variant', variantId);

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include'
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      setEditorMessage(result.error || 'Failed to load document', 'error');
      return;
    }

    documentData = normalizeDocumentData(result.data);
    activeVariant = getVariantConfigById(result.variant);
    editorState.draft = clone(documentData);
    editorState.activeSectionId = editorState.draft.sections[0]?.id ?? '';
    clearDirtyState();
    render();
    buildEditorShell();
    attachEditorEvents();
    renderEditorContent();
    setEditorMessage(`Loaded ${activeVariant.dataFile}`, 'info');
  } catch {
    setEditorMessage('Failed to switch document variant.', 'error');
  }
}

async function saveEditorDraft() {
  if (!editorState.draft) return;

  try {
    const response = await fetch(buildApiUrl('/api/document'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: activeVariant.id, data: editorState.draft })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      setEditorMessage(result.error || 'Failed to save document.', 'error');
      return;
    }

    documentData = normalizeDocumentData(result.data);
    editorState.draft = clone(documentData);
    clearDirtyState();
    render();
    buildEditorShell();
    attachEditorEvents();
    renderEditorContent();
    setEditorMessage(`Saved ${activeVariant.dataFile} successfully.`, 'success');
  } catch {
    setEditorMessage('Server error while saving document.', 'error');
  }
}

function showEditor() {
  if (!sessionCapabilities.canEdit) {
    return;
  }

  editorState.visible = true;
  editorState.draft = clone(documentData);
  editorState.activeSectionId = editorState.activeSectionId || editorState.draft.sections[0]?.id || '';
  buildEditorShell();
  attachEditorEvents();
  renderEditorContent();
  clearDirtyState();

  const root = getEditorRoot();
  if (root) {
    root.style.display = 'block';
  }

  renderEditorToggle();
}

function hideEditor() {
  editorState.visible = false;

  const root = getEditorRoot();
  if (root) {
    root.style.display = 'none';
    root.innerHTML = '';
  }

  renderEditorToggle();
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

    documentData = normalizeDocumentData(result.data);
    activeVariant = getVariantConfigById(result.variant);
    sessionCapabilities = result.capabilities || { canEdit: false };
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

editorToggleButton.addEventListener('click', () => {
  if (editorState.visible) {
    hideEditor();
  } else {
    showEditor();
  }
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

attachEditorEvents();
lang = getStoredLanguage();
theme = getStoredTheme();
document.documentElement.setAttribute('data-theme', theme);
applyVariantChrome();
restoreStoredSession();
