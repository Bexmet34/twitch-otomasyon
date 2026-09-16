# 🎮 Twitch Drops Bot – Albion Online

Playwright tabanlı, **headless Chromium** kullanan Twitch Drop otomatik toplayıcı. Web tabanlı yönetim paneli ile başlat/durdur, canlı log izle.

---

## ⚡ Hızlı Kurulum

### 1. Gereksinimler
- [Node.js 18+](https://nodejs.org/)

### 2. Bağımlılıkları Yükle

```bash
npm install
```

### 3. Playwright Chromium Tarayıcısını İndir

```bash
npx playwright install chromium
```

### 4. Botu Başlat

```bash
node server.js
```

Tarayıcıda şunu aç: **http://localhost:3000**

---

## 🔑 Twitch Auth-Token Nasıl Alınır?

1. Twitch.tv'ye tarayıcından giriş yap.
2. `F12` → **Application** sekmesi → **Cookies** → `https://www.twitch.tv`
3. `auth-token` adlı çerezi bul → **Value** sütununu kopyala.
4. Paneldeki alana yapıştır.

> ⚠️ **Token'ını kimseyle paylaşma.** Hesabına tam erişim sağlar.

---

## 🎛️ Yönetim Paneli Özellikleri

| Özellik | Açıklama |
|---------|----------|
| **Canlı Log** | Tüm bot olayları gerçek zamanlı akış |
| **Durum Göstergesi** | Çalışıyor / Durdu rozeti |
| **İstatistikler** | Aktif kanal, toplanan drop sayısı, çalışma süresi |
| **Başlat / Durdur** | Tek tıkla bot kontrolü |
| **Log Sabitle** | Kaydırmayı dondurarak geçmiş loglara bak |

---

## ⚙️ Nasıl Çalışır?

1. **Headless Chromium** açılır, auth-token çerezi yüklenir.
2. Albion Online kategorisinde `DropsEnabled` etiketli aktif yayın bulunur.
3. Video kalitesi en düşüğe alınır (bant tasarrufu).
4. Her **15 dakikada bir** envanter sayfası kontrol edilir.
5. "Claim Now" butonu görünürse otomatik tıklanır.
6. Yayın biterse / hata oluşursa otomatik yeniden bağlanır.

---

## 📁 Proje Yapısı

```
twitch-otomasyon/
├── bot.js          ← Drop toplama motoru
├── server.js       ← Express + WebSocket sunucusu
├── public/
│   ├── index.html  ← Yönetim paneli
│   ├── style.css   ← Dark glassmorphism tasarım
│   └── app.js      ← Frontend mantığı
├── .env.example    ← Ortam değişkenleri örneği
└── package.json
```

---

## ⚠️ Yasal Uyarı

Bu araç yalnızca eğitim ve kişisel kullanım amaçlıdır. Twitch Hizmet Koşulları'nı ihlal edebilir. Sorumluluğu kullanıcıya aittir.
