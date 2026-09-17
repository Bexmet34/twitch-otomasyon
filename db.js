import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.json');

class Database {
  constructor() {
    this.data = { users: [], licenses: [] };
  }
  
  async load() {
    try {
      const fileData = await fs.readFile(DB_FILE, 'utf8');
      this.data = JSON.parse(fileData);
    } catch (e) {
      // Dosya yoksa oluştur
      await this.save();
    }
  }

  async save() {
    await fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2));
  }

  getUsers() {
    return this.data.users;
  }
  
  getUser(login) {
    return this.data.users.find(u => u.login === login);
  }

  async addUser(user) {
    // user: { id, login, display_name, token, profile_image_url, isRunning, email, password, expiresAt }
    const exists = this.data.users.find(u => u.login === user.login);
    if (exists) {
      // Güncelle
      Object.assign(exists, user);
    } else {
      // Yeni ekle
      this.data.users.push({ ...user, isRunning: false });
    }
    await this.save();
    return this.getUser(user.login);
  }

  async updateUser(user) {
    const exists = this.getUser(user.login);
    if (exists) {
      Object.assign(exists, user);
      await this.save();
    }
  }

  async removeUser(login) {
    this.data.users = this.data.users.filter(u => u.login !== login);
    await this.save();
  }

  async updateStatus(login, isRunning) {
    const u = this.data.users.find(x => x.login === login);
    if (u) {
      u.isRunning = isRunning;
      await this.save();
    }
  }

  // ── LİSANS YÖNETİMİ ──
  
  getLicenses() {
    return this.data.licenses || [];
  }

  async addLicense(code, durationDays) {
    if (!this.data.licenses) this.data.licenses = [];
    this.data.licenses.push({ code, durationDays, used: false, usedBy: null, createdAt: Date.now() });
    await this.save();
    return code;
  }

  async useLicense(code, login) {
    if (!this.data.licenses) return null;
    const lic = this.data.licenses.find(l => l.code === code && !l.used);
    if (lic) {
      lic.used = true;
      lic.usedBy = login;
      await this.save();
      return lic.durationDays || 30; // Varsayılan 30 gün
    }
    return null;
  }
}

export const db = new Database();
