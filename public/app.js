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
    // Pulse artık envanter kartlarında gösteriliyor, ayrı bar yok
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
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted); font-size:0.95rem;">
        <div style="font-size:2.5rem; margin-bottom:12px;">📦</div>
        Henüz bir drop bilgisi çekilemedi.<br/>
        <span style="font-size:0.82rem;">Bot çalışmaya başlayınca droplar burada görünecek.</span>
      </div>`;
    return;
  }

  grid.innerHTML = invList.map(item => {
    let p = item.progress || 0;
    // Eğer bu item aktif toplanan item ise, canlı progress'i kullan
    if (currentName && item.name === currentName) {
       p = currentProg || p;
    }
    const isCompleted = p >= 100 || item.name.includes('(Alındı)');
    const isExpired   = item.name.includes('(Süresi Bitti)');
    const isActive    = !isCompleted && !isExpired && currentName && item.name === currentName;

    const cardClass = isCompleted ? 'drop-card completed' : isExpired ? 'drop-card expired' : 'drop-card';
    const fillClass = isCompleted ? 'drop-progress-fill done' : 'drop-progress-fill';
    const pctLabel  = isCompleted ? '<span class="drop-pct-label done">✔ Tamamlandı</span>' : `<span class="drop-pct-label">%${p}</span>`;

    const activeBadge  = isActive    ? '<span class="drop-active-badge">● AKTİF</span>'  : '';
    const expiredBadge = isExpired   ? '<span class="drop-expired-badge">× Bitti</span>'  : '';
    const doneBadge    = isCompleted ? '' : '';
    const pctBadge     = !isCompleted ? `<span class="drop-pct-badge">%${p}</span>` : '';

    const imgSrc = item.image || 'https://static-cdn.jtvnw.net/drops/fallback.png';
    const displayName = esc(item.name.replace(' (Alındı)', '').replace(' (Süresi Bitti)', ''));
    const suffix = isCompleted ? ' ✔' : isExpired ? ' (Sona Erdi)' : '';

    return `
      <div class="${cardClass}">
        <div class="drop-img-wrap">
          <img class="drop-img" src="${imgSrc}" alt="${displayName}" loading="lazy" />
          ${activeBadge}${expiredBadge}${pctBadge}
        </div>
        <div class="drop-body">
          <div class="drop-name">${displayName}${suffix}</div>
          <div class="drop-progress-track">
            <div class="${fillClass}" style="width:${Math.min(p,100)}%"></div>
          </div>
          ${pctLabel}
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
      
      // İstatistik Güncellemesi
      if (d.type === 'my_stat') {
         currentUserData = { ...currentUserData, isRunning: d.data.isRunning, stats: d.data.stats, login: currentLogin };
         renderStats(currentUserData);
      }
      
      // Canlı Bot Logları (Terminal)
      if (d.type === 'log') {
         const terminal = $('uiTerminal');
         if (terminal) {
            let color = '#a1a1aa'; // default / info
            if (d.level === 'error') color = '#ff4545';
            else if (d.level === 'warn') color = '#ffaa00';
            else if (d.level === 'success') color = '#4ade80';
            else if (d.message.includes('bulundu')) color = '#00e5ff'; // cyan highlight
            
            const div = document.createElement('div');
            div.style.color = color;
            div.innerHTML = `<span style="opacity:0.6">[${d.time}]</span> ${d.message}`;
            terminal.appendChild(div);
            
            // Auto scroll to bottom
            terminal.scrollTop = terminal.scrollHeight;
            
            // 50'den fazla log birikirse en eskisini sil
            if (terminal.children.length > 50) {
               terminal.removeChild(terminal.firstChild);
            }
         }
      }
    } catch (_) {}
  });

  ws.addEventListener('close', () => {
    if (currentLogin) setTimeout(() => connectWS(currentLogin), 3000);
  });
}

// Auto fetch removed from bottom, placed at the top.
