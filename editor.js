// ── Visual Editor Module ──
const ARROW_UP = '▲';
const ARROW_DN = '▼';
const CHEV_DN = '▾';

function loc(val, lang) {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  return val[lang] ?? val.en ?? val.de ?? '';
}

function isLocalized(val) {
  return val != null && typeof val === 'object' && !Array.isArray(val) && ('en' in val || 'de' in val);
}

function mkLoc(en, de, shared) {
  if (shared) return en;
  return { en: en || '', de: de || '' };
}

function getEn(val) { return isLocalized(val) ? (val.en || '') : (typeof val === 'string' ? val : ''); }
function getDe(val) { return isLocalized(val) ? (val.de || '') : (typeof val === 'string' ? val : ''); }

function showToast(msg, isError) {
  let t = document.querySelector('.ed-toast');
  if (!t) { t = document.createElement('div'); t.className = 'ed-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  requestAnimationFrame(() => { t.classList.add('visible'); });
  setTimeout(() => t.classList.remove('visible'), 2500);
}

function confirmDialog(msg) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'ed-confirm-overlay';
    ov.innerHTML = `<div class="ed-confirm-box"><div class="ed-confirm-msg">${msg}</div><div class="ed-confirm-actions"><button class="ed-btn" data-r="0">Cancel</button><button class="ed-btn ed-btn--danger" data-r="1">Delete</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => {
      const r = e.target.dataset.r;
      if (r != null) { ov.remove(); resolve(r === '1'); }
    });
  });
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'className') el.className = v;
    else if (k === 'htmlFor') el.setAttribute('for', v);
    else el.setAttribute(k, v);
  });
  children.flat().forEach(c => { if (c != null) el.append(typeof c === 'string' ? c : c); });
  return el;
}

function inputField(label, value, onChange, placeholder) {
  const inp = h('input', { className: 'ed-input', type: 'text', value: value || '', placeholder: placeholder || '' });
  inp.addEventListener('input', () => onChange(inp.value));
  const wrap = h('div', { className: 'ed-field-col' });
  if (label) wrap.appendChild(h('div', { className: 'ed-field-col-label' }, label));
  wrap.appendChild(inp);
  return wrap;
}

function bilingualField(labelText, value, onChange) {
  const shared = !isLocalized(value);
  const group = h('div', { className: 'ed-field-group' });

  function rebuild() {
    group.innerHTML = '';
    const isShared = !isLocalized(currentVal);

    const labelRow = h('div', { style: 'display:flex;align-items:center' });
    labelRow.appendChild(h('span', { className: 'ed-field-label', style: 'margin-bottom:0' }, labelText));
    const cb = h('input', { type: 'checkbox' });
    cb.checked = isShared;
    cb.addEventListener('change', () => {
      if (cb.checked) currentVal = getEn(currentVal);
      else currentVal = { en: typeof currentVal === 'string' ? currentVal : '', de: typeof currentVal === 'string' ? currentVal : '' };
      onChange(currentVal);
      rebuild();
    });
    labelRow.appendChild(h('label', { className: 'ed-shared-toggle' }, cb, 'Same'));
    group.appendChild(labelRow);

    if (isShared) {
      const row = h('div', { className: 'ed-field-row' });
      row.appendChild(inputField('', typeof currentVal === 'string' ? currentVal : '', v => { currentVal = v; onChange(currentVal); }));
      group.appendChild(row);
    } else {
      const row = h('div', { className: 'ed-field-row' });
      row.appendChild(inputField('EN', currentVal.en || '', v => { currentVal.en = v; onChange(currentVal); }));
      row.appendChild(inputField('DE', currentVal.de || '', v => { currentVal.de = v; onChange(currentVal); }));
      group.appendChild(row);
    }
  }

  let currentVal = value == null ? { en: '', de: '' } : (typeof value === 'string' ? value : { en: value.en || '', de: value.de || '' });
  rebuild();
  return group;
}

// ── Editors for each section type ──

function renderInfoCard(row, index, rows, onDataChange, rebuildList) {
  const card = h('div', { className: 'ed-item-card' });

  const header = h('div', { className: 'ed-item-header' });
  header.appendChild(h('span', { className: 'ed-item-title' }, loc(row.label, 'en') || '(untitled)'));

  const actions = h('div', { className: 'ed-item-actions' });
  const up = h('button', { className: 'ed-item-action-btn', title: 'Move up', onClick: e => { e.stopPropagation(); if (index > 0) { rows.splice(index - 1, 0, rows.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_UP);
  const dn = h('button', { className: 'ed-item-action-btn', title: 'Move down', onClick: e => { e.stopPropagation(); if (index < rows.length - 1) { rows.splice(index + 1, 0, rows.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_DN);
  const del = h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', title: 'Delete', onClick: async e => { e.stopPropagation(); if (await confirmDialog('Delete this row?')) { rows.splice(index, 1); onDataChange(); rebuildList(); } } }, '✕');
  if (index === 0) up.disabled = true;
  if (index === rows.length - 1) dn.disabled = true;
  actions.append(up, dn, del);
  header.appendChild(actions);
  header.appendChild(h('span', { className: 'ed-item-chevron' }, CHEV_DN));

  header.addEventListener('click', () => card.classList.toggle('open'));
  card.appendChild(header);

  const body = h('div', { className: 'ed-item-body' });
  body.appendChild(bilingualField('Label', row.label, v => { row.label = v; onDataChange(); header.querySelector('.ed-item-title').textContent = loc(v, 'en') || '(untitled)'; }));
  body.appendChild(bilingualField('Value', row.value, v => { row.value = v; onDataChange(); }));

  card.appendChild(body);
  return card;
}

function renderInfoEditor(section, onDataChange) {
  const wrap = h('div');
  const rows = section.rows || [];

  function rebuildList() {
    wrap.innerHTML = '';
    const list = h('div', { className: 'ed-items-list' });
    rows.forEach((row, i) => list.appendChild(renderInfoCard(row, i, rows, onDataChange, rebuildList)));
    wrap.appendChild(list);
    wrap.appendChild(h('button', { className: 'ed-btn', style: 'margin-top:10px', onClick: () => {
      rows.push({ label: { en: '', de: '' }, value: { en: '', de: '' } });
      section.rows = rows;
      onDataChange();
      rebuildList();
    } }, '+ Add Row'));
  }

  rebuildList();
  return wrap;
}

function renderHighlights(highlights, onDataChange, rebuildParent) {
  const wrap = h('div', { className: 'ed-field-group' });
  wrap.appendChild(h('span', { className: 'ed-field-label' }, 'Highlights / Bullet Points'));
  const list = h('div', { className: 'ed-highlights-list' });

  function rebuildHL() {
    list.innerHTML = '';
    highlights.forEach((hl, i) => {
      const row = h('div', { className: 'ed-highlight-row' });
      const inputs = h('div', { className: 'ed-highlight-inputs' });
      const shared = !isLocalized(hl);

      if (shared) {
        inputs.appendChild(inputField('', typeof hl === 'string' ? hl : '', v => { highlights[i] = v; onDataChange(); }));
      } else {
        inputs.appendChild(inputField('EN', hl.en || '', v => { highlights[i].en = v; onDataChange(); }));
        inputs.appendChild(inputField('DE', hl.de || '', v => { highlights[i].de = v; onDataChange(); }));
      }
      row.appendChild(inputs);
      row.appendChild(h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger ed-highlight-remove', onClick: () => { highlights.splice(i, 1); onDataChange(); rebuildHL(); } }, '✕'));
      list.appendChild(row);
    });
    list.appendChild(h('button', { className: 'ed-btn', style: 'margin-top:4px', onClick: () => {
      highlights.push({ en: '', de: '' });
      onDataChange();
      rebuildHL();
    } }, '+ Add Bullet'));
  }

  rebuildHL();
  wrap.appendChild(list);
  return wrap;
}

function renderEntryCard(item, index, items, onDataChange, rebuildList) {
  const card = h('div', { className: 'ed-item-card' });

  const header = h('div', { className: 'ed-item-header' });
  header.appendChild(h('span', { className: 'ed-item-title' }, loc(item.heading, 'en') || '(untitled)'));

  const actions = h('div', { className: 'ed-item-actions' });
  const up = h('button', { className: 'ed-item-action-btn', title: 'Move up', onClick: e => { e.stopPropagation(); if (index > 0) { items.splice(index - 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_UP);
  const dn = h('button', { className: 'ed-item-action-btn', title: 'Move down', onClick: e => { e.stopPropagation(); if (index < items.length - 1) { items.splice(index + 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_DN);
  const del = h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', title: 'Delete', onClick: async e => { e.stopPropagation(); if (await confirmDialog('Delete this entry?')) { items.splice(index, 1); onDataChange(); rebuildList(); } } }, '✕');
  if (index === 0) up.disabled = true;
  if (index === items.length - 1) dn.disabled = true;
  actions.append(up, dn, del);
  header.appendChild(actions);
  header.appendChild(h('span', { className: 'ed-item-chevron' }, CHEV_DN));

  header.addEventListener('click', () => card.classList.toggle('open'));
  card.appendChild(header);

  const body = h('div', { className: 'ed-item-body' });
  body.appendChild(bilingualField('Heading', item.heading, v => { item.heading = v; onDataChange(); header.querySelector('.ed-item-title').textContent = loc(v, 'en') || '(untitled)'; }));
  body.appendChild(bilingualField('Subheading', item.subheading, v => { item.subheading = v; onDataChange(); }));
  body.appendChild(bilingualField('Info', item.info, v => { item.info = v; onDataChange(); }));
  body.appendChild(bilingualField('Subinfo', item.subinfo, v => { item.subinfo = v; onDataChange(); }));

  if (!item.highlights) item.highlights = [];
  body.appendChild(renderHighlights(item.highlights, onDataChange));

  // Tags
  const tagsGroup = h('div', { className: 'ed-field-group' });
  tagsGroup.appendChild(h('span', { className: 'ed-field-label' }, 'Tags'));
  const tagsInp = h('input', { className: 'ed-tags-input', type: 'text', value: (item.tags || []).join(', '), placeholder: 'Comma-separated tags...' });
  tagsInp.addEventListener('input', () => {
    const val = tagsInp.value.trim();
    item.tags = val ? val.split(',').map(t => t.trim()).filter(Boolean) : [];
    onDataChange();
  });
  tagsGroup.appendChild(tagsInp);
  body.appendChild(tagsGroup);

  card.appendChild(body);
  return card;
}

function renderEntriesEditor(section, onDataChange) {
  const wrap = h('div');
  const items = section.items || [];

  function rebuildList() {
    wrap.innerHTML = '';
    const list = h('div', { className: 'ed-items-list' });
    items.forEach((item, i) => list.appendChild(renderEntryCard(item, i, items, onDataChange, rebuildList)));
    wrap.appendChild(list);
    wrap.appendChild(h('button', { className: 'ed-btn', style: 'margin-top:10px', onClick: () => {
      items.push({ heading: { en: '', de: '' }, subheading: { en: '', de: '' }, info: { en: '', de: '' }, subinfo: { en: '', de: '' }, highlights: [] });
      section.items = items;
      onDataChange();
      rebuildList();
    } }, '+ Add Entry'));
  }

  rebuildList();
  return wrap;
}

function renderPubCard(pub, index, items, onDataChange, rebuildList) {
  const card = h('div', { className: 'ed-item-card' });
  const authorStr = (pub.authors || []).map(a => a.name).join(' & ');
  const header = h('div', { className: 'ed-item-header' });
  header.appendChild(h('span', { className: 'ed-item-title' }, authorStr + ' (' + (pub.year || '') + ')'));

  const actions = h('div', { className: 'ed-item-actions' });
  const up = h('button', { className: 'ed-item-action-btn', title: 'Move up', onClick: e => { e.stopPropagation(); if (index > 0) { items.splice(index - 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_UP);
  const dn = h('button', { className: 'ed-item-action-btn', title: 'Move down', onClick: e => { e.stopPropagation(); if (index < items.length - 1) { items.splice(index + 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_DN);
  const del = h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', title: 'Delete', onClick: async e => { e.stopPropagation(); if (await confirmDialog('Delete this publication?')) { items.splice(index, 1); onDataChange(); rebuildList(); } } }, '✕');
  if (index === 0) up.disabled = true;
  if (index === items.length - 1) dn.disabled = true;
  actions.append(up, dn, del);
  header.appendChild(actions);
  header.appendChild(h('span', { className: 'ed-item-chevron' }, CHEV_DN));
  header.addEventListener('click', () => card.classList.toggle('open'));
  card.appendChild(header);

  const body = h('div', { className: 'ed-item-body' });

  // Authors
  const authGroup = h('div', { className: 'ed-field-group' });
  authGroup.appendChild(h('span', { className: 'ed-field-label' }, 'Authors'));
  if (!pub.authors) pub.authors = [];
  const authList = h('div', { className: 'ed-pub-authors' });

  function rebuildAuthors() {
    authList.innerHTML = '';
    pub.authors.forEach((a, ai) => {
      const row = h('div', { className: 'ed-pub-author-row' });
      const nameInp = h('input', { className: 'ed-input', type: 'text', value: a.name || '', placeholder: 'Author name...' });
      nameInp.addEventListener('input', () => { a.name = nameInp.value; onDataChange(); });
      row.appendChild(nameInp);
      const boldCb = h('input', { type: 'checkbox' });
      boldCb.checked = !!a.bold;
      boldCb.addEventListener('change', () => { a.bold = boldCb.checked; onDataChange(); });
      row.appendChild(h('label', { className: 'ed-pub-bold-toggle' }, boldCb, 'Bold'));
      row.appendChild(h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', onClick: () => { pub.authors.splice(ai, 1); onDataChange(); rebuildAuthors(); } }, '✕'));
      authList.appendChild(row);
    });
    authList.appendChild(h('button', { className: 'ed-btn', onClick: () => { pub.authors.push({ name: '', bold: false }); onDataChange(); rebuildAuthors(); } }, '+ Author'));
  }
  rebuildAuthors();
  authGroup.appendChild(authList);
  body.appendChild(authGroup);

  // Year
  const yearGroup = h('div', { className: 'ed-field-group' });
  yearGroup.appendChild(h('span', { className: 'ed-field-label' }, 'Year'));
  const yearInp = h('input', { className: 'ed-input', type: 'text', value: pub.year || '' });
  yearInp.addEventListener('input', () => { pub.year = yearInp.value; onDataChange(); });
  yearGroup.appendChild(yearInp);
  body.appendChild(yearGroup);

  body.appendChild(bilingualField('Title', pub.title, v => { pub.title = v; onDataChange(); }));
  body.appendChild(bilingualField('Institution', pub.institution, v => { pub.institution = v; onDataChange(); }));

  card.appendChild(body);
  return card;
}

function renderPubEditor(section, onDataChange) {
  const wrap = h('div');
  const items = section.items || [];

  function rebuildList() {
    wrap.innerHTML = '';
    const list = h('div', { className: 'ed-items-list' });
    items.forEach((pub, i) => list.appendChild(renderPubCard(pub, i, items, onDataChange, rebuildList)));
    wrap.appendChild(list);
    wrap.appendChild(h('button', { className: 'ed-btn', style: 'margin-top:10px', onClick: () => {
      items.push({ authors: [{ name: '', bold: true }], year: '', title: { en: '', de: '' }, institution: { en: '', de: '' } });
      section.items = items;
      onDataChange();
      rebuildList();
    } }, '+ Add Publication'));
  }

  rebuildList();
  return wrap;
}

// ── Main Init ──
let isEditorOpen = false;

export function toggleEditor() {
  isEditorOpen = !isEditorOpen;
  const container = document.getElementById('editor-container');
  const cvContainer = document.getElementById('cv-container');
  if (container && cvContainer) {
    container.style.display = isEditorOpen ? 'block' : 'none';
    cvContainer.style.display = isEditorOpen ? 'none' : 'block';
  }
}

export function initEditor({ resumeData, cvData, apiBaseUrl, onSave }) {
  let docs = { resume: JSON.parse(JSON.stringify(resumeData)), cv: JSON.parse(JSON.stringify(cvData)) };
  let activeDoc = 'resume';
  let selectedIdx = 0;
  let dirty = false;

  const container = document.getElementById('editor-container');
  const cvContainer = document.getElementById('cv-container');

  function sections() { return docs[activeDoc].sections; }

  function markDirty() { dirty = true; }

  function buildApiUrl(path) { return new URL(path, apiBaseUrl || window.location.origin); }

  async function save() {
    try {
      const res = await fetch(buildApiUrl('/api/save'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant: activeDoc, data: docs[activeDoc] })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      dirty = false;
      showToast('Saved successfully');
      if (onSave) onSave(activeDoc, docs[activeDoc]);
    } catch (e) { showToast('Save failed: ' + e.message, true); }
  }

  async function switchDoc(doc) {
    if (doc === activeDoc) return;
    if (dirty && !window.confirm('You have unsaved changes. Switch anyway?')) return;
    activeDoc = doc;
    selectedIdx = 0;
    dirty = false;
    renderEditor();
  }

  function renderEditor() {
    container.innerHTML = '';

    const overlay = h('div', { className: 'editor-overlay' });

    // Top bar
    const topbar = h('div', { className: 'ed-topbar' });
    const left = h('div', { className: 'ed-topbar-left' });
    ['resume', 'cv'].forEach(d => {
      const tab = h('button', { className: 'ed-tab' + (d === activeDoc ? ' active' : ''), onClick: () => switchDoc(d) }, d.toUpperCase());
      left.appendChild(tab);
    });
    topbar.appendChild(left);

    const right = h('div', { className: 'ed-topbar-right' });
    right.appendChild(h('button', { className: 'ed-btn ed-btn--save', onClick: save }, 'Save'));
    right.appendChild(h('button', { className: 'ed-btn', onClick: () => {
      if (dirty && !window.confirm('Unsaved changes will be lost. Close editor?')) return;
      toggleEditor();
    } }, 'Close'));
    topbar.appendChild(right);
    overlay.appendChild(topbar);

    // Layout
    const layout = h('div', { className: 'ed-layout' });

    // Sidebar
    const sidebar = h('div', { className: 'ed-sidebar' });
    const sideHeader = h('div', { className: 'ed-sidebar-header' });
    sideHeader.appendChild(h('span', { className: 'ed-sidebar-title' }, 'Sections'));
    
    const addWrap = h('div', { style: 'display:flex; align-items:center; gap: 4px;' });
    const typeSel = h('select', { className: 'ed-input', style: 'padding: 2px 4px; font-size: 0.8rem; width: auto;' });
    typeSel.appendChild(h('option', { value: 'entries' }, 'Entries'));
    typeSel.appendChild(h('option', { value: 'info' }, 'Info'));
    typeSel.appendChild(h('option', { value: 'pub' }, 'Pub'));
    
    addWrap.appendChild(typeSel);
    addWrap.appendChild(h('button', { className: 'ed-btn', onClick: () => {
      const type = typeSel.value;
      const newSec = { id: 'new_' + Date.now(), title: { en: 'New Section', de: 'Neuer Abschnitt' }, open: false, type };
      if (type === 'info') newSec.rows = [];
      else newSec.items = [];
      sections().push(newSec);
      selectedIdx = sections().length - 1;
      markDirty();
      renderEditor();
    } }, '+'));
    sideHeader.appendChild(addWrap);
    sidebar.appendChild(sideHeader);

    const sideList = h('div', { className: 'ed-sidebar-list' });
    sections().forEach((sec, i) => {
      const item = h('div', { className: 'ed-sec-item' + (i === selectedIdx ? ' active' : ''), onClick: () => { selectedIdx = i; renderEditor(); } });

      const arrows = h('div', { className: 'ed-sec-arrows' });
      const upBtn = h('button', { className: 'ed-arrow-btn', onClick: e => { e.stopPropagation(); if (i > 0) { sections().splice(i - 1, 0, sections().splice(i, 1)[0]); selectedIdx = i - 1; markDirty(); renderEditor(); } } }, ARROW_UP);
      const dnBtn = h('button', { className: 'ed-arrow-btn', onClick: e => { e.stopPropagation(); if (i < sections().length - 1) { sections().splice(i + 1, 0, sections().splice(i, 1)[0]); selectedIdx = i + 1; markDirty(); renderEditor(); } } }, ARROW_DN);
      if (i === 0) upBtn.disabled = true;
      if (i === sections().length - 1) dnBtn.disabled = true;
      arrows.append(upBtn, dnBtn);
      item.appendChild(arrows);
      item.appendChild(h('span', { className: 'ed-sec-item-label' }, loc(sec.title, 'en') || sec.id));
      item.appendChild(h('span', { className: 'ed-sec-item-type' }, sec.type));
      sideList.appendChild(item);
    });
    sidebar.appendChild(sideList);
    layout.appendChild(sidebar);

    // Main
    const main = h('div', { className: 'ed-main' });

    if (sections().length === 0 || selectedIdx >= sections().length) {
      main.appendChild(h('div', { className: 'ed-empty' }, 'Select or add a section'));
    } else {
      const sec = sections()[selectedIdx];

      // Section header
      const secHeader = h('div', { className: 'ed-section-header' });
      const headerTop = h('div', { className: 'ed-section-header-top' });
      const meta = h('div', { className: 'ed-section-meta' });
      meta.appendChild(h('span', { className: 'ed-section-type-badge' }, sec.type));

      // ID field
      const idInp = h('input', { className: 'ed-input', type: 'text', value: sec.id, style: 'width:120px;font-size:0.7rem' });
      idInp.addEventListener('input', () => { sec.id = idInp.value; markDirty(); });
      meta.appendChild(idInp);

      // Open default toggle
      const openCb = h('input', { type: 'checkbox' });
      openCb.checked = !!sec.open;
      openCb.addEventListener('change', () => { sec.open = openCb.checked; markDirty(); });
      meta.appendChild(h('label', { className: 'ed-shared-toggle' }, openCb, 'Open by default'));

      headerTop.appendChild(meta);

      // Delete section button
      headerTop.appendChild(h('button', { className: 'ed-btn ed-btn--danger', onClick: async () => {
        if (await confirmDialog('Delete section "' + loc(sec.title, 'en') + '"?')) {
          sections().splice(selectedIdx, 1);
          selectedIdx = Math.min(selectedIdx, sections().length - 1);
          markDirty();
          renderEditor();
        }
      } }, 'Delete Section'));
      secHeader.appendChild(headerTop);

      // Section title
      secHeader.appendChild(bilingualField('Section Title', sec.title, v => { sec.title = v; markDirty(); sideList.children[selectedIdx]?.querySelector('.ed-sec-item-label')?.replaceWith(h('span', { className: 'ed-sec-item-label' }, loc(v, 'en'))); }));

      main.appendChild(secHeader);

      // Type-specific editor
      const onDataChange = () => markDirty();

      if (sec.type === 'info') {
        main.appendChild(renderInfoEditor(sec, onDataChange));
      } else if (sec.type === 'entries') {
        main.appendChild(renderEntriesEditor(sec, onDataChange));
      } else if (sec.type === 'pub') {
        main.appendChild(renderPubEditor(sec, onDataChange));
      }
    }

    layout.appendChild(main);
    overlay.appendChild(layout);
    container.appendChild(overlay);
  }

  renderEditor();
}
