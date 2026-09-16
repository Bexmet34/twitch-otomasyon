const $ = id => document.getElementById(id);
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// Sekme Geçişleri
$('tabTrack').addEventListener('click', () => {
  $('tabTrack').classList.add('active');
  $('tabSetup').classList.remove('active');
  $('panelTrack').classList.add('active');
  $('panelSetup').classList.remove('active');
});

$('tabSetup').addEventListener('click', () => {
  $('tabSetup').classList.add('active');
  $('tabTrack').classList.remove('active');
  $('panelSetup').classList.add('active');
  $('panelTrack').classList.remove('active');
});

// Otomatik Kod Oluşturma
const host = window.location.origin;
const setupCode = `
const lic = prompt('İtemSatış Lisans Kodunuzu Girin (Örn: ITEM-XXXX):');
if(lic){
  fetch('${host}/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: document.cookie.split('; ').find(row => row.startsWith('auth-token='))?.split('=')[1], licenseCode: lic.trim() })
  }).then(r=>r.json()).then(d=>alert(d.ok ? '✅ Sistem Kuruldu! Sitemize dönüp durumunuzu takip edebilirsiniz.' : '❌ Hata: ' + d.error)).catch(()=>alert('Hata!'));
}`;
$('setupCodeSnippet').value = setupCode.trim();

$('btnCopyCode').addEventListener('click', () => {
  $('setupCodeSnippet').select();
  document.execCommand('copy');
  const btn = $('btnCopyCode');
  btn.textContent = 'Kopyalandı! ✔️';
  btn.style.background = '#00cc66';
  setTimeout(() => {
    btn.textContent = 'Kodu Kopyala';
    btn.style.background = '#00ff80';
  }, 2000);
});

// Takip Sistemi
let checkInterval = null;
let currentLogin = null;
let ws = null;

function formatUptime(startedAt) {
  if(!startedAt) return '—';
  const d = Date.now() - new Date(startedAt).getTime();
  const h = String(Math.floor(d / 3600000)).padStart(2,'0');
  const m = String(Math.floor((d % 3600000) / 60000)).padStart(2,'0');
  return `${h}:${m}`;
}

async function fetchStats(login) {
  try {
    const res = await fetch(`/api/mystats/${login}`);
    if (res.status === 404) {
      alert("Bu Twitch adına sahip aktif bir bot bulunamadı. Satın alım yaptıysanız 'Kurulum' sekmesinden işlemi tamamlayın.");
      clearInterval(checkInterval);
      return;
    }
    const data = await res.json();
    renderStats(data);
    
    // WS Bağlantısını başlat/güncelle
    if (currentLogin !== login) {
      currentLogin = login;
      if (ws) ws.close();
      connectWS(login);
    }
  } catch(e) {
    console.error(e);
  }
}

function renderStats(u) {
  $('fullDashboard').style.display = 'block';
  
  $('uiAvatar').src = esc(u.profile_image_url) || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22%23333%22/></svg>';
  $('uiName').textContent = esc(u.display_name);
  
  const statusEl = $('uiStatus');
  if (u.isRunning) {
    statusEl.textContent = 'Bot Aktif ve Çalışıyor';
    statusEl.className = 'uc-status online';
  } else {
    statusEl.textContent = 'Bot Durduruldu';
    statusEl.className = 'uc-status';
  }

  const s = u.stats || {};
  $('uiChannel').textContent = s.currentChannel ? esc(s.currentChannel) : 'Aranıyor...';
  $('uiClaimed').textContent = s.claimedCount || 0;
  $('uiUptime').textContent = formatUptime(s.startedAt);

  renderInventory(s.inventory, s.dropName, s.dropProgress);
}

function renderInventory(invList, currentName, currentProg) {
  const grid = $('uiInventory');
  if (!invList || invList.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted); font-size: 0.9rem;">Henüz bir drop bilgisi çekilemedi.</div>';
    return;
  }

  grid.innerHTML = invList.map(item => {
    let p = item.progress || 0;
    // Eğer bu item aktif toplanan item ise, canlı progress'i kullan
    if (currentName && item.name === currentName) {
       p = currentProg || p;
    }
    const isClaimed = p >= 100 || item.name.includes('(Alındı)');
    
    return `
      <div class="drop-item">
        <img src="${item.image || 'https://static-cdn.jtvnw.net/drops/fallback.png'}" />
        <div class="drop-title" title="${esc(item.name)}">${esc(item.name)}</div>
        <div>
          <div class="drop-progress"><div class="drop-progress-fill" style="width:${isClaimed ? 100 : p}%"></div></div>
          <div style="font-size: 0.8rem; text-align:right; margin-top:5px; color:${isClaimed ? '#00ff80' : '#aaa'}">${isClaimed ? 'Tamamlandı' : `%${p}`}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Canlı Loglar (WebSocket)
function connectWS(login) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  
  ws.addEventListener('open', () => {
    // Sadece bu kullanıcı adının loglarını istiyorum mesajı gönder
    ws.send(JSON.stringify({ type: 'auth', login: login }));
    $('terminal').innerHTML = '<div class="log-line"><span class="log-msg" style="color:#00ff80;">[BAĞLANDI] Canlı veri akışı başlatıldı...</span></div>';
  });

  ws.addEventListener('message', evt => {
    try {
      const d = JSON.parse(evt.data);
      if (d.type === 'log') appendLog(d);
      if (d.type === 'my_stat') renderStats({ ...d.data, login: currentLogin });
    } catch (_) {}
  });

  ws.addEventListener('close', () => {
    if (currentLogin) setTimeout(() => connectWS(currentLogin), 3000);
  });
}

function appendLog(log) {
  const term = $('terminal');
  const div = document.createElement('div');
  div.className = 'log-line';
  
  let lvlClass = 'level-info';
  if(log.level === 'warn') lvlClass = 'level-warn';
  if(log.level === 'error') lvlClass = 'level-error';
  if(log.level === 'success') lvlClass = 'level-success';

  div.innerHTML = `
    <span class="log-time">[${esc(log.time)}]</span>
    <span class="log-level ${lvlClass}">${esc(log.level.toUpperCase())}</span>
    <span class="log-msg">${esc(log.message)}</span>
  `;
  
  term.appendChild(div);
  // Auto scroll
  term.scrollTop = term.scrollHeight;
  
  // 100 satırı geçmesin
  while (term.children.length > 100) {
    term.removeChild(term.firstChild);
  }
}

$('btnCheck').addEventListener('click', () => {
  const login = $('usernameInput').value.trim().toLowerCase();
  if (!login) return alert("Lütfen Twitch adınızı girin!");
  
  $('btnCheck').textContent = 'Sorgulanıyor...';
  
  fetchStats(login).then(() => {
    $('btnCheck').textContent = 'Sorgula';
    clearInterval(checkInterval);
    checkInterval = setInterval(() => fetchStats(login), 10000);
  });
});

$('usernameInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') $('btnCheck').click();
});
