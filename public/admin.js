let adminPass = prompt("Admin Şifresini Giriniz:");
if (!adminPass) document.body.innerHTML = '<h1>Giriş Reddedildi</h1>';

const $ = id => document.getElementById(id);
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let ws;
let users = [];

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.addEventListener('message', evt => {
    try {
      const d = JSON.parse(evt.data);
      if (d.type === 'refresh_users') fetchUsers();
      if (d.type === 'all_stats') updateLiveStats(d.data);
    } catch (_) {}
  });
  ws.addEventListener('close', () => setTimeout(connectWS, 3000));
}

async function fetchUsers() {
  try {
    const res = await fetch('/api/admin/users', { headers: { 'x-admin-password': adminPass } });
    if(res.status === 401) { alert("Şifre Yanlış!"); document.body.innerHTML = '<h1>Yetkisiz!</h1>'; return; }
    users = await res.json();
    renderUsers();
    fetchLicenses();
  } catch(e) {}
}

function fetchLicenses() {
  try {
    fetch('/api/admin/licenses', { headers: { 'x-admin-password': adminPass } })
      .then(res => res.json())
      .then(lics => {
        $('licenseList').innerHTML = lics.map(l => `<div><code>${l.code}</code> (${l.durationDays || 30} Gün) - ${l.used ? `Kullanıldı (@${l.usedBy})` : 'Boşta'}</div>`).join('');
      });
  } catch(e) {}
}

function updateLiveStats(statsData) {
  for (const s of statsData) {
    const uIndex = users.findIndex(u => u.login === s.login);
    if (uIndex !== -1) {
      users[uIndex].isRunning = s.isRunning;
      users[uIndex].stats = s.stats;
    }
  }
  renderUsers();
}

function formatUptime(startedAt) {
  if(!startedAt) return '—';
  const d = Date.now() - new Date(startedAt).getTime();
  const h = String(Math.floor(d / 3600000)).padStart(2,'0');
  const m = String(Math.floor((d % 3600000) / 60000)).padStart(2,'0');
  return `${h}:${m}`;
}

function renderUsers() {
  const grid = $('usersGrid');
  grid.innerHTML = '';
  if (users.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted); grid-column: 1/-1; text-align:center; padding: 40px;">Henüz kayıtlı müşteri yok.</div>';
    return;
  }
  for (const u of users) {
    const s = u.stats || {};
    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = `
      <div class="uc-header">
        <img class="uc-avatar" src="${esc(u.profile_image_url) || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22%23333%22/></svg>'}" />
        <div class="uc-info">
          <div class="uc-name">${esc(u.display_name)}</div>
          <div class="uc-login">@${esc(u.login)}</div>
        </div>
        <div class="uc-status ${u.isRunning ? 'online' : ''}">${u.isRunning ? 'Aktif' : 'Durdu'}</div>
      </div>
      
      <div class="uc-stats">
        <div class="uc-stat-col">
          <span>Kanal</span>
          <span class="uc-stat-val">${s.currentChannel ? esc(s.currentChannel) : '—'}</span>
        </div>
        <div class="uc-stat-col">
          <span>Drop Toplamı</span>
          <span class="uc-stat-val">${s.claimedCount || 0}</span>
        </div>
        <div class="uc-stat-col">
          <span>Süre</span>
          <span class="uc-stat-val">${formatUptime(s.startedAt)}</span>
        </div>
      </div>

      <div class="uc-progress">
        <div>Drop: ${s.dropName ? esc(s.dropName) : 'Yok'}</div>
        <div class="uc-progress-bar">
          <div class="uc-progress-fill" style="width: ${s.dropProgress || 0}%"></div>
        </div>
      </div>

      <div class="uc-actions" style="margin-top: 15px;">
        ${u.isRunning 
          ? `<button class="btn-stop" onclick="stopUser('${u.login}')">⏹ Durdur</button>`
          : `<button class="btn-play" onclick="startUser('${u.login}')">▶ Başlat</button>`
        }
        <button class="btn-del" onclick="deleteUser('${u.login}')">🗑 Sil</button>
      </div>
    `;
    grid.appendChild(card);
  }
}

async function startUser(login) { await fetch(`/api/admin/start/${login}`, { method: 'POST', headers: { 'x-admin-password': adminPass } }); }
async function stopUser(login) { await fetch(`/api/admin/stop/${login}`, { method: 'POST', headers: { 'x-admin-password': adminPass } }); }
async function deleteUser(login) {
  if(!confirm(`@${login} tamamen silinecek?`)) return;
  await fetch(`/api/admin/users/${login}`, { method: 'DELETE', headers: { 'x-admin-password': adminPass } });
}

$('btnGenLicense').addEventListener('click', async () => {
  const amount = parseInt($('licenseCount').value) || 1;
  const duration = parseInt($('licenseDuration').value) || 30;
  const res = await fetch('/api/admin/licenses', { 
     method: 'POST', 
     headers: { 'x-admin-password': adminPass, 'Content-Type': 'application/json' },
     body: JSON.stringify({ amount, duration })
  });
  const d = await res.json();
  if(d.ok) {
    const out = $('licenseOutput');
    out.style.display = 'block';
    out.value = d.codes.join('\\n');
    out.select();
    document.execCommand('copy');
    alert(amount + " adet lisans üretildi ve PANOYA KOPYALANDI! Direkt İtemSatış Stoklarına yapıştırabilirsiniz.");
    fetchLicenses();
  }
});

$('btnRestartServer').addEventListener('click', async () => {
  if(!confirm('Sunucuyu yeniden başlat?')) return;
  fetch('/api/admin/restart', { method: 'POST', headers: { 'x-admin-password': adminPass } });
  alert('Yeniden başlatılıyor...');
  setTimeout(()=> location.reload(), 3000);
});

document.addEventListener('DOMContentLoaded', () => {
  if (adminPass) { fetchUsers(); connectWS(); }
});
