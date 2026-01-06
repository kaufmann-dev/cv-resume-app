let lang = 'en';
let theme = 'light';
let resumeData = null;
let currentPasscode = '';

const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

const authContainer = document.getElementById('auth-container');
const cvContainer = document.getElementById('cv-container');
const authError = document.getElementById('auth-error');
const passcodeImg = document.getElementById('passcode-input');

const openState = {};
const expandedState = {};

function localize(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value;
    return value[lang] ?? value.en ?? value.de ?? '';
}

function saveOpen() {
    document.querySelectorAll('details[data-id]').forEach(d => { openState[d.dataset.id] = d.open; });
}

function mkEntry(item) {
    const title = localize(item.title);
    const subtitle = localize(item.subtitle);
    const location = localize(item.location);
    const date = localize(item.date);
    const highlights = (item.highlights || []).map(localize);
    const mobMeta = [date, location].filter(Boolean).join(' · ');

    return `<div class="entry"><div class="e-line"></div><div class="e-body">
    ${mobMeta ? `<div class="e-mob">${mobMeta}</div>` : ''}
    <div class="e-r1"><span class="entry-title">${title}</span><span class="entry-date">${date}</span></div>
    ${(subtitle || location) ? `<div class="e-r2"><span class="entry-subtitle">${subtitle}</span><span class="entry-location">${location}</span></div>` : ''}
    ${highlights.length ? `<ul>${highlights.map(highlight => `<li>${highlight}</li>`).join('')}</ul>` : ''}
    ${item.tags?.length ? `<div class="tags">${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
    ${item.link?.href ? `<a class="proj-link" href="${item.link.href}" target="_blank" rel="noopener">${localize(item.link.label) || 'Open GitHub'}</a>` : ''}
  </div></div>`;
}

function mkSection(section) {
    const ui = resumeData.ui;
    const isOpen = section.id in openState ? openState[section.id] : section.open;
    const expanded = !!expandedState[section.id];

    let body = '';
    if (section.type === 'info') {
        body = `<div class="info-grid">${section.rows.map(row => `<div class="il">${localize(row.label)}</div><div class="iv">${localize(row.value)}</div>`).join('')}</div>`;
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
    const lbl = document.getElementById('theme-lbl');

    if (sun) sun.style.display = darkMode ? '' : 'none';
    if (moon) moon.style.display = darkMode ? 'none' : '';
    if (lbl) lbl.textContent = darkMode ? localize(resumeData.ui.themeLight) : localize(resumeData.ui.themeDark);
}

function render() {
    if (!resumeData) return;

    document.documentElement.lang = lang;
    document.getElementById('dl-lbl').textContent = localize(resumeData.ui.downloadPdf);
    document.getElementById('btn-lang').textContent = lang === 'en' ? 'DE' : 'EN';
    document.getElementById('cv-body').innerHTML = resumeData.sections.map(mkSection).join('');
    applyThemeIcons();
}

async function handleLogin() {
    const passcode = document.getElementById('passcode-input').value;
    try {
        const response = await fetch('http://localhost:3001/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode })
        });

        const result = await response.json();

        if (result.success) {
            resumeData = result.data;
            currentPasscode = passcode;
            authContainer.style.display = 'none';
            cvContainer.style.display = 'block';
            render();
        } else {
            authError.textContent = result.error || 'Login failed';
        }
    } catch (err) {
        authError.textContent = 'Server error. Is the backend running?';
    }
}

// Event Listeners
document.getElementById('login-btn').addEventListener('click', handleLogin);
passcodeImg.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
});

document.getElementById('btn-lang').addEventListener('click', () => {
    saveOpen();
    lang = lang === 'en' ? 'de' : 'en';
    render();
});

document.getElementById('btn-theme').addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    applyThemeIcons();
});

document.getElementById('btn-dl').addEventListener('click', () => {
    window.location.href = `http://localhost:3001/api/download?passcode=${currentPasscode}`;
});

document.getElementById('cv-body').addEventListener('click', e => {
    const btn = e.target.closest('.show-more-btn');
    if (!btn) return;
    const sid = btn.dataset.sec;
    saveOpen();
    expandedState[sid] = !expandedState[sid];
    render();
});

window.addEventListener('beforeprint', () => {
    saveOpen();
    document.querySelectorAll('details[data-id]').forEach(d => d.open = true);
});

window.addEventListener('afterprint', () => {
    document.querySelectorAll('details[data-id]').forEach(d => { d.open = !!openState[d.dataset.id]; });
});
