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

function confirmDialog(msg, action = 'Delete') {
  return new Promise(resolve => {
    const ov = document.createElement('dialog');
    ov.className = 'ed-confirm-overlay';
    ov.setAttribute('aria-label', action);
    ov.innerHTML = `<div class="ed-confirm-box"><div class="ed-confirm-msg"></div><div class="ed-confirm-actions"><button class="ed-btn" data-r="0">Cancel</button><button class="ed-btn ed-btn--danger" data-r="1">Delete</button></div></div>`;
    ov.querySelector('.ed-confirm-msg').textContent = msg;
    ov.querySelector('[data-r="1"]').textContent = action;
    document.body.appendChild(ov);
    ov.showModal();
    ov.addEventListener('cancel', event => { event.preventDefault(); ov.close(); ov.remove(); resolve(false); });
    ov.addEventListener('click', e => {
      const r = e.target.dataset.r;
      if (r != null) { ov.close(); ov.remove(); resolve(r === '1'); }
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

function inputField(label, value, onChange, placeholder, multiline = false) {
  const inp = h(multiline ? 'textarea' : 'input', { className: multiline ? 'ed-textarea' : 'ed-input', ...(multiline ? { rows: '3' } : { type: 'text' }), placeholder: placeholder || '' });
  inp.value = value || '';
  inp.addEventListener('input', () => onChange(inp.value));
  const wrap = h('div', { className: 'ed-field-col' });
  const lbl = h('div', { className: 'ed-field-col-label' });
  lbl.innerHTML = label || '&nbsp;';
  wrap.appendChild(lbl);
  wrap.appendChild(inp);
  return wrap;
}

function bilingualField(labelText, value, onChange, control, multiline = false) {
  const shared = !isLocalized(value);
  const group = h('div', { className: 'ed-field-group' });

  function rebuild() {
    group.innerHTML = '';
    const isShared = !isLocalized(currentVal);

    const labelRow = h('div', { className: 'ed-field-heading' });
    labelRow.appendChild(h('span', { className: 'ed-field-label', style: 'margin-bottom:0' }, labelText));
    const cb = h('input', { type: 'checkbox' });
    cb.checked = isShared;
    cb.addEventListener('change', () => {
      if (cb.checked) currentVal = getEn(currentVal);
      else currentVal = { en: typeof currentVal === 'string' ? currentVal : '', de: typeof currentVal === 'string' ? currentVal : '' };
      onChange(currentVal);
      rebuild();
    });
    labelRow.appendChild(h('label', { className: 'ed-shared-toggle', title: 'Use the same text for English and German' }, cb, 'Same text'));
    if (control) labelRow.appendChild(control);
    group.appendChild(labelRow);

    if (isShared) {
      const row = h('div', { className: 'ed-field-row' });
      row.appendChild(inputField('', typeof currentVal === 'string' ? currentVal : '', v => { currentVal = v; onChange(currentVal); }, undefined, multiline));
      group.appendChild(row);
    } else {
      const row = h('div', { className: 'ed-field-row' });
      row.appendChild(inputField('EN', currentVal.en || '', v => { currentVal.en = v; onChange(currentVal); }, undefined, multiline));
      row.appendChild(inputField('DE', currentVal.de || '', v => { currentVal.de = v; onChange(currentVal); }, undefined, multiline));
      group.appendChild(row);
    }
    group.querySelectorAll('input.ed-input, textarea.ed-textarea').forEach((input, index) => input.setAttribute('aria-label', isShared ? labelText : `${labelText} (${index === 0 ? 'English' : 'German'})`));
  }

  let currentVal = value == null ? { en: '', de: '' } : (typeof value === 'string' ? value : { en: value.en || '', de: value.de || '' });
  rebuild();
  return group;
}

function sectionCaption(section) {
  const count = (section.items || section.rows || []).length;
  return `${visibilityLabel(section.visibility)} · ${count} ${section.type === 'info' ? (count === 1 ? 'row' : 'rows') : (count === 1 ? 'entry' : 'entries')}`;
}

function visibilityLabel(value) { return { cv: 'CV', resume: 'Resume', both: 'Both' }[value] || 'Both'; }

function visibilityControl(node, onChange, field) {
  const label = h('label', { className: 'ed-visibility' }, 'Show in ');
  const select = h('select', { className: 'ed-input', 'aria-label': field ? `${field} visibility` : 'Visibility' });
  for (const [value, title] of [['both', 'Both'], ['cv', 'CV'], ['resume', 'Resume']]) {
    select.appendChild(h('option', { value }, title));
  }
  select.value = (field ? node.fieldVisibility?.[field] : node.visibility) || 'both';
  select.addEventListener('change', () => {
    if (field) { node.fieldVisibility ||= {}; node.fieldVisibility[field] = select.value; }
    else node.visibility = select.value;
    onChange();
  });
  label.appendChild(select);
  return label;
}

function contentField(label, node, key, onChange) {
  const group = bilingualField(label, node[key], value => { node[key] = value; onChange(value); }, visibilityControl(node, () => onChange(node[key]), key));
  return group;
}

// ── Editors for each section type ──

function renderInfoCard(row, index, rows, onDataChange, rebuildList) {
  const card = h('div', { className: 'ed-item-card' });

  const header = h('div', { className: 'ed-item-header' });
  header.appendChild(h('button', { className: 'ed-item-title', type: 'button', 'aria-expanded': 'false' }, loc(row.label, 'en') || '(untitled)'));

  const badge = h('span', { className: 'ed-visibility-badge' }, visibilityLabel(row.visibility));
  header.appendChild(badge);
  const actions = h('div', { className: 'ed-item-actions' });
  const up = h('button', { className: 'ed-item-action-btn', title: 'Move up', onClick: e => { e.stopPropagation(); if (index > 0) { rows.splice(index - 1, 0, rows.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_UP);
  const dn = h('button', { className: 'ed-item-action-btn', title: 'Move down', onClick: e => { e.stopPropagation(); if (index < rows.length - 1) { rows.splice(index + 1, 0, rows.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_DN);
  const del = h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', title: 'Delete', onClick: async e => { e.stopPropagation(); if (await confirmDialog('Delete this row?')) { rows.splice(index, 1); onDataChange(); rebuildList(); } } }, '✕');
  if (index === 0) up.disabled = true;
  if (index === rows.length - 1) dn.disabled = true;
  actions.append(up, dn, del);
  header.appendChild(actions);

  header.querySelector('.ed-item-title').addEventListener('click', event => {
    const open = card.classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  card.appendChild(header);

  const body = h('div', { className: 'ed-item-body' });
  body.appendChild(visibilityControl(row, () => { badge.textContent = visibilityLabel(row.visibility); onDataChange(); }));
  body.appendChild(contentField('Label', row, 'label', v => { onDataChange(); header.querySelector('.ed-item-title').textContent = loc(v, 'en') || '(untitled)'; }));
  body.appendChild(contentField('Value', row, 'value', v => { onDataChange(); }));

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
    wrap.appendChild(h('button', {
      className: 'ed-btn', style: 'margin-top:10px', onClick: () => {
        rows.push({ visibility: 'both', label: { en: '', de: '' }, value: { en: '', de: '' } });
        section.rows = rows;
        onDataChange();
        rebuildList();
      }
    }, '+ Add Row'));
  }

  rebuildList();
  return wrap;
}

function renderHighlights(highlights, onDataChange, label = 'Highlights / Bullet Points') {
  const wrap = h('div', { className: 'ed-field-group' });
  function rebuild() {
    wrap.replaceChildren(h('span', { className: 'ed-field-label' }, label));
    highlights.forEach((item, index) => {
      const row = h('div', { className: 'ed-field-group' });
      row.classList.add('ed-bullet');
      row.appendChild(bilingualField(label === 'Tags' ? 'Tag' : `Bullet ${index + 1}`, item.text, value => { item.text = value; onDataChange(); }, visibilityControl(item, onDataChange), label !== 'Tags'));
      row.appendChild(h('button', { className: 'ed-btn ed-btn--danger', onClick: () => { highlights.splice(index, 1); onDataChange(); rebuild(); } }, 'Remove'));
      wrap.appendChild(row);
    });
    wrap.appendChild(h('button', { className: 'ed-btn', onClick: () => { highlights.push({ text: { en: '', de: '' }, visibility: 'both' }); onDataChange(); rebuild(); } }, label === 'Tags' ? '+ Add Tag' : '+ Add Bullet'));
  }
  rebuild();
  return wrap;
}

function renderEntryCard(item, index, items, onDataChange, rebuildList) {
  const card = h('div', { className: 'ed-item-card' });

  const header = h('div', { className: 'ed-item-header' });
  header.appendChild(h('button', { className: 'ed-item-title', type: 'button', 'aria-expanded': 'false' }, loc(item.heading, 'en') || '(untitled)'));

  const badge = h('span', { className: 'ed-visibility-badge' }, visibilityLabel(item.visibility));
  header.appendChild(badge);
  const actions = h('div', { className: 'ed-item-actions' });
  const up = h('button', { className: 'ed-item-action-btn', title: 'Move up', onClick: e => { e.stopPropagation(); if (index > 0) { items.splice(index - 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_UP);
  const dn = h('button', { className: 'ed-item-action-btn', title: 'Move down', onClick: e => { e.stopPropagation(); if (index < items.length - 1) { items.splice(index + 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_DN);
  const del = h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', title: 'Delete', onClick: async e => { e.stopPropagation(); if (await confirmDialog('Delete this entry?')) { items.splice(index, 1); onDataChange(); rebuildList(); } } }, '✕');
  if (index === 0) up.disabled = true;
  if (index === items.length - 1) dn.disabled = true;
  actions.append(up, dn, del);
  header.appendChild(actions);

  header.querySelector('.ed-item-title').addEventListener('click', event => {
    const open = card.classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  card.appendChild(header);

  const body = h('div', { className: 'ed-item-body' });
  body.appendChild(visibilityControl(item, () => { badge.textContent = visibilityLabel(item.visibility); onDataChange(); }));
  body.appendChild(contentField('Heading', item, 'heading', v => { onDataChange(); header.querySelector('.ed-item-title').textContent = loc(v, 'en') || '(untitled)'; }));
  body.appendChild(contentField('Subheading', item, 'subheading', v => { onDataChange(); }));
  body.appendChild(contentField('Info', item, 'info', v => { onDataChange(); }));
  body.appendChild(contentField('Subinfo', item, 'subinfo', v => { onDataChange(); }));

  if (!item.highlights) item.highlights = [];
  body.appendChild(renderHighlights(item.highlights, onDataChange));

  item.tags ||= [];
  body.appendChild(renderHighlights(item.tags, onDataChange, 'Tags'));

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
    wrap.appendChild(h('button', {
      className: 'ed-btn', style: 'margin-top:10px', onClick: () => {
        items.push({ visibility: 'both', heading: { en: '', de: '' }, subheading: { en: '', de: '' }, info: { en: '', de: '' }, subinfo: { en: '', de: '' }, highlights: [] });
        section.items = items;
        onDataChange();
        rebuildList();
      }
    }, '+ Add Entry'));
  }

  rebuildList();
  return wrap;
}

function renderPubCard(pub, index, items, onDataChange, rebuildList) {
  const card = h('div', { className: 'ed-item-card' });
  const authorStr = (pub.authors || []).map(a => a.name).join(' & ');
  const header = h('div', { className: 'ed-item-header' });
  header.appendChild(h('button', { className: 'ed-item-title', type: 'button', 'aria-expanded': 'false' }, authorStr + ' (' + (pub.year || '') + ')'));

  const badge = h('span', { className: 'ed-visibility-badge' }, visibilityLabel(pub.visibility));
  header.appendChild(badge);
  const actions = h('div', { className: 'ed-item-actions' });
  const up = h('button', { className: 'ed-item-action-btn', title: 'Move up', onClick: e => { e.stopPropagation(); if (index > 0) { items.splice(index - 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_UP);
  const dn = h('button', { className: 'ed-item-action-btn', title: 'Move down', onClick: e => { e.stopPropagation(); if (index < items.length - 1) { items.splice(index + 1, 0, items.splice(index, 1)[0]); onDataChange(); rebuildList(); } } }, ARROW_DN);
  const del = h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', title: 'Delete', onClick: async e => { e.stopPropagation(); if (await confirmDialog('Delete this publication?')) { items.splice(index, 1); onDataChange(); rebuildList(); } } }, '✕');
  if (index === 0) up.disabled = true;
  if (index === items.length - 1) dn.disabled = true;
  actions.append(up, dn, del);
  header.appendChild(actions);
  header.querySelector('.ed-item-title').addEventListener('click', event => {
    const open = card.classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  card.appendChild(header);

  const body = h('div', { className: 'ed-item-body' });
  body.appendChild(visibilityControl(pub, () => { badge.textContent = visibilityLabel(pub.visibility); onDataChange(); }));

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
      row.appendChild(visibilityControl(a, onDataChange));
      const boldCb = h('input', { type: 'checkbox' });
      boldCb.checked = !!a.bold;
      boldCb.addEventListener('change', () => { a.bold = boldCb.checked; onDataChange(); });
      row.appendChild(h('label', { className: 'ed-pub-bold-toggle' }, boldCb, 'Bold'));
      row.appendChild(h('button', { className: 'ed-item-action-btn ed-item-action-btn--danger', onClick: () => { pub.authors.splice(ai, 1); onDataChange(); rebuildAuthors(); } }, '✕'));
      authList.appendChild(row);
    });
    authList.appendChild(h('button', { className: 'ed-btn', onClick: () => { pub.authors.push({ name: '', bold: false, visibility: 'both' }); onDataChange(); rebuildAuthors(); } }, '+ Author'));
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
  yearGroup.appendChild(visibilityControl(pub, onDataChange, 'year'));
  body.appendChild(yearGroup);

  body.appendChild(contentField('Title', pub, 'title', v => { onDataChange(); }));
  body.appendChild(contentField('Institution', pub, 'institution', v => { onDataChange(); }));

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
    wrap.appendChild(h('button', {
      className: 'ed-btn', style: 'margin-top:10px', onClick: () => {
        items.push({ visibility: 'both', authors: [{ name: '', bold: true, visibility: 'both' }], year: '', title: { en: '', de: '' }, institution: { en: '', de: '' } });
        section.items = items;
        onDataChange();
        rebuildList();
      }
    }, '+ Add Publication'));
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
  const legalFooter = document.getElementById('legal-footer');
  if (container && cvContainer) {
    container.style.display = isEditorOpen ? 'block' : 'none';
    cvContainer.style.display = isEditorOpen ? 'none' : 'block';
  }
  if (legalFooter) {
    legalFooter.style.display = isEditorOpen ? 'none' : 'flex';
  }
}

export function initEditor({ document: initialDocument, passcodesData, apiBaseUrl, onSave }) {
  isEditorOpen = false;
  let data = structuredClone(initialDocument.data);
  let revision = initialDocument.revision;
  let keys = [];
  let keysLoaded = false;
  let passcodes = JSON.parse(JSON.stringify(passcodesData || []));
  let activeDoc = 'content';
  let selectedIdx = 0;
  let mobileShowDetail = false;
  let dirty = false;
  let editVersion = 0;
  let saving = false;

  const container = document.getElementById('editor-container');
  const cvContainer = document.getElementById('cv-container');

  function sections() { return data.sections; }

  function markDirty() { dirty = true; editVersion++; const button = container.querySelector('.ed-btn--save'); if (activeDoc === 'content' && button) button.textContent = 'Save changes'; }

  function buildApiUrl(path) { return new URL(path, apiBaseUrl || window.location.origin); }

  async function save() {
    if (saving) return;
    saving = true;
    const savedVersion = editVersion;
    try {
      const res = await fetch(buildApiUrl('/api/save'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, revision })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      revision = result.revision;
      dirty = savedVersion !== editVersion;
      showToast('Saved successfully');
      if (onSave) onSave(result.data);
    } catch (e) { showToast('Save failed: ' + e.message, true); }
    finally { saving = false; const button = container.querySelector('.ed-btn--save'); if (activeDoc === 'content' && button) button.textContent = dirty ? 'Save changes' : 'Saved'; }
  }

  async function switchDoc(doc) {
    if (doc === activeDoc) return;
    activeDoc = doc;
    selectedIdx = 0;
    mobileShowDetail = false;
    renderEditor();
  }

  // ── Passcode CRUD helpers ──

  async function addPasscode(code, expires) {
    try {
      const res = await fetch(buildApiUrl('/api/passcodes'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, expires })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      passcodes = result.passcodes;
      showToast('Passcode added');
      renderEditor();
    } catch (e) { showToast('Failed to add: ' + e.message, true); }
  }

  async function updatePasscode(index, code, expires) {
    try {
      const res = await fetch(buildApiUrl(`/api/passcodes/${index}`), {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, expires })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      passcodes = result.passcodes;
      showToast('Passcode updated');
    } catch (e) { showToast('Failed to update: ' + e.message, true); }
  }

  async function deletePasscode(index) {
    try {
      const res = await fetch(buildApiUrl(`/api/passcodes/${index}`), {
        method: 'DELETE', credentials: 'include'
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      passcodes = result.passcodes;
      showToast('Passcode deleted');
      renderEditor();
    } catch (e) { showToast('Failed to delete: ' + e.message, true); }
  }

  function renderPasscodeCard(entry, index) {
    const card = h('div', { className: 'ed-item-card' });

    const header = h('div', { className: 'ed-item-header' });
    const isExpired = new Date() > new Date(entry.expires);
    const statusBadge = h('span', {
      className: 'ed-pc-status ' + (isExpired ? 'ed-pc-status--expired' : 'ed-pc-status--active')
    }, isExpired ? 'Expired' : 'Active');
    const titleWrap = h('div', { style: 'display:flex;align-items:center;gap:10px;flex:1;min-width:0' });
    titleWrap.appendChild(h('button', { className: 'ed-item-title', type: 'button', 'aria-expanded': 'false' }, entry.code || '(empty)'));
    titleWrap.appendChild(statusBadge);
    header.appendChild(titleWrap);

    const actions = h('div', { className: 'ed-item-actions' });
    const del = h('button', {
      className: 'ed-item-action-btn ed-item-action-btn--danger', title: 'Delete', onClick: async e => {
        e.stopPropagation();
        if (await confirmDialog('Delete passcode "' + entry.code + '"?')) {
          await deletePasscode(index);
        }
      }
    }, '✕');
    actions.appendChild(del);
    header.appendChild(actions);

    header.querySelector('.ed-item-title').addEventListener('click', event => {
    const open = card.classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
    card.appendChild(header);

    const body = h('div', { className: 'ed-item-body' });

    // Code field
    const codeGroup = h('div', { className: 'ed-field-group' });
    codeGroup.appendChild(h('span', { className: 'ed-field-label' }, 'Passcode'));
    const codeInp = h('input', { className: 'ed-input', type: 'text', value: entry.code || '' });
    let codeDebounce = null;
    codeInp.addEventListener('input', () => {
      entry.code = codeInp.value;
      header.querySelector('.ed-item-title').textContent = entry.code || '(empty)';
      clearTimeout(codeDebounce);
      codeDebounce = setTimeout(() => {
        if (entry.code && entry.expires) updatePasscode(index, entry.code, entry.expires);
      }, 800);
    });
    codeGroup.appendChild(codeInp);
    body.appendChild(codeGroup);

    // Expires field
    const expGroup = h('div', { className: 'ed-field-group' });
    expGroup.appendChild(h('span', { className: 'ed-field-label' }, 'Expires'));
    const expInp = h('input', { className: 'ed-input', type: 'date', value: entry.expires || '' });
    expInp.addEventListener('change', () => {
      entry.expires = expInp.value;
      const nowExpired = new Date() > new Date(entry.expires);
      statusBadge.className = 'ed-pc-status ' + (nowExpired ? 'ed-pc-status--expired' : 'ed-pc-status--active');
      statusBadge.textContent = nowExpired ? 'Expired' : 'Active';
      if (entry.code && entry.expires) updatePasscode(index, entry.code, entry.expires);
    });
    expGroup.appendChild(expInp);
    body.appendChild(expGroup);

    card.appendChild(body);
    return card;
  }

  function renderPasscodesEditor() {
    const wrap = h('div', { className: 'ed-settings-page' });

    const heading = h('div', { className: 'ed-section-header' });
    heading.appendChild(h('h1', {}, 'Passcodes'));
    heading.appendChild(h('div', { style: 'color:var(--t3);font-size:0.82rem;margin-bottom:24px' }, 'Changes are saved automatically to the server.'));
    wrap.appendChild(heading);

    const list = h('div', { className: 'ed-items-list' });
    passcodes.forEach((entry, i) => list.appendChild(renderPasscodeCard(entry, i)));
    wrap.appendChild(list);

    wrap.appendChild(h('button', {
      className: 'ed-btn', style: 'margin-top:16px', onClick: () => {
        const tomorrow = new Date();
        tomorrow.setFullYear(tomorrow.getFullYear() + 1);
        const defaultExpiry = tomorrow.toISOString().split('T')[0];
        addPasscode('NEW_CODE', defaultExpiry);
      }
    }, '+ Add Passcode'));

    return wrap;
  }

  async function keyRequest(method = 'GET', id = '', name) {
    const response = await fetch(buildApiUrl('/api/keys' + (id ? `/${id}` : '')), {
      method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ name }) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    keys = result.keys;
    keysLoaded = true;
    return result;
  }

  function renderApiKeys() {
    const wrap = h('div', { className: 'ed-settings-page' });
    wrap.appendChild(h('header', { className: 'ed-page-heading' }, h('h1', {}, 'API Keys'),
      h('p', {}, 'Connect your AI tools to your CV and resume. Each key can read and edit all content.')));
    const createPanel = h('section', { className: 'ed-panel' }, h('h2', {}, 'Create a key'),
      h('p', { className: 'ed-help' }, 'Give each connection its own name so you can revoke it later.'));
    const name = h('input', { id: 'ed-key-name', className: 'ed-input', placeholder: 'e.g. Web terminal', maxlength: '100', required: '' });
    const form = h('form', { className: 'ed-key-form' });
    const secret = h('div', { className: 'ed-key-secret', role: 'status' });
    secret.hidden = true;
    const create = h('button', { className: 'ed-btn ed-btn--save', type: 'submit' }, 'Create key');
    form.append(h('label', { htmlFor: 'ed-key-name', className: 'ed-field-label' }, 'Key name'), h('div', { className: 'ed-key-form-row' }, name, create));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      create.disabled = true;
      create.textContent = 'Creating…';
      try {
        const result = await keyRequest('POST', '', name.value.trim());
        name.value = '';
        secret.hidden = false;
        secret.replaceChildren(h('h3', {}, 'Your key is ready'), h('p', { className: 'ed-help' }, 'Copy it now. You will not be able to view it again.'), copyField('New API key', result.key));
        renderKeys();
      } catch (error) { showToast(error.message, true); }
      finally { create.disabled = false; create.textContent = 'Create key'; }
    });
    createPanel.append(form, secret);
    wrap.appendChild(createPanel);
    const count = h('span', { className: 'ed-visibility-badge' });
    const list = h('div', { className: 'ed-key-list', 'aria-live': 'polite' }, h('p', { className: 'ed-help' }, 'Loading keys…'));
    const keysPanel = h('section', { className: 'ed-panel' }, h('div', { className: 'ed-panel-heading' }, h('h2', {}, 'Active keys'), count), list);
    function renderKeys() {
      count.textContent = String(keys.length);
      list.replaceChildren();
      if (!keys.length) list.appendChild(h('p', { className: 'ed-help' }, 'No API keys yet. Create one to connect your first tool.'));
      keys.forEach(key => {
        const revoke = h('button', { className: 'ed-btn ed-btn--danger', onClick: async () => {
          if (!await confirmDialog(`Revoke “${key.name}”? Its connection will stop working immediately.`, 'Revoke key')) return;
          revoke.disabled = true;
          try { await keyRequest('DELETE', key.id); renderKeys(); }
          catch (error) { showToast(error.message, true); revoke.disabled = false; }
        } }, 'Revoke');
        list.appendChild(h('div', { className: 'ed-key-row' }, h('div', { className: 'ed-key-info' }, h('strong', {}, key.name),
          h('span', { className: 'ed-help' }, 'Created ' + new Date(key.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))), revoke));
      });
    }
    if (!keysLoaded) keyRequest().then(renderKeys).catch(error => {
      list.replaceChildren(h('p', { role: 'alert' }, error.message), h('button', { className: 'ed-btn', onClick: () => renderEditor() }, 'Retry'));
    });
    else renderKeys();
    wrap.appendChild(keysPanel);
    wrap.appendChild(h('section', { className: 'ed-panel' }, h('h2', {}, 'Connect an MCP client'),
      h('p', { className: 'ed-help' }, 'Choose Streamable HTTP in your client and use the endpoint below.'),
      copyField('Server URL', String(buildApiUrl('/api/mcp'))),
      h('p', { className: 'ed-help' }, 'Authorization header'), h('code', { className: 'ed-code' }, 'Bearer YOUR_API_KEY')));
    return wrap;
  }

  function copyField(label, value) {
    const input = h('input', { className: 'ed-input ed-code', readonly: '', value, 'aria-label': label });
    input.addEventListener('click', () => input.select());
    const copy = h('button', { className: 'ed-btn', type: 'button', 'aria-label': `Copy ${label}`, onClick: async () => {
      try { await navigator.clipboard.writeText(value); showToast(`${label} copied`); }
      catch { input.select(); showToast('Select and copy the highlighted text.', true); }
    } }, 'Copy');
    return h('div', { className: 'ed-copy-field' }, input, copy);
  }

  function renderEditor() {
    container.innerHTML = '';

    const overlay = h('div', { className: 'editor-overlay' });

    // Top bar
    const topbar = h('div', { className: 'ed-topbar' });
    const left = h('div', { className: 'ed-topbar-left' });
    ['content', 'passcodes', 'api-keys'].forEach(d => {
      const label = { content: 'Content', passcodes: 'Passcodes', 'api-keys': 'API Keys' }[d];
      const tab = h('button', { className: 'ed-tab' + (d === activeDoc ? ' active' : ''), onClick: () => switchDoc(d) }, label);
      left.appendChild(tab);
    });
    topbar.appendChild(left);

    const right = h('div', { className: 'ed-topbar-right' });
    if (activeDoc === 'content') {
      right.appendChild(h('button', { className: 'ed-btn ed-btn--save', onClick: save }, dirty ? 'Save changes' : 'Save'));
      right.appendChild(h('button', { className: 'ed-btn', onClick: async () => {
        if (saving || (dirty && !window.confirm('Discard unsaved changes and reload?'))) return;
        try {
          const response = await fetch(buildApiUrl('/api/data'), { credentials: 'include' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          data = result.data; revision = result.revision; dirty = false; selectedIdx = 0;
          renderEditor();
          if (onSave) onSave(structuredClone(data));
        } catch (error) { showToast(error.message, true); }
      } }, 'Reload'));

    }
    right.appendChild(h('button', {
      className: 'ed-btn', onClick: () => {
        if (dirty && !window.confirm('Close with unsaved changes? Your edits remain until the page is reloaded.')) return;
        toggleEditor();
      }
    }, 'Close'));
    topbar.appendChild(right);
    overlay.appendChild(topbar);

    // Layout
    const layout = h('div', { className: 'ed-layout' + (mobileShowDetail ? ' show-detail' : '') });

    // Passcodes mode: no sidebar, just main content
    if (activeDoc === 'passcodes' || activeDoc === 'api-keys') {
      const main = h('div', { className: 'ed-main', style: 'transform:none;position:relative;' });
      main.appendChild(activeDoc === 'api-keys' ? renderApiKeys() : renderPasscodesEditor());
      layout.appendChild(main);
      overlay.appendChild(layout);
      container.appendChild(overlay);
      return;
    }

    // Sidebar
    const sidebar = h('div', { className: 'ed-sidebar' });
    const sideHeader = h('div', { className: 'ed-sidebar-header' });
    sideHeader.appendChild(h('span', { className: 'ed-sidebar-title' }, 'Sections'));

    const addWrap = h('div', { style: 'display:flex; align-items:center; gap: 4px;' });
    const typeSel = h('select', { className: 'ed-select-add', 'aria-label': 'New section type' });
    typeSel.appendChild(h('option', { value: 'entries' }, 'Entries'));
    typeSel.appendChild(h('option', { value: 'info' }, 'Info'));
    typeSel.appendChild(h('option', { value: 'pub' }, 'Pub'));

    addWrap.appendChild(typeSel);
    addWrap.appendChild(h('button', {
      className: 'ed-btn', onClick: () => {
        const type = typeSel.value;
        const newSec = { visibility: 'both', id: 'new_' + Date.now(), title: { en: 'New Section', de: 'Neuer Abschnitt' }, open: false, type };
        if (type === 'info') newSec.rows = [];
        else newSec.items = [];
        sections().push(newSec);
        selectedIdx = sections().length - 1;
        mobileShowDetail = true;
        markDirty();
        renderEditor();
      }
    }, '+'));
    sideHeader.appendChild(addWrap);
    sidebar.appendChild(sideHeader);
    sidebar.appendChild(h('p', { className: 'ed-sidebar-help' }, 'One list for your CV and resume.'));

    const sideList = h('div', { className: 'ed-sidebar-list' });
    sections().forEach((sec, i) => {
      const item = h('div', { className: 'ed-sec-item' + (i === selectedIdx ? ' active' : '') });

      const arrows = h('div', { className: 'ed-sec-arrows' });
      const upBtn = h('button', { className: 'ed-arrow-btn', 'aria-label': 'Move section up', onClick: e => { e.stopPropagation(); if (i > 0) { sections().splice(i - 1, 0, sections().splice(i, 1)[0]); selectedIdx = i - 1; markDirty(); renderEditor(); } } }, ARROW_UP);
      const dnBtn = h('button', { className: 'ed-arrow-btn', 'aria-label': 'Move section down', onClick: e => { e.stopPropagation(); if (i < sections().length - 1) { sections().splice(i + 1, 0, sections().splice(i, 1)[0]); selectedIdx = i + 1; markDirty(); renderEditor(); } } }, ARROW_DN);
      if (i === 0) upBtn.disabled = true;
      if (i === sections().length - 1) dnBtn.disabled = true;
      arrows.append(upBtn, dnBtn);
      item.appendChild(arrows);
      const select = h('button', { className: 'ed-section-select', 'aria-current': i === selectedIdx ? 'true' : 'false', onClick: () => { selectedIdx = i; mobileShowDetail = true; renderEditor(); } },
        h('span', { className: 'ed-sec-item-label' }, loc(sec.title, 'en') || sec.id),
        h('span', { className: 'ed-section-caption' }, sectionCaption(sec)));
      item.appendChild(select);
      sideList.appendChild(item);
    });
    sidebar.appendChild(sideList);
    layout.appendChild(sidebar);

    // Main
    const scrollArea = h('div', { className: 'ed-main' });
    const main = h('div', { className: 'ed-content-page' });
    scrollArea.appendChild(main);

    if (sections().length === 0 || selectedIdx >= sections().length) {
      main.appendChild(h('div', { className: 'ed-empty' }, 'Select or add a section'));
    } else {
      const sec = sections()[selectedIdx];

      // Section header
      const secHeader = h('div', { className: 'ed-section-header' });

      const backBtn = h('button', { className: 'ed-mobile-back-btn', onClick: () => { mobileShowDetail = false; renderEditor(); } });
      backBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg> Back to Sections';
      secHeader.appendChild(backBtn);

      const headerTop = h('div', { className: 'ed-section-header-top' });
      const meta = h('div', { className: 'ed-section-meta' });

      const sectionTitle = h('h1', {}, loc(sec.title, 'en') || 'Untitled section');
      secHeader.appendChild(sectionTitle);
      secHeader.appendChild(h('p', { className: 'ed-help' }, 'Choose where this section appears. Its visibility also applies to every item inside.'));

      // ID field
      const idWrap = h('div', { style: 'display:flex;align-items:center;gap:6px;' });
      idWrap.appendChild(h('span', { className: 'ed-field-col-label', style: 'margin-bottom:0' }, 'ID'));
      const idInp = h('input', { className: 'ed-input', type: 'text', value: sec.id, style: 'width:120px;font-size:0.7rem;padding:6px 10px;' });
      idInp.addEventListener('input', () => { sec.id = idInp.value; markDirty(); });
      idWrap.appendChild(idInp);
      const advanced = h('details', { className: 'ed-section-advanced' }, h('summary', {}, 'Section identifier'), idWrap);
      secHeader.appendChild(advanced);
      meta.appendChild(visibilityControl(sec, () => { markDirty(); renderEditor(); }));

      // Open default toggle
      const openCb = h('input', { type: 'checkbox' });
      openCb.checked = !!sec.open;
      openCb.addEventListener('change', () => { sec.open = openCb.checked; markDirty(); });
      meta.appendChild(h('label', { className: 'ed-shared-toggle' }, openCb, 'Open by default'));

      headerTop.appendChild(meta);

      // Delete section button
      headerTop.appendChild(h('button', {
        className: 'ed-btn ed-btn--danger', onClick: async () => {
          if (await confirmDialog('Delete section "' + loc(sec.title, 'en') + '"?')) {
            sections().splice(selectedIdx, 1);
            selectedIdx = Math.min(selectedIdx, sections().length - 1);
            markDirty();
            renderEditor();
          }
        }
      }, 'Delete Section'));
      secHeader.appendChild(headerTop);

      // Section title
      secHeader.appendChild(contentField('Section Title', sec, 'title', v => { markDirty(); sectionTitle.textContent = loc(v, 'en') || 'Untitled section'; sideList.children[selectedIdx]?.querySelector('.ed-sec-item-label')?.replaceWith(h('span', { className: 'ed-sec-item-label' }, loc(v, 'en'))); }));

      main.appendChild(secHeader);

      // Type-specific editor
      const onDataChange = () => {
        markDirty();
        sideList.children[selectedIdx].querySelector('.ed-section-caption').textContent = sectionCaption(sec);
      };

      if (sec.type === 'info') {
        main.appendChild(renderInfoEditor(sec, onDataChange));
      } else if (sec.type === 'entries') {
        main.appendChild(renderEntriesEditor(sec, onDataChange));
      } else if (sec.type === 'pub') {
        main.appendChild(renderPubEditor(sec, onDataChange));
      }
    }

    layout.appendChild(scrollArea);
    overlay.appendChild(layout);
    container.appendChild(overlay);
  }

  renderEditor();
}
