// ============================================================
//  app.js – Twitch Drops Bot Frontend Mantığı (v2)
// ============================================================

const $ = id => document.getElementById(id);

// ── State ────────────────────────────────────────────────────
const state = {
  running:     false,
  logPaused:   false,
  logCount:    0,
  logOpen:     false,
  startedAt:   null,
  nextCheckAt: null,
  authToken:   localStorage.getItem('twitch_token') || '',
  userInfo:    null,
  uptimeTimer:    null,
  countdownTimer: null,
};

// ── Yardımcılar ───────────────────────────────────────────────
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── WebSocket ─────────────────────────────────────────────────
let ws;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.addEventListener('open',    ()   => addLog('info', 'Sunucuya bağlandı.'));
  ws.addEventListener('close',   ()   => { addLog('warn', 'Bağlantı kesildi, yeniden bağlanılıyor…'); setTimeout(connectWS, 3000); });
  ws.addEventListener('error',   ()   => addLog('error', 'WebSocket hatası.'));
  ws.addEventListener('message', evt => {
    try {
      const d = JSON.parse(evt.data);
      if (d.type === 'log')   handleLog(d);
      if (d.type === 'stats') handleStats(d.data);
    } catch (_) {}
  });
}

// ── Log Yönetimi ──────────────────────────────────────────────
function handleLog({ level, message, time }) { addLog(level, message, time); }

function addLog(level, msg, time) {
  const con  = $('logConsole');
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  const ts = time || new Date().toLocaleTimeString('tr-TR');
  line.innerHTML =
    `<span class="ll-time">${ts}</span>` +
    `<span class="ll-badge ${level}">${level.toUpperCase()}</span>` +
    `<span class="ll-msg">${esc(msg)}</span>`;
  con.appendChild(line);
  state.logCount++;
  $('logCount').textContent = state.logCount;
  if (!state.logPaused) {
    while (con.children.length > 600) con.removeChild(con.firstChild);
    con.scrollTop = con.scrollHeight;
  }
}

// ── İstatistik İşleyici ───────────────────────────────────────
function handleStats(s) {
  const wasRunning = state.running;
  state.running    = s.running ?? false;

  // Çalışma süresi
  if (state.running && !wasRunning && s.startedAt) {
    state.startedAt = new Date(s.startedAt);
    startUptimeCounter();
  }
  if (!state.running && wasRunning) {
    stopUptimeCounter();
    $('statUptime').textContent = '—';
  }

  // Temel istatistikler ve Thumbnail
  if (s.currentChannel) {
    $('statChannel').textContent = s.currentChannel;
    $('streamThumbWrap').style.display = 'block';
    $('streamThumb').src = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.currentChannel.toLowerCase()}-440x248.jpg`;
  } else {
    $('statChannel').textContent = '—';
    $('streamThumbWrap').style.display = 'none';
    $('streamThumb').src = '';
  }
  $('statClaimed').textContent = s.claimedCount ?? 0;

  // nextCheckAt
  if (s.nextCheckAt) state.nextCheckAt = s.nextCheckAt;

  // Drop ilerlemesi
  updateDropProgress(s);

  updateUI();
}

function updateDropProgress(s) {
  const inventory = s.inventory || [];
  
  if (state.running) {
    $('dropEmpty').style.display   = 'none';
    $('dropContent').style.display = 'flex';
    
    const listEl = $('inventoryList');
    listEl.innerHTML = ''; // clear

    if (inventory.length === 0) {
      listEl.innerHTML = '<div class="inv-item" style="align-items:center; color:var(--text-muted); font-size:0.8rem;">Envanter kontrol ediliyor veya drop bulunamadı.</div>';
    } else {
      inventory.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'inv-item';
        itemEl.innerHTML = `
          <div class="inv-header">
            ${item.image ? `<img src="${item.image}" class="inv-img" alt="${item.name}">` : '<div class="inv-img"></div>'}
            <div class="inv-name">${esc(item.name)}</div>
          </div>
          <div class="progress-section">
            <div class="progress-track">
              <div class="progress-fill" style="width:${item.progress}%"></div>
            </div>
            <span class="progress-pct">${item.progress}%</span>
          </div>
        `;
        listEl.appendChild(itemEl);
      });
    }
  } else {
    $('dropEmpty').style.display   = 'flex';
    $('dropContent').style.display = 'none';
  }
}

// ── Uptime Sayacı ─────────────────────────────────────────────
function startUptimeCounter() {
  stopUptimeCounter();
  state.uptimeTimer = setInterval(() => {
    if (!state.startedAt) return;
    const d = Date.now() - state.startedAt.getTime();
    const h = String(Math.floor(d / 3600000)).padStart(2,'0');
    const m = String(Math.floor((d % 3600000) / 60000)).padStart(2,'0');
    const s = String(Math.floor((d % 60000) / 1000)).padStart(2,'0');
    $('statUptime').textContent = `${h}:${m}:${s}`;
  }, 1000);
}
function stopUptimeCounter() { clearInterval(state.uptimeTimer); }

// ── Countdown (Sonraki Kontrol) ───────────────────────────────
function startCountdownTimer() {
  clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (!state.running || !state.nextCheckAt) {
      $('nextCheckCountdown').textContent = '—';
      return;
    }
    const rem = state.nextCheckAt - Date.now();
    if (rem <= 0) { $('nextCheckCountdown').textContent = 'kontrol ediliyor…'; return; }
    const m = String(Math.floor(rem / 60000)).padStart(2,'0');
    const s = String(Math.floor((rem % 60000) / 1000)).padStart(2,'0');
    $('nextCheckCountdown').textContent = `${m}:${s}`;
  }, 1000);
}

// ── UI Durumu ─────────────────────────────────────────────────
function updateUI() {
  const dot  = $('statusDot');
  const text = $('statusText');
  if (state.running) {
    dot.className  = 'sdot running';
    text.textContent = 'Çalışıyor';
    $('btnStart').disabled = true;
    $('btnStop').disabled  = false;
  } else {
    dot.className  = 'sdot stopped';
    text.textContent = 'Durdu';
    $('btnStart').disabled = false;
    $('btnStop').disabled  = true;
  }
}

// ── Sunucu Durumu Senkronizasyonu ─────────────────────────────
async function syncStatus() {
  try {
    const d = await fetch('/api/status').then(r => r.json());
    state.running = d.running;
    if (d.running && d.stats?.startedAt) {
      state.startedAt = new Date(d.stats.startedAt);
      startUptimeCounter();
    } else if (!d.running) {
      stopUptimeCounter();
      $('statUptime').textContent  = '—';
      $('statChannel').textContent = '—';
    }
    if (d.stats) {
      $('statClaimed').textContent = d.stats.claimedCount ?? 0;
      $('statChannel').textContent = d.stats.currentChannel || '—';
      if (d.stats.nextCheckAt) state.nextCheckAt = d.stats.nextCheckAt;
      updateDropProgress(d.stats);
    }
    updateUI();
  } catch (_) {}
}

// ── Token ile Giriş ───────────────────────────────
async function performBrowserLogin() {
  const btn = $('btnOverlayLogin');
  const txt = $('overlayLoginText');
  const loader = $('lbLoader');
  const input = $('inputOverlayToken');
  const token = input.value.trim();

  if (!token || token.length < 10) {
    showAlert('Lütfen geçerli bir auth-token girin.', 'warn');
    input.focus();
    return;
  }
  
  btn.style.display = 'none';
  input.style.display = 'none';
  loader.style.display = 'flex';
  
  try {
    loader.querySelector('p').textContent = 'Token Doğrulanıyor...';
    
    // Doğrulama ve profil bilgisi çekme
    const infoRes = await fetch(`/api/userinfo?token=${encodeURIComponent(token)}`);
    const infoData = await infoRes.json();
    
    if (!infoRes.ok) throw new Error(infoData.error || 'Token doğrulanamadı. Geçersiz veya süresi dolmuş olabilir.');
    
    state.authToken = token;
    localStorage.setItem('twitch_token', token);
    state.userInfo = infoData;
    updateAccountCard(infoData);
    showAlert(`✅ Hoş geldin, ${infoData.display_name}! Giriş başarılı.`, 'success');
    
    // Overlay'i kapat
    $('loginOverlay').style.display = 'none';
    
  } catch (err) {
    showAlert(`❌ ${err.message}`, 'error');
    btn.style.display = 'flex';
    input.style.display = 'block';
    loader.style.display = 'none';
  }
}

// ── Hesap Kartı Güncelle ──────────────────────────────────────
function updateAccountCard(info) {
  if (!info || !info.login) return;
  $('acctEmpty').style.display = 'none';
  $('acctInfo').style.display  = 'flex';
  $('acctInfo').style.flexDirection = 'column';
  $('acctInfo').style.alignItems    = 'center';

  // Overlay'i kapat (varsa)
  if($('loginOverlay')) $('loginOverlay').style.display = 'none';

  const avatar = $('userAvatar');
  avatar.src = info.profile_image_url || '';
  avatar.alt = info.display_name;

  $('userDisplayName').textContent = info.display_name || info.login;
  $('userLogin').textContent       = `@${info.login}`;

  const typeEl = $('userType');
  typeEl.textContent = info.broadcaster_type === 'partner'
    ? 'Partner' : info.broadcaster_type === 'affiliate'
    ? 'Affiliate' : 'Normal';
  typeEl.className = `ubadge ${info.broadcaster_type ? 'green' : 'purple'}`;
}

function updateTpUsercard(info) {
  if (!info) { $('tpUsercard').style.display = 'none'; return; }
  $('tpUsercard').style.display  = 'block';
  $('tpAvatar').src              = info.profile_image_url || '';
  $('tpDisplay').textContent     = info.display_name || info.login;
  $('tpLogin').textContent       = `@${info.login}`;
}

// ── Bot API ───────────────────────────────────────────────────
async function startBot() {
  const token = state.authToken;
  if (!token) {
    showAlert('Önce sağ üstteki Token butonundan hesabını doğrula.', 'error'); return;
  }
  $('btnStart').disabled = true;
  try {
    const res  = await fetch('/api/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken: token }),
    });
    const data = await res.json();
    if (res.ok) {
      showAlert('✅ Bot başlatıldı!', 'success');
      state.running   = true;
      state.startedAt = new Date();
      startUptimeCounter();
      updateUI();
    } else if (res.status === 409) {
      showAlert('ℹ️ Bot zaten çalışıyor.', 'info');
      await syncStatus();
    } else {
      showAlert(`❌ ${data.error}`, 'error');
      $('btnStart').disabled = false;
    }
  } catch (err) {
    showAlert(`❌ ${err.message}`, 'error');
    $('btnStart').disabled = false;
  }
}

async function stopBot() {
  $('btnStop').disabled = true;
  try {
    const res  = await fetch('/api/stop', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showAlert('🛑 Bot durduruldu.', 'info');
      state.running = false;
      stopUptimeCounter();
      $('statUptime').textContent  = '—';
      $('statChannel').textContent = '—';
      updateDropProgress({});
      updateUI();
    } else if (res.status === 409) {
      showAlert('ℹ️ Bot zaten durmuş.', 'info');
      await syncStatus();
    } else {
      showAlert(`❌ ${data.error}`, 'error');
      $('btnStop').disabled = false;
    }
  } catch (err) {
    showAlert(`❌ ${err.message}`, 'error');
    $('btnStop').disabled = false;
  }
}

async function forceReset() {
  if (!confirm('Botu zorla sıfırlamak istediğine emin misin?')) return;
  try {
    await fetch('/api/reset', { method: 'POST' });
    showAlert('🔄 Bot sıfırlandı.', 'info');
    state.running = false;
    stopUptimeCounter();
    updateDropProgress({});
    updateUI();
  } catch (err) {
    showAlert(`❌ ${err.message}`, 'error');
  }
}

async function restartServer() {
  if (!confirm('Tüm sunucu (PM2) yeniden başlatılacak. Emin misiniz?')) return;
  try {
    await fetch('/api/restart-server', { method: 'POST' });
    showAlert('⚡ Sunucu yeniden başlatılıyor. Sayfa yenilenecek...', 'warn');
    setTimeout(() => window.location.reload(), 3000);
  } catch (err) {
    showAlert(`ℹ️ Sunucu bağlantısı koptu, yeniden başlatılıyor...`, 'info');
    setTimeout(() => window.location.reload(), 3000);
  }
}

function showAlert(msg, type = 'info') {
  const box = $('alertBox');
  box.className = `ctrl-alert ${type}`;
  box.textContent = msg;
  box.style.display = 'block';
  setTimeout(() => { box.style.display = 'none'; }, 6000);
}

// ── Log Toggle ────────────────────────────────────────────────
function toggleLog() {
  state.logOpen = !state.logOpen;
  $('logBody').classList.toggle('open', state.logOpen);
  $('logArrow').classList.toggle('open', state.logOpen);
  $('logToggle').setAttribute('aria-expanded', state.logOpen);
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Mevcut durumu sorgula
  await syncStatus();
  connectWS();
  startCountdownTimer();

  // Kayıtlı token varsa kullanıcı bilgisini çek
  if (state.authToken) {
    try {
      const r = await fetch(`/api/userinfo?token=${encodeURIComponent(state.authToken)}`);
      if (r.ok) {
        const info = await r.json();
        state.userInfo = info;
        updateAccountCard(info);
        // Giriş başarılı, overlay kapanacak (updateAccountCard hallediyor ama garanti olsun)
        if($('loginOverlay')) $('loginOverlay').style.display = 'none';
      } else {
        // Token geçersizse overlay açık kalsın
        if($('loginOverlay')) $('loginOverlay').style.display = 'flex';
      }
    } catch (_) {
      if($('loginOverlay')) $('loginOverlay').style.display = 'flex';
    }
  } else {
    // Hiç token yoksa overlay açık kalsın
    if($('loginOverlay')) $('loginOverlay').style.display = 'flex';
  }

  // ── Olay dinleyicileri ──

  // Tarayıcı ile giriş (Overlay üzerindeki buton)
  if ($('btnOverlayLogin')) {
    $('btnOverlayLogin').addEventListener('click', performBrowserLogin);
  }

  // Hesap kartı bağlantısı
  if ($('acctLoginLink')) {
    $('acctLoginLink').addEventListener('click', () => {
      if($('loginOverlay')) $('loginOverlay').style.display = 'flex';
    });
  }
  
  // Yardım Modali (Token Nasıl Alınır?)
  if ($('lbHelpLink')) {
    $('lbHelpLink').addEventListener('click', (e) => {
      e.preventDefault();
      $('helpModal').style.display = 'flex';
    });
  }
  if ($('modalClose')) {
    $('modalClose').addEventListener('click', () => {
      $('helpModal').style.display = 'none';
    });
  }

  // Çıkış Yap
  if ($('btnLogout')) {
    $('btnLogout').addEventListener('click', () => {
      localStorage.removeItem('twitch_token');
      window.location.reload();
    });
  }

  // Bot butonları
  $('btnStart').addEventListener('click', startBot);
  $('btnStop').addEventListener('click',  stopBot);
  $('btnReset').addEventListener('click', forceReset);
  $('btnRestartServer').addEventListener('click', restartServer);

  // Log toggle
  $('logToggle').addEventListener('click', toggleLog);

  // Log temizle
  $('btnClear').addEventListener('click', () => {
    $('logConsole').innerHTML = '';
    state.logCount = 0;
    $('logCount').textContent = 0;
    addLog('info', 'Log konsolu temizlendi.');
  });

  // Log sabitle
  $('btnPause').addEventListener('click', () => {
    state.logPaused = !state.logPaused;
    $('btnPause').classList.toggle('active', state.logPaused);
    $('btnPause').textContent = state.logPaused ? '▶ Serbest' : '⏸ Sabitle';
  });

  // Escape ile panel kapat
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Artık token panel yok, varsa başka modallar buraya eklenebilir
    }
  });
});
