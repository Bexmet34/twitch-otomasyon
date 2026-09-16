// ============================================================
//  server.js – Express + WebSocket Yönetim Sunucusu
// ============================================================

import express            from 'express';
import { WebSocketServer } from 'ws';
import { createServer }    from 'http';
import { fileURLToPath }   from 'url';
import path                from 'path';
import 'dotenv/config';

import { TwitchDropsBot } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 3000;

const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── WebSocket bağlı istemciler ───────────────────────────────
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  broadcast({ type: 'stats', data: bot ? bot.getStats() : { running: false } });
  ws.on('close', () => clients.delete(ws));
});

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ── Log yayıncısı ────────────────────────────────────────────
function makeLogger() {
  return (level, message) => {
    const entry = { type: 'log', level, message, time: new Date().toLocaleTimeString('tr-TR') };
    broadcast(entry);
    const sym = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅' };
    console.log(`[${entry.time}] ${sym[level] || '•'} ${message}`);
  };
}

// ── Bot instance ─────────────────────────────────────────────
let bot              = null;
let currentAuthToken = null;   // /api/userinfo için token önbelleği

// İstatistik yayını (5 sn'de bir)
setInterval(() => {
  if (bot) broadcast({ type: 'stats', data: bot.getStats() });
}, 5_000);

// ── REST API ─────────────────────────────────────────────────

// Bot başlat
app.post('/api/start', async (req, res) => {
  const { authToken } = req.body;
  if (!authToken || authToken.trim().length < 10)
    return res.status(400).json({ error: 'Geçerli bir auth-token giriniz.' });
  if (bot && bot.running)
    return res.status(409).json({ error: 'Bot zaten çalışıyor.' });

  currentAuthToken = authToken.trim();
  bot = new TwitchDropsBot({ authToken: currentAuthToken, log: makeLogger() });
  bot.start();

  res.json({ ok: true, message: 'Bot başlatıldı.' });
});

// Bot durdur
app.post('/api/stop', async (req, res) => {
  if (!bot || !bot.running)
    return res.status(409).json({ error: 'Bot zaten durmuş.' });
  await bot.stop();
  res.json({ ok: true, message: 'Bot durduruldu.' });
});



// Zorla sıfırla
app.post('/api/reset', async (req, res) => {
  try {
    if (bot) {
      bot.running = false;
      await bot.stop().catch(() => {});
    }
    bot = null;
    broadcast({ type: 'stats', data: { running: false, claimedCount: 0, startedAt: null, currentChannel: null, dropProgress: 0, dropName: null, nextCheckAt: null, inventory: [] } });
    res.json({ ok: true, message: 'Bot sıfırlandı.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sunucuyu (PM2) Yeniden Başlat
app.post('/api/restart-server', (req, res) => {
  res.json({ ok: true, message: 'Sunucu yeniden başlatılıyor...' });
  setTimeout(() => process.exit(1), 1000);
});

// Durum sorgulama
app.get('/api/status', (req, res) => {
  res.json({
    running: bot?.running ?? false,
    stats:   bot?.getStats() ?? {},
  });
});

// Twitch kullanıcı bilgisi (proxy – CORS bypass)
app.get('/api/userinfo', async (req, res) => {
  const token = (req.query.token || currentAuthToken || '').trim();
  if (!token) return res.status(400).json({ error: 'Token gerekli' });

  try {
    // Adım 1: Token'ı doğrula (Client-ID gerekmez)
    const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` },
    });

    if (!valRes.ok) {
      const err = await valRes.json().catch(() => ({}));
      return res.status(401).json({
        error: err.message || 'Token geçersiz veya süresi dolmuş. Twitch\'ten yeni auth-token kopyala.',
      });
    }

    const { client_id, user_id, login } = await valRes.json();

    // Adım 2: GQL ile tam profil bilgisi (avatar dahil)
    const gqlRes = await fetch('https://gql.twitch.tv/gql', {
      method:  'POST',
      headers: {
        'Authorization': `OAuth ${token}`,
        'Client-Id':     client_id,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        query: `{ currentUser { id login displayName profileImageURL(width:300) createdAt roles { isPartner isAffiliate } } }`,
      }),
    });

    let profile = { login, display_name: login, id: user_id };

    if (gqlRes.ok) {
      const gqlData = await gqlRes.json().catch(() => []);
      const user    = Array.isArray(gqlData) ? gqlData[0]?.data?.currentUser : null;
      if (user) {
        profile = {
          id:                user_id,
          login:             user.login             || login,
          display_name:      user.displayName       || login,
          profile_image_url: user.profileImageURL   || null,
          view_count:        user.channel?.views    || 0,
          broadcaster_type:  user.roles?.isPartner  ? 'partner'
                           : user.roles?.isAffiliate ? 'affiliate' : '',
          created_at:        user.createdAt         || null,
        };
      }
    }

    // GQL başarısız olduysa helix'i dene
    if (!profile.profile_image_url) {
      const hRes = await fetch(
        `https://api.twitch.tv/helix/users?id=${user_id}`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': client_id } }
      ).catch(() => null);
      if (hRes?.ok) {
        const hData = await hRes.json().catch(() => ({}));
        const u     = hData.data?.[0];
        if (u) profile = { ...profile, ...u };
      }
    }

    currentAuthToken = token;
    res.json(profile);

  } catch (err) {
    res.status(500).json({ error: `Sunucu hatası: ${err.message}` });
  }
});

// ── Sunucu ───────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🎮 Twitch Drops Bot – Yönetim Paneli  ║
  ║   🌐 http://localhost:${PORT}              ║
  ╚══════════════════════════════════════════╝
  `);
});
