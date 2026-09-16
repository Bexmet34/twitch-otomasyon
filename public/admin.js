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
        // En yeniler üstte olsun
        lics.reverse();
        $('licenseList').innerHTML = lics.map(l => {
          const bg = l.used ? 'rgba(255,50,50,0.1)' : 'rgba(0,255,128,0.1)';
          const border = l.used ? 'rgba(255,50,50,0.3)' : 'rgba(0,255,128,0.3)';
          const color = l.used ? '#ff5555' : '#00ff80';
          
          return `
          <div style="background:${bg}; border:1px solid ${border}; border-radius:8px; padding:12px; text-align:center;">
             <div style="font-family:monospace; font-size:1.1rem; color:${color}; font-weight:bold; letter-spacing:1px; margin-bottom:5px;">${l.code}</div>
             <div style="font-size:0.85rem; color:#ccc;">${l.durationDays || 30} Günlük</div>
             <div style="font-size:0.8rem; color:#888; margin-top:5px;">${l.used ? `Kullanıldı (@${l.usedBy})` : 'Boşta (Satışa Hazır)'}</div>
          </div>
          `;
        }).join('');
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
async function startBot(login) { 
  await fetch(`/api/admin/start/${login}`, { method: 'POST', headers: { 'x-admin-password': adminPass } }); 
  fetchUsers();
}

async function stopBot(login) { 
  await fetch(`/api/admin/stop/${login}`, { method: 'POST', headers: { 'x-admin-password': adminPass } }); 
  fetchUsers();
}

async function deleteUser(login) {
  if(!confirm(`@${login} tamamen silinecek?`)) return;
  await fetch(`/api/admin/users/${login}`, { method: 'DELETE', headers: { 'x-admin-password': adminPass } });
  fetchUsers();
}

$('btnGenLicense').addEventListener('click', async () => {
  const amount = parseInt($('licenseCount').value) || 1;
  const duration = parseInt($('licenseDuration').value) || 30;
  
  $('btnGenLicense').textContent = 'Üretiliyor...';
  
  const res = await fetch('/api/admin/licenses', { 
     method: 'POST', 
     headers: { 'x-admin-password': adminPass, 'Content-Type': 'application/json' },
     body: JSON.stringify({ amount, duration })
  });
  const d = await res.json();
  
  $('btnGenLicense').textContent = '🔑 Toplu Lisans Üret';
  
  if(d.ok) {
     const out = $('licenseOutput');
     out.style.display = 'block';
     out.value = d.codes.join('\n');
     out.select();
     document.execCommand('copy');
     alert(`${d.codes.length} adet kod üretildi ve panoya KOPYALANDI!\n\nİtemSatış e-pin stok alanına CTRL+V yapabilirsiniz.`);
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
