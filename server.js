// ============================================================
//  Twitch Drops Bot – Çoklu Müşteri (SaaS) Yönetim Sunucusu (server.js)
// ============================================================

import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { TwitchDropsBot, initSharedBrowser } from './bot.js';
import { db } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_PASS = 'admin123'; // Admin şifresi

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── CORS ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://www.twitch.tv');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── BOT MANAGER ──
const bots = new Map(); 

function makeLogger(login) {
  return (level, message) => {
    const time = new Date().toLocaleTimeString('tr-TR');
    console.log(`[${time}] [${login}] [${level.toUpperCase()}] ${message}`);
    broadcast({ type: 'log', login, level, message, time });
  };
}

async function startBotForUser(user) {
  if (bots.has(user.login)) return bots.get(user.login);
  if (user.expiresAt && user.expiresAt < Date.now()) return; // Süresi bitmiş

  const logger = makeLogger(user.login);
  const bot = new TwitchDropsBot({ login: user.login, authToken: user.token, log: logger });
  bots.set(user.login, bot);
  await db.updateStatus(user.login, true);
  bot.start().catch(err => {
    logger('error', `Bot başlatılırken hata: ${err.message}`);
    bot.stop();
    bots.delete(user.login);
    db.updateStatus(user.login, false);
  });
  return bot;
}

async function stopBotForUser(login) {
  const bot = bots.get(login);
  if (bot) {
    bot.running = false;
    await bot.stop().catch(() => {});
    bots.delete(login);
  }
  await db.updateStatus(login, false);
}

// ── ADMIN GÜVENLİĞİ MIDDLEWARE ──
function requireAdmin(req, res, next) {
  const pass = req.headers['x-admin-password'];
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  next();
}

// ── MÜŞTERİ (PUBLİC) API'LERİ ──

// Müşteri Kayıt (Landing Page'den gelen istek)
app.post('/api/register', async (req, res) => {
  const { email, password, token, licenseCode } = req.body;
  if (!email || !password || !token || !licenseCode) return res.status(400).json({ error: 'E-posta, şifre, token ve Lisans Kodu gereklidir.' });

  try {
    const hRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` }
    }).catch(() => null);

    if (!hRes || !hRes.ok) throw new Error('Geçersiz veya süresi dolmuş Twitch hesabı (Auth-Token hatalı).');
    const vData = await hRes.json();
    const client_id = vData.client_id;
    const user_id = vData.user_id;
    const login = vData.login;

    // Lisansı kontrol et ve kullan
    const durationDays = await db.useLicense(licenseCode, login);
    if (!durationDays) throw new Error('Geçersiz veya daha önce kullanılmış Lisans Kodu!');

    let profile = { login: login, display_name: login };
    const uRes = await fetch(`https://api.twitch.tv/helix/users?id=${user_id}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': client_id }
    }).catch(() => null);

    if (uRes && uRes.ok) {
      const uData = await uRes.json();
      if (uData.data && uData.data[0]) profile = uData.data[0];
    }

    // Süre hesaplama
    let user = db.getUser(login);
    let currentExpires = user && user.expiresAt > Date.now() ? user.expiresAt : Date.now();
    const newExpiresAt = currentExpires + (durationDays * 24 * 60 * 60 * 1000);

    const newUser = await db.addUser({
      id: user_id,
      login: profile.login,
      display_name: profile.display_name,
      profile_image_url: profile.profile_image_url || '',
      token: token,
      email: email.toLowerCase(),
      password: Buffer.from(password).toString('base64'), // Çok basit şifreleme (demo için)
      expiresAt: newExpiresAt
    });

    await startBotForUser(newUser);

    res.json({ ok: true, login: newUser.login, expiresAt: newUser.expiresAt, message: 'Kayıt başarılı, botunuz başlatıldı.' });
    broadcast({ type: 'refresh_users' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Müşteri Giriş (Login)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre giriniz.' });
  
  const encPass = Buffer.from(password).toString('base64');
  const user = db.getUsers().find(u => u.email === email.toLowerCase() && u.password === encPass);
  
  if (!user) return res.status(401).json({ error: 'Hatalı e-posta veya şifre.' });
  
  res.json({ ok: true, login: user.login });
});

// Müşterinin Kendi İstatistiğini Görmesi
app.get('/api/mystats/:login', (req, res) => {
  const { login } = req.params;
  const user = db.getUser(login);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  
  const bot = bots.get(login);
  res.json({
    login: user.login,
    display_name: user.display_name,
    profile_image_url: user.profile_image_url,
    isRunning: user.isRunning,
    expiresAt: user.expiresAt,
    stats: bot ? bot.getStats() : null
  });
});


// ── ADMIN API'LERİ ──

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.getUsers().map(u => {
    const bot = bots.get(u.login);
    return { ...u, stats: bot ? bot.getStats() : null };
  });
  res.json(users);
});

app.delete('/api/admin/users/:login', requireAdmin, async (req, res) => {
  const { login } = req.params;
  await stopBotForUser(login);
  await db.removeUser(login);
  res.json({ ok: true });
  broadcast({ type: 'refresh_users' });
});

app.post('/api/admin/start/:login', requireAdmin, async (req, res) => {
  const { login } = req.params;
  const user = db.getUser(login);
  if (!user) return res.status(404).json({ error: 'Bulunamadı' });
  if (user.expiresAt && user.expiresAt < Date.now()) return res.status(400).json({ error: 'Süresi bitmiş' });
  
  await startBotForUser(user);
  res.json({ ok: true });
  broadcast({ type: 'refresh_users' });
});

app.post('/api/admin/stop/:login', requireAdmin, async (req, res) => {
  const { login } = req.params;
  await stopBotForUser(login);
  res.json({ ok: true });
  broadcast({ type: 'refresh_users' });
});

app.post('/api/admin/restart', requireAdmin, (req, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(1), 1000);
});

// Lisans Kodları (Süreli)
app.get('/api/admin/licenses', requireAdmin, (req, res) => {
  res.json(db.getLicenses());
});

app.post('/api/admin/licenses', requireAdmin, async (req, res) => {
  const amount = parseInt(req.body.amount) || 1;
  const duration = parseInt(req.body.duration) || 30; // Varsayılan 30 Gün
  
  const codes = [];
  const prefix = duration === 7 ? '7D-' : duration === 30 ? '1M-' : duration === 90 ? '3M-' : 'XX-';
  
  for (let i = 0; i < amount; i++) {
    const randomStr = Math.random().toString(36).substring(2, 13).toUpperCase().padEnd(11, '0');
    const code = prefix + randomStr; // Örn: 1M-XXXXXXXXXXX (14 karakter)
    await db.addLicense(code, duration);
    codes.push(code);
  }
  res.json({ ok: true, codes });
});


// ── LİSANS SÜRESİ KONTROLCÜSÜ (CRON) ──
setInterval(async () => {
  const users = db.getUsers();
  for (const u of users) {
    if (u.isRunning && u.expiresAt && u.expiresAt < Date.now()) {
      const logger = makeLogger(u.login);
      logger('error', `LİSANS SÜRESİ DOLDU! Bot durduruluyor... Lütfen lisansınızı yenileyin.`);
      await stopBotForUser(u.login);
    }
  }
}, 60000); // Her dakika kontrol et


// ── BAŞLATMA ve WEBSOCKET ──

const server = app.listen(PORT, async () => {
  console.log(`[SİSTEM] Web panel http://localhost:${PORT} üzerinde çalışıyor.`);
  await db.load();
  await initSharedBrowser();
  const users = db.getUsers();
  for (const u of users) {
    if (u.isRunning && (!u.expiresAt || u.expiresAt > Date.now())) {
      await startBotForUser(u);
    } else if (u.isRunning && u.expiresAt && u.expiresAt < Date.now()) {
      await stopBotForUser(u.login);
    }
  }
});

const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', ws => {
  clients.add(ws);
  
  ws.on('message', msg => {
    try {
       const data = JSON.parse(msg);
       if (data.type === 'auth') {
          ws.targetLogin = data.login;
          ws.isAdmin = (data.password === ADMIN_PASS);
       }
    } catch(e) {}
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const c of clients) {
    if (c.readyState === 1) {
       // Admin her şeyi görür. Müşteri sadece kendi loglarını ve genel statları görür.
       if (c.isAdmin) {
          c.send(payload);
       } else if (data.type === 'log') {
          if (c.targetLogin === data.login) c.send(payload);
       } else if (data.type === 'all_stats') {
          const myStat = data.data.find(x => x.login === c.targetLogin);
          if (myStat) c.send(JSON.stringify({ type: 'my_stat', data: myStat }));
       } else {
          c.send(payload);
       }
    }
  }
}

// İstatistikleri düzenli olarak panele gönder
setInterval(() => {
  const statsUpdate = db.getUsers().map(u => {
    const bot = bots.get(u.login);
    return { login: u.login, isRunning: u.isRunning, stats: bot ? bot.getStats() : null };
  });
  broadcast({ type: 'all_stats', data: statsUpdate });
}, 5000);
