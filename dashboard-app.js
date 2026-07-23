// dashboard-app.js — Kulova hallintapaneelin logiikka.
// Ei enää suoraa Supabase-yhteyttä selaimesta — kaikki kutsut kulkevat
// kulova-backendin /api/auth ja /api/dashboard -endpointtien kautta, joissa
// business_id ratkaistaan aina palvelimella istuntotokenista, ei koskaan
// mistään client-puolen parametrista.

const API = 'https://kulova-backend.vercel.app';
const TOKEN_KEY = 'kulova_dashboard_token';

let currentBusinessId = null;
let currentBusinessName = null;

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Turvallinen kevyt muotoilu botin testivastaukselle: raaka teksti escapetaan
// AINA ensin, ja vasta sen jälkeen lisätään sallitut tagit (**bold**, #otsikot,
// rivinvaihdot). Mallin tuottama teksti ei koskaan pääse läpi sellaisenaan HTML:ksi.
function formatReplyHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  try {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'Yhteysvirhe' } };
  }
}

// ---------- AUTH ----------

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}
function backToEmail() {
  document.getElementById('auth-step-1').style.display = 'block';
  document.getElementById('auth-step-2').style.display = 'none';
  document.getElementById('auth-error').style.display = 'none';
  document.getElementById('auth-pin-error').style.display = 'none';
}

async function sendPin() {
  const email = document.getElementById('auth-email').value.trim().toLowerCase();
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';
  if (!email) {
    errEl.textContent = 'Syötä sähköpostiosoite.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btn-send-pin');
  btn.textContent = 'Lähetetään...';
  btn.disabled = true;

  const { ok, data } = await apiFetch('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'send', email })
  });

  if (ok && data.success) {
    document.getElementById('auth-step-1').style.display = 'none';
    document.getElementById('auth-step-2').style.display = 'block';
    document.getElementById('auth-pin-msg').textContent = 'Syötä 6-numeroinen koodi jonka lähetimme osoitteeseen ' + email;
    document.getElementById('auth-pin').focus();
  } else {
    errEl.textContent = data.error || 'Sähköpostia ei löydy.';
    errEl.style.display = 'block';
  }

  btn.textContent = 'Lähetä koodi →';
  btn.disabled = false;
}

async function verifyPin() {
  const email = document.getElementById('auth-email').value.trim().toLowerCase();
  const code = document.getElementById('auth-pin').value.trim();
  const errEl = document.getElementById('auth-pin-error');
  errEl.style.display = 'none';
  if (!code || code.length !== 6) {
    errEl.textContent = 'Syötä 6-numeroinen koodi.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btn-verify-pin');
  btn.textContent = 'Tarkistetaan...';
  btn.disabled = true;

  const { ok, data } = await apiFetch('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'verify', email, code })
  });

  if (ok && data.success && data.token) {
    setToken(data.token);
    await loadBusinessAndShow(email);
  } else {
    errEl.textContent = data.error || 'Väärä tai vanhentunut koodi.';
    errEl.style.display = 'block';
  }

  btn.textContent = 'Kirjaudu →';
  btn.disabled = false;
}

async function logout() {
  await apiFetch('/api/dashboard?resource=logout', { method: 'DELETE' });
  clearToken();
  currentBusinessId = null;
  currentBusinessName = null;
  showAuthScreen();
}

// ---------- BUSINESS DATA ----------

function populateBusinessUI(biz, totalMessages, todayMessages, fallbackEmail) {
  currentBusinessId = biz.id;
  currentBusinessName = biz.name;

  document.getElementById('sb-bizname').textContent = biz.name || '—';
  document.getElementById('sb-email').textContent = biz.owner_email || fallbackEmail || '—';

  document.getElementById('set-name').value = biz.name || '';
  document.getElementById('set-services').value = biz.services || '';
  document.getElementById('set-hours').value = biz.hours || '';
  document.getElementById('set-website').value = biz.website || '';
  document.getElementById('set-booking').value = biz.booking_url || '';
  document.getElementById('set-botname').value = biz.bot_name || 'Asiakaspalvelu';
  document.getElementById('set-tone').value = biz.bot_tone || 'ystävällinen ja ammattimainen';
  document.getElementById('set-instructions').value = biz.bot_instructions || '';
  document.getElementById('set-digest').checked = !!biz.digest_enabled;
  document.getElementById('set-digest-hour').value = biz.digest_hour || 8;

  document.getElementById('stat-msgs').textContent = totalMessages ?? '—';
  document.getElementById('stat-today').textContent = todayMessages ?? '—';

  const wc = `<script src="${API}/api/widget.js" data-business="${biz.id}"><\/script>`;
  document.getElementById('widget-code-block').textContent = wc;
  document.getElementById('modal-code-block').textContent = wc;
}

async function loadBusinessAndShow(fallbackEmail) {
  const { ok, data } = await apiFetch('/api/dashboard?resource=business');
  if (!ok || !data.business) {
    clearToken();
    showAuthScreen();
    return false;
  }
  showApp();
  populateBusinessUI(data.business, data.totalMessages, data.todayMessages, fallbackEmail);
  await loadConversations();
  return true;
}

// ---------- CONVERSATIONS ----------

async function loadConversations() {
  const { ok, data } = await apiFetch('/api/dashboard?resource=conversations');
  const convs = ok ? (data.conversations || []) : [];
  document.getElementById('stat-convs').textContent = convs.length;
  renderConvList('recent-convs', convs.slice(0, 5));
  renderConvList('all-convs', convs);
}

function renderConvList(containerId, convs) {
  const el = document.getElementById(containerId);
  el.textContent = '';
  if (!convs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Ei vielä keskusteluja. Chat-widgetin kautta tulevat viestit näkyvät täällä.';
    el.appendChild(empty);
    return;
  }
  for (const c of convs) {
    const item = document.createElement('div');
    item.className = 'conv-item';
    item.dataset.convId = c.id;
    item.dataset.convIdentifier = c.customer_identifier || '';
    item.dataset.convTime = c.last_message_at || '';

    const left = document.createElement('div');
    const idLine = document.createElement('div');
    idLine.style.fontSize = '0.875rem';
    idLine.style.marginBottom = '0.2rem';
    idLine.textContent = (c.customer_identifier || '').slice(0, 16) + '...';
    const timeLine = document.createElement('div');
    timeLine.className = 'conv-id';
    timeLine.textContent = c.last_message_at ? new Date(c.last_message_at).toLocaleString('fi-FI') : '';
    left.appendChild(idLine);
    left.appendChild(timeLine);

    const count = document.createElement('span');
    count.className = 'conv-count';
    count.textContent = `${c.message_count} viestiä`;

    item.appendChild(left);
    item.appendChild(count);
    el.appendChild(item);
  }
}

async function loadMessages(convId, identifier, lastTime, clickedEl) {
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('selected'));
  if (clickedEl) clickedEl.classList.add('selected');

  const panel = document.getElementById('messages-panel');
  panel.style.display = 'block';
  document.getElementById('panel-conv-id').textContent = (identifier ? identifier.slice(0, 20) : '') + '...';
  document.getElementById('panel-conv-time').textContent = lastTime ? new Date(lastTime).toLocaleString('fi-FI') : '';

  const list = document.getElementById('messages-list');
  list.textContent = '';
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Ladataan...';
  list.appendChild(loading);

  const { ok, data } = await apiFetch(`/api/dashboard?resource=messages&conversationId=${encodeURIComponent(convId)}`);
  list.textContent = '';

  if (!ok) {
    const err = document.createElement('div');
    err.className = 'empty-state';
    err.textContent = 'Virhe ladatessa viestejä.';
    list.appendChild(err);
    return;
  }

  for (const m of (data.messages || [])) {
    const wrap = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble ' + m.role;
    // XSS-korjaus: asiakkaan viesti on aina vapaata tekstiä, textContent ei
    // koskaan tulkitse sitä HTML:ksi (verrattuna vanhaan innerHTML-templateen).
    bubble.textContent = m.content;
    const time = document.createElement('div');
    time.className = 'msg-time';
    time.style.textAlign = m.role === 'assistant' ? 'right' : 'left';
    time.textContent = new Date(m.created_at).toLocaleTimeString('fi-FI');
    wrap.appendChild(bubble);
    wrap.appendChild(time);
    list.appendChild(wrap);
  }
  list.scrollTop = 9999;
}

// ---------- SETTINGS ----------

async function saveSettings() {
  const payload = {
    name: document.getElementById('set-name').value.trim(),
    services: document.getElementById('set-services').value.trim(),
    hours: document.getElementById('set-hours').value.trim(),
    website: document.getElementById('set-website').value.trim(),
    booking_url: document.getElementById('set-booking').value.trim(),
    bot_name: document.getElementById('set-botname').value.trim(),
    bot_tone: document.getElementById('set-tone').value,
    bot_instructions: document.getElementById('set-instructions').value.trim(),
    digest_enabled: document.getElementById('set-digest').checked,
    digest_hour: parseInt(document.getElementById('set-digest-hour').value, 10)
  };

  const { ok, data } = await apiFetch('/api/dashboard?resource=business', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  if (ok && data.business) {
    currentBusinessName = data.business.name;
    document.getElementById('sb-bizname').textContent = data.business.name;
    const status = document.getElementById('save-status');
    status.style.display = 'inline';
    setTimeout(() => status.style.display = 'none', 2000);
  }
}

// ---------- BILLING PORTAL ----------
// HUOM: /api/portal ottaa yhä businessId:n suoraan pyynnön bodystä eikä ole
// vielä token-suojattu — tunnettu, erikseen raportoitu puute, ei korjattu tässä.

async function openPortal() {
  const status = document.getElementById('portal-status');
  status.style.display = 'inline';
  status.style.color = 'var(--gray-5)';
  status.textContent = 'Avataan...';
  try {
    const r = await fetch(`${API}/api/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: currentBusinessId })
    });
    const data = await r.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      status.textContent = data.error || 'Virhe. Yritä uudelleen.';
      status.style.color = '#e05555';
    }
  } catch (e) {
    status.textContent = 'Yhteysvirhe. Yritä uudelleen.';
    status.style.color = '#e05555';
  }
}

// ---------- TEST CHAT ----------

async function sendTest() {
  const input = document.getElementById('test-input');
  const msg = input.value.trim();
  if (!msg || !currentBusinessId) return;
  input.value = '';

  const chat = document.getElementById('test-chat');
  if (chat.dataset.hasPlaceholder !== 'false') {
    chat.textContent = '';
    chat.dataset.hasPlaceholder = 'false';
  }

  const userBubble = document.createElement('div');
  userBubble.className = 'test-msg-user';
  userBubble.textContent = msg;
  chat.appendChild(userBubble);

  const loading = document.createElement('div');
  loading.className = 'test-msg-loading';
  loading.textContent = 'Botti kirjoittaa...';
  chat.appendChild(loading);
  chat.scrollTop = 9999;

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: currentBusinessId, message: msg, sessionId: 'test-' + currentBusinessId })
    });
    const data = await res.json();
    loading.remove();
    const reply = data.reply || data.message || data.response || 'Virhe vastauksessa.';
    const botBubble = document.createElement('div');
    botBubble.className = 'test-msg-bot';
    // Turvallinen: formatReplyHtml escapetaa raa'an sisällön ennen tagien lisäystä.
    botBubble.innerHTML = formatReplyHtml(reply);
    chat.appendChild(botBubble);
  } catch (e) {
    loading.remove();
    const err = document.createElement('div');
    err.className = 'test-msg-error';
    err.textContent = 'Virhe: ' + e.message;
    chat.appendChild(err);
  }
  chat.scrollTop = 9999;
}

// ---------- MISC UI ----------

function copyToClipboard(text, btn, label) {
  navigator.clipboard.writeText(text);
  btn.textContent = 'Kopioitu!';
  setTimeout(() => { btn.textContent = label; }, 2000);
}

function showTab(tab) {
  ['wp', 'wix', 'muu'].forEach(t => {
    document.getElementById('tab-content-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
}

function showPage(name, clickedEl) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (clickedEl) clickedEl.classList.add('active');
  if (name === 'conversations') loadConversations();
}

// ---------- EVENT WIRING (ei yhtään inline onclick/onkeydown-attribuuttia — CSP) ----------

document.getElementById('btn-send-pin').addEventListener('click', sendPin);
document.getElementById('btn-verify-pin').addEventListener('click', verifyPin);
document.getElementById('btn-back-to-email').addEventListener('click', backToEmail);
document.getElementById('auth-email').addEventListener('keydown', e => { if (e.key === 'Enter') sendPin(); });
document.getElementById('auth-pin').addEventListener('keydown', e => { if (e.key === 'Enter') verifyPin(); });

document.getElementById('btn-logout').addEventListener('click', logout);
document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
document.getElementById('btn-open-portal').addEventListener('click', openPortal);
document.getElementById('btn-send-test').addEventListener('click', sendTest);
document.getElementById('test-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendTest(); });

document.getElementById('btn-copy-widget').addEventListener('click', (e) => {
  copyToClipboard(document.getElementById('widget-code-block').textContent, e.currentTarget, 'Kopioi koodi');
});
document.getElementById('btn-copy-modal').addEventListener('click', (e) => {
  copyToClipboard(document.getElementById('modal-code-block').textContent, e.currentTarget, 'Kopioi koodi');
});
document.getElementById('btn-open-install-modal').addEventListener('click', () => {
  document.getElementById('install-modal').style.display = 'flex';
});
document.getElementById('btn-close-install-modal').addEventListener('click', () => {
  document.getElementById('install-modal').style.display = 'none';
});

document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', () => showPage(el.dataset.page, el));
});
document.querySelectorAll('.tab-btn[data-tab]').forEach(el => {
  el.addEventListener('click', () => showTab(el.dataset.tab));
});

// Delegoitu: keskustelulistan rivit luodaan dynaamisesti.
document.addEventListener('click', (e) => {
  const item = e.target.closest('.conv-item');
  if (!item) return;
  loadMessages(item.dataset.convId, item.dataset.convIdentifier, item.dataset.convTime, item);
});

// ---------- KÄYNNISTYS ----------
// Ei enää automaattikirjautumista URL-parametreista (?email=&bid=) — se olisi
// täsmälleen sama haavoittuvuusluokka jota koko tämä työ korjaa (identiteetti
// client-puolen parametrista ilman palvelinvarmennusta).

(async function init() {
  if (getToken()) {
    const ok = await loadBusinessAndShow();
    if (ok) return;
  }
  showAuthScreen();
})();
