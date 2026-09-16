const $ = id => document.getElementById(id);
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function formatUptime(startedAt) {
  if(!startedAt) return '—';
  const d = Date.now() - new Date(startedAt).getTime();
  const h = String(Math.floor(d / 3600000)).padStart(2,'0');
  const m = String(Math.floor((d % 3600000) / 60000)).padStart(2,'0');
  return `${h}:${m}`;
}

let checkInterval = null;

async function fetchStats(login) {
  try {
    const res = await fetch(`/api/mystats/${login}`);
    if (res.status === 404) {
      alert("Bu Twitch adına sahip aktif bir bot bulunamadı.");
      clearInterval(checkInterval);
      return;
    }
    const data = await res.json();
    renderStats(data);
  } catch(e) {
    console.error(e);
  }
}

function renderStats(u) {
  const card = $('statsCard');
  card.style.display = 'block';
  
  const s = u.stats || {};
  card.innerHTML = `
    <div class="uc-header">
      <img class="uc-avatar" src="${esc(u.profile_image_url) || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22%23333%22/></svg>'}" />
      <div style="flex:1;">
        <div class="uc-name">${esc(u.display_name)}</div>
        <div class="uc-status ${u.isRunning ? 'online' : ''}" style="display:inline-block; margin-top:5px;">
          ${u.isRunning ? 'Bot Aktif ve Çalışıyor' : 'Bot Durduruldu'}
        </div>
      </div>
    </div>
    
    <div class="uc-stats">
      <div class="uc-stat-col">
        <span>İzlenen Kanal</span>
        <span class="uc-stat-val">${s.currentChannel ? esc(s.currentChannel) : '—'}</span>
      </div>
      <div class="uc-stat-col">
        <span>Toplanan Ödül</span>
        <span class="uc-stat-val">${s.claimedCount || 0}</span>
      </div>
      <div class="uc-stat-col">
        <span>Çalışma Süresi</span>
        <span class="uc-stat-val">${formatUptime(s.startedAt)}</span>
      </div>
    </div>

    <div style="margin-top: 15px; font-size: 0.9rem; color: var(--text-muted);">
      <div>Güncel Drop Hedefi: ${s.dropName ? esc(s.dropName) : 'Aranıyor...'}</div>
      <div class="uc-progress-bar">
        <div class="uc-progress-fill" style="width: ${s.dropProgress || 0}%"></div>
      </div>
      <div style="text-align:right; margin-top:5px; font-weight:bold;">%${s.dropProgress || 0}</div>
    </div>
  `;
}

$('btnCheck').addEventListener('click', () => {
  const login = $('usernameInput').value.trim().toLowerCase();
  if (!login) return alert("Lütfen Twitch adınızı girin!");
  
  $('btnCheck').textContent = 'Sorgulanıyor...';
  
  // İlk veri çekimi
  fetchStats(login).then(() => {
    $('btnCheck').textContent = 'Durumu Sorgula';
    
    // 5 saniyede bir canı olarak güncelle
    clearInterval(checkInterval);
    checkInterval = setInterval(() => fetchStats(login), 5000);
  });
});

$('usernameInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') $('btnCheck').click();
});
