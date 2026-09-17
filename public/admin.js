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
        const catMap = {
           unused7: { title: "🟢 Boşta - 7 Günlük Paketler", list: [] },
           unused30: { title: "🟢 Boşta - 1 Aylık (30 Gün) Paketler", list: [] },
           unused90: { title: "🟢 Boşta - 3 Aylık (90 Gün) Paketler", list: [] },
           used: { title: "🔴 Kullanılmış (Aktif/Pasif) Lisanslar", list: [] }
        };
        
        for (const l of lics) {
           if (l.used) catMap.used.list.push(l);
           else if (l.durationDays === 7) catMap.unused7.list.push(l);
           else if (l.durationDays === 30) catMap.unused30.list.push(l);
           else if (l.durationDays === 90) catMap.unused90.list.push(l);
           else catMap.unused30.list.push(l); // fallback
        }
        
        let html = '';
        for (const key in catMap) {
           const c = catMap[key];
           if (c.list.length === 0) continue;
           
           c.list.reverse(); // Yeniler üstte
           const isUsed = key === 'used';
           
           // Textarea içerisine yazılacak metni hazırla
           const textContent = c.list.map(l => {
               if (isUsed) return `${l.code} (Kullanıldı: @${l.usedBy}) - ${l.durationDays || 30} Günlük`;
               return l.code;
           }).join('\n');
           
           html += `
           <details style="margin-bottom: 15px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
              <summary style="padding: 15px; cursor: pointer; font-weight: 600; font-size: 1.1rem; color: #fff; outline: none; list-style-type: '📂 ';">
                 ${c.title} (${c.list.length} adet)
              </summary>
              <div style="padding: 15px; border-top: 1px solid rgba(255,255,255,0.05);">
                  <textarea readonly onclick="this.select();" style="width:100%; height:180px; background: rgba(0,0,0,0.5); color: ${isUsed ? '#ff5555' : '#00ff80'}; border: 1px dashed rgba(255,255,255,0.2); padding: 10px; font-family: monospace; font-size: 1.05rem; border-radius: 6px; resize: vertical; line-height:1.5;">${textContent}</textarea>
                  <div style="font-size:0.85rem; color:#888; margin-top:5px; text-align:right;">* Kutucuğa tıklayarak tümünü seçebilirsiniz.</div>
              </div>
           </details>
           `;
        }
        
        if (html === '') html = '<div style="color:#aaa;">Henüz hiç lisans üretilmemiş.</div>';
        $('licenseCategories').innerHTML = html;
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

function formatUptime(uptimeMs) {
  if(!uptimeMs || uptimeMs <= 0) return '00:00';
  const h = String(Math.floor(uptimeMs / 3600000)).padStart(2,'0');
  const m = String(Math.floor((uptimeMs % 3600000) / 60000)).padStart(2,'0');
  return `${h}:${m}`;
}

function renderUsers() {
  const grid = $('usersGrid');
  grid.innerHTML = '';
  if (users.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted); grid-column: 1/-1; text-align:center; padding: 40px;">Henüz kayıtlı müşteri yok.</div>';
    return;
  }
  
  grid.innerHTML = users.map(u => {
    const hasBot = u.isRunning;
    let timeRemaining = "Süresiz";
    if (u.expiresAt) {
       const left = u.expiresAt - Date.now();
       if (left <= 0) timeRemaining = '<span style="color:red">SÜRESİ BİTTİ</span>';
       else {
         const d = Math.floor(left / (1000 * 60 * 60 * 24));
         const h = Math.floor((left / (1000 * 60 * 60)) % 24);
         timeRemaining = `<span style="color:var(--accent)">${d} Gün, ${h} Saat Kaldı</span>`;
       }
    }
    
    return `
    <div class="user-card glass">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
         <div class="user-header">
            <img class="avatar" src="${u.profile_image_url || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/13e5fa74-defa-11e9-809c-784f43822e80-profile_image-70x70.png'}" />
            <div>
               <h3 style="margin:0; font-size:1.1rem;">${esc(u.display_name)}</h3>
               <div class="status ${hasBot ? 'status-active' : 'status-inactive'}">${hasBot ? 'Aktif' : 'Pasif'}</div>
            </div>
         </div>
         <button class="btn" style="background:#ff4545; padding:5px 10px; font-size:0.8rem;" onclick="deleteUser('${u.login}')">Sil</button>
      </div>
      <div class="user-stats" style="margin-top:15px; font-size:0.9rem; color:#aaa;">
         <p><b>E-Posta:</b> ${esc(u.email || 'Bilinmiyor')}</p>
         <p><b>Lisans Durumu:</b> ${timeRemaining}</p>
         <p><b>Alınan Kutu:</b> ${u.stats ? u.stats.claimedCount : 0}</p>
         <p><b>Anlık Hedef:</b> ${(u.stats && u.stats.dropName) ? esc(u.stats.dropName) : 'Yok'}</p>
      </div>
      <div style="margin-top:15px; display:flex; gap:10px;">
         ${hasBot 
           ? `<button class="btn" style="flex:1; background:#ffaa00; color:#000;" onclick="stopBot('${u.login}')">Durdur</button>`
           : `<button class="btn" style="flex:1; background:#00ff80; color:#000;" onclick="startBot('${u.login}')">Başlat</button>`}
      </div>
    </div>
  `}).join('');
}
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
  const amount = parseInt($('licenseCount').value);
  if (!amount || amount < 1) return alert("Lütfen adet girin.");
  const duration = parseInt($('licenseDuration').value) || 30;
  
  $('btnGenLicense').textContent = 'Üretiliyor...';
  
  const res = await fetch('/api/admin/licenses', { 
     method: 'POST', 
     headers: { 'x-admin-password': adminPass, 'Content-Type': 'application/json' },
     body: JSON.stringify({ amount, duration })
  });
  const d = await res.json();
  
  $('btnGenLicense').textContent = 'Üret';
  $('genModal').classList.remove('active');
  
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

// UI Etkileşimleri (Sekmeler ve Modal)
$('tabUsersBtn').onclick = () => {
   $('tabUsersBtn').classList.add('active'); $('tabLicensesBtn').classList.remove('active');
   $('tabUsers').classList.add('active'); $('tabLicenses').classList.remove('active');
};
$('tabLicensesBtn').onclick = () => {
   $('tabLicensesBtn').classList.add('active'); $('tabUsersBtn').classList.remove('active');
   $('tabLicenses').classList.add('active'); $('tabUsers').classList.remove('active');
};

$('btnOpenModal').onclick = () => $('genModal').classList.add('active');
$('btnCloseModal').onclick = () => $('genModal').classList.remove('active');

$('btnRestartServer').addEventListener('click', async () => {
  if(!confirm('Sunucuyu yeniden başlat?')) return;
  fetch('/api/admin/restart', { method: 'POST', headers: { 'x-admin-password': adminPass } });
  alert('Yeniden başlatılıyor...');
  setTimeout(()=> location.reload(), 3000);
});

document.addEventListener('DOMContentLoaded', () => {
  if (adminPass) { fetchUsers(); connectWS(); }
});
