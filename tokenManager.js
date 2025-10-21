// tokenManager.js
const sqlite3 = require('sqlite3').verbose();
const qs = require('querystring');

class TokenManager {
  constructor(dbPath = 'tokens.db') {
    this.dbPath = dbPath;
    this.clientId = process.env.BB_CLIENT_ID;
    this.clientSecret = process.env.BB_CLIENT_SECRET;
    this.db = null;
    this.initPromise = this._initDb();
  }

  // ESM-compatible fetch wrapper
  fetch(...args) {
    return import('node-fetch').then(({ default: fetch }) => fetch(...args));
  }

  async _initDb() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) reject(err);
        else {
          this.db.run(`
            CREATE TABLE IF NOT EXISTS tokens (
              id INTEGER PRIMARY KEY,
              refresh_token TEXT,
              access_token TEXT,
              expires_at INTEGER
            )
          `, (err) => {
            if (err) reject(err);
            else {
              console.log('✅ Token database initialized');
              resolve();
            }
          });
        }
      });
    });
  }

  async saveTokens(accessToken, refreshToken, expiresIn) {
    await this.initPromise;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('DELETE FROM tokens');
        this.db.run(
          'INSERT INTO tokens (refresh_token, access_token, expires_at) VALUES (?, ?, ?)',
          [refreshToken, accessToken, expiresAt],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  async getTokens() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT access_token, refresh_token, expires_at FROM tokens LIMIT 1',
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  async refreshAccessToken(refreshToken) {
    const tokenUrl = 'https://api.bluebeam.com/oauth2/token';
    const payload = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret
    };

    const fetch = await this.fetch;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: qs.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data;
  }

  async getValidAccessToken() {
    await this.initPromise;
    const tokens = await this.getTokens();

    // If no tokens exist, bootstrap from environment variable
    if (!tokens) {
      console.log('⚠️ No tokens in database, bootstrapping from environment...');
      const initialRefreshToken = process.env.BB_REFRESH_TOKEN;

      if (!initialRefreshToken) {
        throw new Error('No tokens in database and no BB_REFRESH_TOKEN in environment');
      }

      const newTokens = await this.refreshAccessToken(initialRefreshToken);
      await this.saveTokens(
        newTokens.access_token,
        newTokens.refresh_token,
        newTokens.expires_in
      );

      console.log('🔐 Initial tokens saved to database');
      return newTokens.access_token;
    }

    // Check if access token is still valid (with 5 min buffer)
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expires_at > now + 300) {
      console.log('✅ Using cached access token');
      return tokens.access_token;
    }

    // Token expired, refresh it
    console.log('🔄 Access token expired, refreshing...');
    const newTokens = await this.refreshAccessToken(tokens.refresh_token);
    await this.saveTokens(
      newTokens.access_token,
      newTokens.refresh_token,
      newTokens.expires_in
    );

    // 👇 Added detailed log
    console.log(`🔁 Token refreshed successfully at ${new Date().toISOString()}`);
    console.log(`   🔸 Expires in: ${(newTokens.expires_in / 60).toFixed(1)} minutes`);
    console.log(`   🔸 Access token preview: ${newTokens.access_token?.slice(0, 25)}...`);

    console.log('🔐 Access token refreshed and saved');
    return newTokens.access_token;
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = TokenManager;
