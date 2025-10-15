require('dotenv').config();
const express = require('express');
const cors = require('cors');
const qs = require('querystring');
const app = express();
const PORT = 3000;

const API_BASE = 'https://api.bluebeam.com/publicapi/v2';
const CLIENT_ID = process.env.BB_CLIENT_ID;
const CLIENT_SECRET = process.env.BB_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.BB_REFRESH_TOKEN;
const SESSION_ID = '928-286-044';
const FILE_ID = '96495009';
const FILE_NAME = 'Conceptual Design Set_20251008.pdf';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// 🔁 Refresh Access Token
async function refreshAccessToken() {
  const response = await fetch('https://api.bluebeam.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs.stringify({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('🔐 Access token refreshed');
  return data.access_token;
}

// 🔍 Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', sessionId: SESSION_ID, fileId: FILE_ID });
});

// 📊 Flattened Markups
app.get('/powerbi/markups', async (req, res) => {
  try {
    const accessToken = await refreshAccessToken();

    const response = await fetch(`${API_BASE}/sessions/${SESSION_ID}/files/${FILE_ID}/markups`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to get markups: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const markups = data.Markups || [];

    const flattened = markups.map(m => ({
      MarkupId: m.Id || m.markupId || null,
      FileName: FILE_NAME,
      FileId: FILE_ID,
      SessionId: SESSION_ID,
      Type: m.Type || m.type || null,
      Subject: m.Subject || m.subject || null,
      Comment: m.Comment || m.comment || null,
      Author: m.Author || m.displayName || null,
      DateCreated: m.DateCreated || m.created || null,
      Page: m.Page || m.pageNumber || null
    }));

    res.json(flattened);
  } catch (error) {
    console.error('❌ Error in /powerbi/markups:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🟢 NEW: Statuses endpoint
app.get('/powerbi/statuses', async (req, res) => {
  try {
    const accessToken = await refreshAccessToken();

    const response = await fetch(`${API_BASE}/sessions/${SESSION_ID}/files/${FILE_ID}/statuses`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to get statuses: ${response.status} - ${errText}`);
    }

    const data = await response.json(); // array of statuses

    const counts = {};
    for (const status of data) {
      const label = status.State || 'Unknown';
      counts[label] = (counts[label] || 0) + 1;
    }

    res.json(counts);
  } catch (error) {
    console.error('❌ Error in /powerbi/statuses:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
