const $ = id => document.getElementById(id);
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let checkInterval = null;
let currentLogin = null;
let ws = null;
let isFirstLoad = true;
let lastInventoryHash = null; // Envanter değişmediğinde DOM'u korumak için

const loginSession = localStorage.getItem('login') || sessionStorage.getItem('login');
if (!loginSession) {
  window.location.href = 'login.html';
} else {
  // İlk yükleme — loader'ı 3sn sonra kapat (bot hala başlamıyor olsa bile)
  fetchStats(loginSession);
  setTimeout(() => {
    $('sysLoader').classList.add('hidden');
    $('fullDashboard').style.display = 'block';
    isFirstLoad = false;
  }, 3000);
  // Sonrasinda her 10sn'de bir sessiz güncelleme
  checkInterval = setInterval(() => fetchStats(loginSession), 10000);
}

$('btnLogout').addEventListener('click', () => {
  localStorage.removeItem('login');
  sessionStorage.removeItem('login');
  window.location.href = 'login.html';
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
  // Dashboard'u göster (ilk açılışta zaten setTimeout ile açılıyor)
  $('fullDashboard').style.display = 'block';

  // Profil resmi: DB'deki URL varsa ve geçerliyse kullan, aksi halde decapi
  const avatarUrl = (u.profile_image_url && u.profile_image_url.startsWith('http'))
    ? u.profile_image_url
    : `https://decapi.me/twitch/avatar/${esc(u.login)}?_=${u.login}`;

  const avatarEl = $('uiAvatar');
  if (avatarEl.dataset.login !== u.login) {
    // Kullanıcı değişti veya ilk yükleme: resmi güncelle
    avatarEl.dataset.login = u.login;
    avatarEl.src = avatarUrl;
    avatarEl.onerror = () => {
      avatarEl.onerror = null;
      avatarEl.src = 'https://static-cdn.jtvnw.net/user-default-pictures-uv/13e5fa74-defa-11e9-809c-784f43822e80-profile_image-70x70.png';
    };
  }
  if ($('uiName').textContent !== esc(u.display_name || u.login)) $('uiName').textContent = esc(u.display_name || u.login);

  const statusEl = $('uiStatus');
  const newStatusText = u.isRunning ? 'Bot Aktif ve Çalışıyor' : 'Bot Durduruldu';
  const newStatusClass = u.isRunning ? 'uc-status online' : 'uc-status';
  if (statusEl.textContent !== newStatusText) statusEl.textContent = newStatusText;
  if (statusEl.className !== newStatusClass) statusEl.className = newStatusClass;

  const s = u.stats || {};
  
  if (s.currentChannel) {
     if ($('uiChannel').textContent !== esc(s.currentChannel)) $('uiChannel').textContent = esc(s.currentChannel);
     $('uiWorkBar').style.display = 'block';
     const timeChunk = Math.floor(Date.now() / 300000);
     const thumbSrc = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.currentChannel.toLowerCase()}-320x180.jpg?t=${timeChunk}`;
     if ($('uiChannelThumb').dataset.ch !== s.currentChannel) {
       $('uiChannelThumb').src = thumbSrc;
       $('uiChannelThumb').dataset.ch = s.currentChannel;
       $('uiChannelThumb').style.display = 'block';
     }
  } else {
     if ($('uiChannel').textContent !== 'Aranıyor...') $('uiChannel').textContent = 'Aranıyor...';
     $('uiWorkBar').style.display = 'none';
     $('uiChannelThumb').style.display = 'none';
  }
  
  const claimed = String(s.claimedCount || 0);
  if ($('uiClaimed').textContent !== claimed) $('uiClaimed').textContent = claimed;
  
  const timeStr = formatTimeLeft(u.expiresAt);
  if ($('uiUptime').textContent !== timeStr) $('uiUptime').textContent = timeStr;

  // Kalan süre rengi
  const timeLeftMs = new Date(u.expiresAt).getTime() - Date.now();
  $('uiUptime').style.color = timeLeftMs <= 0 ? '#ff4545' : '#fff';
  
  // Uzatma alanı her zaman açık
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
    const emptyHash = '__empty__';
    if (lastInventoryHash === emptyHash) return;
    lastInventoryHash = emptyHash;
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted); font-size:0.95rem;">
        <div style="font-size:2.5rem; margin-bottom:12px;">📦</div>
        Henüz bir drop bilgisi çekilemedi.<br/>
        <span style="font-size:0.82rem;">Bot çalışmaya başlayınca droplar burada görünecek.</span>
      </div>`;
    return;
  }

  // İlerleyen/Aktif droplar ve Alınan dropları ayır
  const activeDrops = invList.filter(i => i.status !== 'claimed' && !i.name.includes('(Alındı)'));
  const claimedDrops = invList.filter(i => i.status === 'claimed' || i.name.includes('(Alındı)'));

  // Hash kontrolü
  const structureHash = invList.map(i => `${i.name}|${i.image || 'null'}|${i.status}|${i.quantity || 1}|${i.date || ''}`).join(',');
  
  if (structureHash !== lastInventoryHash) {
    lastInventoryHash = structureHash;

    let html = '';

    // ── 1. AKTİF VE İLERLEYEN DROPLAR ──
    if (activeDrops.length > 0) {
      html += activeDrops.map(item => {
        let p = item.progress || 0;
        if (currentName && item.name === currentName) p = currentProg || p;
        const isReady = item.isReadyToClaim || p >= 100 || item.status === 'ready';
        const isExpired = item.isExpired || item.name.includes('(Süresi Bitti)');
        const isActive = !isReady && !isExpired && currentName && item.name === currentName;

        const cardClass = isReady ? 'drop-card ready-to-claim' : isExpired ? 'drop-card expired' : 'drop-card';
        const fillClass = isReady ? 'drop-progress-fill ready' : 'drop-progress-fill';
        const activeBadge = isActive ? '<span class="drop-active-badge">● AKTİF</span>' : '';
        const readyBadge = isReady ? '<span class="drop-ready-badge">🎁 DOLDU - ALINABİLİR</span>' : '';
        const expiredBadge = isExpired ? '<span class="drop-expired-badge">× Bitti</span>' : '';
        const pctBadge = !isReady && !isExpired ? `<span class="drop-pct-badge">%${p}</span>` : '';
        const imgSrc = item.image || null;
        const displayName = esc(item.name.replace(' (Alındı)', '').replace(' (Süresi Bitti)', ''));
        const safeId = 'drop_' + btoa(encodeURIComponent(item.name + (item.image||''))).replace(/[^a-z0-9]/gi,'').slice(0,20);
        
        const imgTag = imgSrc
          ? `<img class="drop-img" src="${imgSrc}" alt="${displayName}" loading="lazy" onerror="this.onerror=null;this.src='https://static-cdn.jtvnw.net/drops/fallback.png';this.style.objectFit='contain';this.style.padding='20px'" />`
          : `<div class="drop-img-placeholder">🎁</div>`;

        const actionBtn = isReady
          ? `<a href="https://www.twitch.tv/drops/inventory" target="_blank" rel="noopener" class="drop-claim-btn">
              🎁 Twitch'te Talep Et ↗
             </a>`
          : '';

        return `
          <div class="${cardClass}" id="${safeId}">
            <div class="drop-img-wrap">
              ${imgTag}
              ${activeBadge}${readyBadge}${expiredBadge}${pctBadge}
            </div>
            <div class="drop-body">
              <div class="drop-name">${displayName}</div>
              <div class="drop-progress-track">
                <div class="${fillClass}" id="${safeId}_fill" style="width:${Math.min(p,100)}%"></div>
              </div>
              <div class="drop-footer-row">
                <span class="drop-pct-label${isReady ? ' ready' : ''}" id="${safeId}_pct">
                  ${isReady ? '✔ %100 Doldu (Almaya Hazır)' : '%' + p}
                </span>
              </div>
              ${actionBtn}
            </div>
          </div>
        `;
      }).join('');
    }

    // ── 2. ALINAN DROPLAR (CLAIMED) ──
    if (claimedDrops.length > 0) {
      html += `
        <div style="grid-column: 1 / -1; margin-top: 18px; margin-bottom: 6px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
          <h4 style="margin:0; font-size:1rem; font-weight:700; color:#00e676; display:flex; align-items:center; gap:8px;">
            <span>✔ Alınan Droplar</span>
            <span style="background:rgba(0,230,118,0.15); color:#00e676; font-size:0.75rem; padding:2px 8px; border-radius:12px; border:1px solid rgba(0,230,118,0.3);">
              ${claimedDrops.reduce((acc, curr) => acc + (curr.quantity || 1), 0)} Kutu
            </span>
          </h4>
        </div>
      `;

      html += claimedDrops.map(item => {
        const qty = item.quantity || 1;
        const dateStr = item.date || 'Alındı';
        const imgSrc = item.image || null;
        const displayName = esc(item.name.replace(' (Alındı)', ''));
        const safeId = 'drop_' + btoa(encodeURIComponent(item.name + (item.image||'') + dateStr)).replace(/[^a-z0-9]/gi,'').slice(0,20);
        const qtyBadge = qty > 1 ? `<span class="drop-qty-badge">${qty}x Adet</span>` : `<span class="drop-qty-badge">1x</span>`;

        const imgTag = imgSrc
          ? `<img class="drop-img" src="${imgSrc}" alt="${displayName}" loading="lazy" onerror="this.onerror=null;this.src='https://static-cdn.jtvnw.net/drops/fallback.png';this.style.objectFit='contain';this.style.padding='20px'" />`
          : `<div class="drop-img-placeholder">🎁</div>`;

        return `
          <div class="drop-card claimed" id="${safeId}">
            <div class="drop-img-wrap">
              ${imgTag}
              <span class="drop-claimed-badge">✔ ALINDI</span>
              ${qtyBadge}
            </div>
            <div class="drop-body">
              <div class="drop-name">${displayName}</div>
              <div class="drop-claimed-info">
                <span class="drop-date-tag">⏱ ${esc(dateStr)}</span>
                <span class="drop-claimed-count">${qty} Adet Sandık</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    grid.innerHTML = html;
    
  } else {
    // Yapı aynı ise aktif dropların progresslerini güncelle
    activeDrops.forEach(item => {
      let p = item.progress || 0;
      if (currentName && item.name === currentName) p = currentProg || p;
      const isReady = item.isReadyToClaim || p >= 100 || item.status === 'ready';
      const safeId = 'drop_' + btoa(encodeURIComponent(item.name + (item.image||''))).replace(/[^a-z0-9]/gi,'').slice(0,20);
      
      const fillEl = $(safeId + '_fill');
      const pctEl = $(safeId + '_pct');
      
      if (fillEl) fillEl.style.width = Math.min(p, 100) + '%';
      if (pctEl) pctEl.textContent = isReady ? '✔ %100 Doldu (Almaya Hazır)' : '%' + p;
    });
  }
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
