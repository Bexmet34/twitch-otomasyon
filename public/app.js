const $ = id => document.getElementById(id);
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let checkInterval = null;
let currentLogin = null;
let ws = null;
let isFirstLoad = true;

const loginSession = localStorage.getItem('login');
if (!loginSession) {
  window.location.href = 'login.html';
} else {
  // Hemen dashboard başlat
  fetchStats(loginSession);
  checkInterval = setInterval(() => fetchStats(loginSession), 10000);
}

$('btnLogout').addEventListener('click', () => {
  localStorage.removeItem('login');
  window.location.href = 'index.html';
});

// Takip Sistemi (Değişkenler üste taşındı)
let currentUserData = {};

function formatTimeLeft(expiresAt) {
  if(!expiresAt) return 'Süresiz';
  const timeLeftMs = new Date(expiresAt).getTime() - Date.now();
  if (timeLeftMs <= 0) return 'Süresi Doldu';
  
  const totalMin = Math.floor(timeLeftMs / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  
  if (d > 0) return `${d}g ${h}s ${m}dk`;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
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
    currentUserData = { ...currentUserData, ...data };
    renderStats(currentUserData);
    
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
  // İlk açılışta loader'ı gizleme mantığı
  if (isFirstLoad) {
     if (u.isRunning && (!u.stats || !u.stats.currentChannel || !u.stats.dropName)) {
        // Sunucudan gelen anlık işlem bilgisini ekrana yansıt
        $('sysLoader').querySelector('.loader-subtitle span').textContent = (u.stats && u.stats.statusText) ? u.stats.statusText : 'Arka plan işlemleri devam ediyor...';
        
        // Loader üzerindeki profil fotoğrafı ve ismi
        if ($('loaderAvatar')) $('loaderAvatar').src = `https://decapi.me/twitch/avatar/${esc(u.login)}`;
        if ($('loaderName')) $('loaderName').textContent = esc(u.display_name || u.login);
     } else {
        $('sysLoader').classList.add('hidden');
        isFirstLoad = false;
     }
  }

  $('fullDashboard').style.display = 'block';
  
  // Profil resmini decapi üzerinden dinamik çek
  $('uiAvatar').src = `https://decapi.me/twitch/avatar/${esc(u.login)}`;
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
  
  if (s.currentChannel) {
     $('uiChannel').textContent = esc(s.currentChannel);
     $('uiWorkBar').style.display = 'block';
     $('uiChannelThumb').style.display = 'block';
     // Thumbnail Twitch cache bozulmasın diye timestamp ile ufak bypass yapıyoruz (her 5 dk'da bir güncellenir)
     const timeChunk = Math.floor(Date.now() / 300000);
     $('uiChannelThumb').src = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.currentChannel.toLowerCase()}-320x180.jpg?t=${timeChunk}`;
  } else {
     $('uiChannel').textContent = 'Aranıyor...';
     $('uiWorkBar').style.display = 'none';
     $('uiChannelThumb').style.display = 'none';
  }
  
  $('uiClaimed').textContent = s.claimedCount || 0;
  
  if (s.dropName) {
    $('uiPulse').style.display = 'inline-block';
    $('uiCurrentDropName').textContent = s.dropName;
    $('uiCurrentDropPercent').textContent = `%${s.dropProgress || 0}`;
    $('uiCurrentDropFill').style.width = `${s.dropProgress || 0}%`;
  } else {
    $('uiPulse').style.display = 'none';
    $('uiCurrentDropName').textContent = 'Aranıyor...';
    $('uiCurrentDropPercent').textContent = '%0';
    $('uiCurrentDropFill').style.width = '0%';
  }
  
  $('uiUptime').textContent = formatTimeLeft(u.expiresAt);

  // Kalan Süre rengini ayarla (Süre bittiyse kırmızı)
  const timeLeftMs = new Date(u.expiresAt).getTime() - Date.now();
  if (timeLeftMs <= 0) {
     $('uiUptime').style.color = '#ff4545';
  } else {
     $('uiUptime').style.color = '#fff';
  }
  
  // Süre bitse de bitmese de uzatma alanı her zaman açık kalacak
  $('uiRenewSection').style.display = 'flex';

  renderInventory(s.inventory, s.dropName, s.dropProgress);
}

async function renewLicense() {
  const code = $('renewCode').value.trim();
  if (!code) return alert('Lütfen geçerli bir lisans kodu girin!');
  
  const res = await fetch('/api/user/renew', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: currentLogin, licenseCode: code })
  });
  
  const data = await res.json();
  if (data.ok) {
     alert('Lisansınız başarıyla yenilendi! Botunuz başlatılıyor...');
     $('renewCode').value = '';
     fetchStats(currentLogin);
  } else {
     alert('Hata: ' + (data.error || 'Bilinmiyor'));
  }
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
  });

  ws.addEventListener('message', evt => {
    try {
      const d = JSON.parse(evt.data);
      if (d.type === 'my_stat') {
         currentUserData = { ...currentUserData, isRunning: d.data.isRunning, stats: d.data.stats, login: currentLogin };
         renderStats(currentUserData);
      }
    } catch (_) {}
  });

  ws.addEventListener('close', () => {
    if (currentLogin) setTimeout(() => connectWS(currentLogin), 3000);
  });
}

// Auto fetch removed from bottom, placed at the top.
