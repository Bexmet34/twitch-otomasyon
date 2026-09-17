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

  // Profil resmi: önce DB'deki kayitli URL, yoksa decapi fallback
  const avatarSrc = u.profile_image_url
    ? u.profile_image_url
    : `https://decapi.me/twitch/avatar/${esc(u.login)}`;
  
  // Sadece değiştiyse yaz (flicker önlemek için)
  if ($('uiAvatar').src !== avatarSrc) $('uiAvatar').src = avatarSrc;
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
    if (lastInventoryHash === emptyHash) return; // Değişmedi, dokunma
    lastInventoryHash = emptyHash;
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted); font-size:0.95rem;">
        <div style="font-size:2.5rem; margin-bottom:12px;">📦</div>
        Henüz bir drop bilgisi çekilemedi.<br/>
        <span style="font-size:0.82rem;">Bot çalışmaya başlayınca droplar burada görünecek.</span>
      </div>`;
    return;
  }

  // Envanter listesinin "imzasını" çıkar: isimler + resimler (progress haric, o ayrı güncelleniyor)
  const structureHash = invList.map(i => `${i.name}|${i.image}`).join(',');
  
  if (structureHash !== lastInventoryHash) {
    // Yapı değişti: tüm kartları yeniden çiz
    lastInventoryHash = structureHash;
    
    grid.innerHTML = invList.map(item => {
      let p = item.progress || 0;
      if (currentName && item.name === currentName) p = currentProg || p;
      const isCompleted = p >= 100 || item.name.includes('(Alındı)');
      const isExpired   = item.name.includes('(Süresi Bitti)');
      const isActive    = !isCompleted && !isExpired && currentName && item.name === currentName;

      const cardClass = isCompleted ? 'drop-card completed' : isExpired ? 'drop-card expired' : 'drop-card';
      const fillClass = isCompleted ? 'drop-progress-fill done' : 'drop-progress-fill';
      const pctLabel  = isCompleted ? '<span class="drop-pct-label done">✔ Tamamlandı</span>' : `<span class="drop-pct-label">%${p}</span>`;
      const activeBadge  = isActive  ? '<span class="drop-active-badge">● AKTİF</span>' : '';
      const expiredBadge = isExpired ? '<span class="drop-expired-badge">× Bitti</span>'  : '';
      const pctBadge     = !isCompleted ? `<span class="drop-pct-badge">%${p}</span>` : '';
      const imgSrc = item.image || 'https://static-cdn.jtvnw.net/drops/fallback.png';
      const displayName = esc(item.name.replace(' (Alındı)', '').replace(' (Süresi Bitti)', ''));
      const suffix = isCompleted ? ' ✔' : isExpired ? ' (Sona Erdi)' : '';
      const safeId = 'drop_' + btoa(encodeURIComponent(item.name + (item.image||''))).replace(/[^a-z0-9]/gi,'').slice(0,20);

      return `
        <div class="${cardClass}" id="${safeId}">
          <div class="drop-img-wrap">
            <img class="drop-img" src="${imgSrc}" alt="${displayName}" loading="lazy" />
            ${activeBadge}${expiredBadge}${pctBadge}
          </div>
          <div class="drop-body">
            <div class="drop-name">${displayName}${suffix}</div>
            <div class="drop-progress-track">
              <div class="${fillClass}" id="${safeId}_fill" style="width:${Math.min(p,100)}%"></div>
            </div>
            <span class="drop-pct-label${isCompleted?' done':''}" id="${safeId}_pct">${isCompleted ? '✔ Tamamlandı' : '%'+p}</span>
          </div>
        </div>
      `;
    }).join('');
    
  } else {
    // Yapı aynı: sadece progress barları ve yüzdeleri güncelle (DOM yeniden yazma YOK)
    invList.forEach(item => {
      let p = item.progress || 0;
      if (currentName && item.name === currentName) p = currentProg || p;
      const isCompleted = p >= 100 || item.name.includes('(Alındı)');
      const safeId = 'drop_' + btoa(encodeURIComponent(item.name + (item.image||''))).replace(/[^a-z0-9]/gi,'').slice(0,20);
      
      const fillEl = $(safeId + '_fill');
      const pctEl  = $(safeId + '_pct');
      
      if (fillEl) fillEl.style.width = Math.min(p, 100) + '%';
      if (pctEl)  pctEl.textContent = isCompleted ? '✔ Tamamlandı' : '%' + p;
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
