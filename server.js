require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TokenManager = require('./tokenManager');
const app = express();
const PORT = 3000;

// -----------------------------------------------------------------------------
// 🔧 API BASE URLs
// -----------------------------------------------------------------------------
const API_V1 = 'https://api.bluebeam.com/publicapi/v1';
const API_V2 = 'https://api.bluebeam.com/publicapi/v2';

const CLIENT_ID = process.env.BB_CLIENT_ID;

// -----------------------------------------------------------------------------
// DEMO CONSTANTS
// -----------------------------------------------------------------------------

// Markup Dashboard (v2)
const MARKUP_SESSION_ID = '515-659-145';
const MARKUP_FILE_ID = '98061063';
const MARKUP_FILE_NAME = 'Chicago Office Complete Document (API Demo).pdf';

// Closeout Demo (v1)
const CLOSEOUT_PROJECT_ID = '564-177-023';
const CLOSEOUT_SESSION_ID = '693-759-210';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ESM fetch wrapper
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const tokenManager = new TokenManager();

// -----------------------------------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    markupSessionId: MARKUP_SESSION_ID,
    markupFileId: MARKUP_FILE_ID,
    closeoutSessionId: CLOSEOUT_SESSION_ID,
    closeoutProjectId: CLOSEOUT_PROJECT_ID
  });
});

// -----------------------------------------------------------------------------
// 📊 MARKUP API ENDPOINT (v2)
// -----------------------------------------------------------------------------
app.get('/powerbi/markups', async (req, res) => {
  try {
    const accessToken = await tokenManager.getValidAccessToken();

    const response = await fetch(
      `${API_V2}/sessions/${MARKUP_SESSION_ID}/files/${MARKUP_FILE_ID}/markups`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          client_id: CLIENT_ID,
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch markups: ${response.status}`);
    }

    const raw = await response.json();
    const markups = raw.Markups || [];

    const flattened = markups.map((m) => ({
      MarkupId: m.Id,
      FileName: MARKUP_FILE_NAME,
      FileId: MARKUP_FILE_ID,
      SessionId: MARKUP_SESSION_ID,
      Type: m.Type,
      Subject: m.Subject,
      Comment: m.Comment,
      Author: m.Author,
      DateCreated: m.DateCreated,
      Page: m.Page,
      Status: m.Status
    }));

    res.json(flattened);
  } catch (e) {
    console.error("❌ /powerbi/markups error:", e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// ⭐ NEW FUNCTION — AUTO-DISCOVER PROJECT FILE ID
// -----------------------------------------------------------------------------
async function getProjectFileIdByName(accessToken, fileName) {
  const url = `${API_V1}/projects/${CLOSEOUT_PROJECT_ID}/files`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      client_id: CLIENT_ID,
      Accept: "application/json"
    }
  });

  if (!resp.ok) {
    throw new Error(`Failed to list project files: ${resp.status} - ${await resp.text()}`);
  }

  const raw = await resp.json();
  const files = raw.Files || [];

  const match = files.find(f => f.Name === fileName);

  return match ? match.Id : null;
}

// -----------------------------------------------------------------------------
// ⭐ NEW ENDPOINT — INITIALIZE CLOSEOUT: LIST SESSION FILE + FIND PROJECT FILE ID
// -----------------------------------------------------------------------------
app.get('/api/closeout/files', async (req, res) => {
  try {
    const accessToken = await tokenManager.getValidAccessToken();

    // 1️⃣ Get Session Files
    const sessionUrl = `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files`;

    const sessResp = await fetch(sessionUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        Accept: 'application/json'
      }
    });

    if (!sessResp.ok) {
      throw new Error(`Failed to fetch session files: ${sessResp.status} - ${await sessResp.text()}`);
    }

    const sessionRaw = await sessResp.json();
    const sessionFiles = sessionRaw.Files || [];

    if (sessionFiles.length === 0) {
      return res.json([]);
    }

    // Demo assumes only ONE file in the Session
    const sessionFile = sessionFiles[0];

    // 2️⃣ Auto-discover matching project file by filename
    const projectFileId = await getProjectFileIdByName(accessToken, sessionFile.Name);

    const mapped = [{
      fileName: sessionFile.Name,
      sessionFileId: sessionFile.Id,
      projectFileId // may be null
    }];

    res.json(mapped);

  } catch (e) {
    console.error("❌ /api/closeout/files error:", e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// 📁 CLOSEOUT FILE FLOW (Update Project Copy → Remove from Session → Final Check-in)
// -----------------------------------------------------------------------------
app.post('/api/closeout-file', async (req, res) => {
  try {
    const { sessionFileId, projectFileId } = req.body;

    if (!sessionFileId) throw new Error("Missing sessionFileId.");
    if (!projectFileId) throw new Error("Missing projectFileId — cannot close out this file.");

    const accessToken = await tokenManager.getValidAccessToken();

    // -------------------------------------------------------------------------
    // 1️⃣ Update project copy: POST /sessions/{sessionId}/files/{id}/checkin
    // -------------------------------------------------------------------------
    const updateUrl = `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files/${sessionFileId}/checkin`;

    const updateResp = await fetch(updateUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Comment: "Syncing changes to Project copy" })
    });

    if (!updateResp.ok) {
      throw new Error(`Step 1 failed: ${updateResp.status} - ${await updateResp.text()}`);
    }

    // -------------------------------------------------------------------------
    // 2️⃣ Remove file from session
    // -------------------------------------------------------------------------
    const deleteUrl = `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files/${sessionFileId}`;

    const deleteResp = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID
      }
    });

    if (!deleteResp.ok) {
      throw new Error(`Step 2 failed: ${deleteResp.status} - ${await deleteResp.text()}`);
    }

    // -------------------------------------------------------------------------
    // 3️⃣ Final check-in to project
    // -------------------------------------------------------------------------
    const checkinUrl = `${API_V1}/projects/${CLOSEOUT_PROJECT_ID}/files/${projectFileId}/checkin`;

    const checkinResp = await fetch(checkinUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Comment: "Automated closeout" })
    });

    if (!checkinResp.ok) {
      throw new Error(`Step 3 failed: ${checkinResp.status} - ${await checkinResp.text()}`);
    }

    res.json({ success: true });

  } catch (e) {
    console.error("❌ Closeout error:", e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Bluebeam API Demo running at http://localhost:${PORT}`);
});
