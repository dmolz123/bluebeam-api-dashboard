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

// Markup Dashboard Demo (v2)
const MARKUP_SESSION_ID = '515-659-145';
const MARKUP_FILE_ID = '98061063';
const MARKUP_FILE_NAME = 'Chicago Office Complete Document (API Demo).pdf';

// Closeout Demo (v1)
const CLOSEOUT_PROJECT_ID = '564-177-023';
const CLOSEOUT_SESSION_ID = '693-759-210';

// ** HARD-CODED PROJECT FILE ID FOR DEMO **
const CLOSEOUT_PROJECT_FILE_ID = 368115993;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ESM-compatible fetch wrapper
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
    closeoutProjectId: CLOSEOUT_PROJECT_ID,
    projectFileId: CLOSEOUT_PROJECT_FILE_ID
  });
});

// -----------------------------------------------------------------------------
// 📊 MARKUP API DASHBOARD (v2) — RESTORED FULL FUNCTIONALITY
// -----------------------------------------------------------------------------
app.get('/powerbi/markups', async (req, res) => {
  try {
    console.log(
      `📊 Fetching markups for session ${MARKUP_SESSION_ID}, file ${MARKUP_FILE_ID}...`
    );

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
      const errText = await response.text();
      throw new Error(
        `Failed to get markups: ${response.status} - ${errText}`
      );
    }

    const data = await response.json();
    const markups = data.Markups || data || [];

    // ⬇ RESTORED your original flattening logic
    const flattened = markups.map(m => ({
      MarkupId: m.Id || m.markupId || null,
      FileName: MARKUP_FILE_NAME,
      FileId: MARKUP_FILE_ID,
      SessionId: MARKUP_SESSION_ID,
      Type: m.Type || m.type || null,
      Subject: m.Subject || m.subject || null,
      Comment: m.Comment || m.comment || null,
      Author: m.Author || m.displayName || null,
      DateCreated: m.DateCreated || m.created || null,
      DateModified: m.DateModified || m.modified || null,
      Page: m.Page || m.pageNumber || null,
      Status: m.Status || m.status || null,
      Color: m.Color || null,
      Layer: m.Layer || null
    }));

    console.log(`✅ Returning ${flattened.length} markups`);
    res.json(flattened);

  } catch (err) {
    console.error('❌ Error in /powerbi/markups:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 📁 LIST FILES IN CLOSEOUT SESSION (v1)
// -----------------------------------------------------------------------------
app.get('/api/closeout/files', async (req, res) => {
  try {
    console.log(`📂 Listing files for session ${CLOSEOUT_SESSION_ID}`);

    const accessToken = await tokenManager.getValidAccessToken();

    const response = await fetch(
      `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          client_id: CLIENT_ID,
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Failed to fetch files for session: ${response.status} - ${err}`
      );
    }

    const json = await response.json();
    const files = json.Files || [];

    const mapped = files.map(f => ({
      fileName: f.Name || "Unknown File",
      sessionFileId: f.Id,
      projectFileId: CLOSEOUT_PROJECT_FILE_ID   // <-- HARD CODED
    }));

    console.log(`✅ Found ${mapped.length} file(s)`);
    res.json(mapped);

  } catch (err) {
    console.error('❌ /api/closeout/files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 📁 CLOSEOUT FLOW — Update → Remove → Final Checkin (v1)
// -----------------------------------------------------------------------------
app.post('/api/closeout-file', async (req, res) => {
  try {
    const { sessionFileId } = req.body;

    if (!sessionFileId) {
      throw new Error('Missing sessionFileId');
    }

    const projectFileId = CLOSEOUT_PROJECT_FILE_ID; // <-- FORCE USING THIS ID
    const accessToken = await tokenManager.getValidAccessToken();

    console.log(
      `🚀 Starting closeout: sessionFile=${sessionFileId}, projectFile=${projectFileId}`
    );

    // -------------------------------------------------------------------------
    // 1️⃣ UPDATE PROJECT COPY
    // -------------------------------------------------------------------------
    const updateUrl = `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files/${sessionFileId}/checkin`;

    console.log(`🔧 Step 1 → Updating project copy: ${updateUrl}`);

    const updateResp = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Comment: "Sync from Session before removal" })
    });

    if (!updateResp.ok) {
      throw new Error(
        `Step 1 failed: ${updateResp.status} - ${await updateResp.text()}`
      );
    }

    console.log('✅ Step 1 complete');

    // -------------------------------------------------------------------------
    // 2️⃣ REMOVE FROM SESSION
    // -------------------------------------------------------------------------
    const deleteUrl = `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files/${sessionFileId}`;

    console.log(`🗑️ Step 2 → Removing file: ${deleteUrl}`);

    const deleteResp = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID
      }
    });

    if (!deleteResp.ok) {
      throw new Error(
        `Step 2 failed: ${deleteResp.status} - ${await deleteResp.text()}`
      );
    }

    console.log('✅ Step 2 complete');

    // -------------------------------------------------------------------------
    // 3️⃣ FINAL CHECK-IN TO PROJECT
    // -------------------------------------------------------------------------
    const checkinUrl = `${API_V1}/projects/${CLOSEOUT_PROJECT_ID}/files/${projectFileId}/checkin`;

    console.log(`📥 Step 3 → Final check-in: ${checkinUrl}`);

    const finalResp = await fetch(checkinUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Comment: "Automated final check-in" })
    });

    if (!finalResp.ok) {
      throw new Error(
        `Step 3 failed: ${finalResp.status} - ${await finalResp.text()}`
      );
    }

    console.log("🎉 Closeout completed successfully!");
    res.json({ success: true });

  } catch (err) {
    console.error("❌ Closeout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 API Demo running at http://localhost:${PORT}`);
  console.log(`📄 Markup API (v2): /powerbi/markups`);
  console.log(`📁 Closeout (v1): session ${CLOSEOUT_SESSION_ID}, project ${CLOSEOUT_PROJECT_ID}`);
});
