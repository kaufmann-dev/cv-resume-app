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

function saveOpen() {
    document.querySelectorAll('details[data-id]').forEach(d => { openState[d.dataset.id] = d.open; });
}

function mkEntry(e) {
    const mobMeta = [e.dt, e.loc].filter(Boolean).join(' · ');
    return `<div class="entry"><div class="e-line"></div><div class="e-body">
    ${mobMeta ? `<div class="e-mob">${mobMeta}</div>` : ''}
    <div class="e-r1"><span class="org">${e.org}</span><span class="dt">${e.dt || ''}</span></div>
    ${(e.role || e.loc) ? `<div class="e-r2"><span class="role">${e.role || ''}</span><span class="loc">${e.loc || ''}</span></div>` : ''}
    ${e.bullets?.length ? `<ul>${e.bullets.map(b => `<li>${b}</li>`).join('')}</ul>` : ''}
    ${e.tags?.length ? `<div class="tags">${e.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
    ${e.url ? `<a class="proj-link" href="${e.url}" target="_blank" rel="noopener">${e.urlLabel || 'Open GitHub'}</a>` : ''}
  </div></div>`;
}

function mkSection(s) {
    const d = resumeData[lang];
    const isOpen = s.id in openState ? openState[s.id] : s.open;
    const expanded = !!expandedState[s.id];

    let body = '';
    if (s.type === 'info') {
        body = `<div class="info-grid">${s.rows.map(([l, v]) => `<div class="il">${l}</div><div class="iv">${v}</div>`).join('')}</div>`;
    } else if (s.type === 'entries') {
        const cut = s.showMoreAt;
        if (cut && !expanded) {
            body = s.entries.slice(0, cut).map(mkEntry).join('');
            body += `<div class="show-more-wrap"><button class="show-more-btn" data-sec="${s.id}">${d.showMore} (${s.entries.length - cut})</button></div>`;
        } else if (cut && expanded) {
            body = s.entries.map(mkEntry).join('');
            body += `<div class="show-more-wrap"><button class="show-more-btn" data-sec="${s.id}">${d.showLess}</button></div>`;
        } else {
            body = s.entries.map(mkEntry).join('');
        }
    } else if (s.type === 'pub') {
        body = `<div class="pub">${s.content}</div>`;
    }

    return `<details data-id="${s.id}"${isOpen ? ' open' : ''}><summary><h2>${s.title}</h2>${CHEV}</summary><div class="sec-body">${body}</div></details>`;
}

function applyThemeIcons() {
    const d = theme === 'dark';
    const sun = document.getElementById('ico-sun');
    const moon = document.getElementById('ico-moon');
    const lbl = document.getElementById('theme-lbl');

    if (sun) sun.style.display = d ? '' : 'none';
    if (moon) moon.style.display = d ? 'none' : '';
    if (lbl) lbl.textContent = d ? resumeData[lang].themeLight : resumeData[lang].themeDark;
}

function render() {
    if (!resumeData) return;

    const d = resumeData[lang];
    document.documentElement.lang = lang;
    document.getElementById('dl-lbl').textContent = d.dl;
    document.getElementById('btn-lang').textContent = lang === 'en' ? 'DE' : 'EN';
    document.getElementById('cv-body').innerHTML = d.sections.map(mkSection).join('');
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
document.getElementById('passcode-input').addEventListener('keypress', (e) => {
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
