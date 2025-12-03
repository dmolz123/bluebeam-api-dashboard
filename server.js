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
const CLIENT_SECRET = process.env.BB_CLIENT_SECRET;

// -----------------------------------------------------------------------------
// DEMO CONSTANTS
// -----------------------------------------------------------------------------

// Markup dashboard demo (v2)
const MARKUP_SESSION_ID = '515-659-145';
const MARKUP_FILE_ID = '98061063';
const MARKUP_FILE_NAME = 'Chicago Office Complete Document (API Demo).pdf';

// Closeout demo (v1)
const CLOSEOUT_PROJECT_ID = '564-177-023';
const CLOSEOUT_SESSION_ID = '693-759-210';

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
    closeoutSession: CLOSEOUT_SESSION_ID,
    closeoutProject: CLOSEOUT_PROJECT_ID
  });
});

// -----------------------------------------------------------------------------
// 📊 MARKUP API DEMO (v2)
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
      const err = await response.text();
      throw new Error(
        `Failed to get markups: ${response.status} - ${err}`
      );
    }

    const raw = await response.json();
    const markups = raw.Markups || raw || [];

    const flattened = markups.map((m) => ({
      MarkupId: m.Id || null,
      FileName: MARKUP_FILE_NAME,
      FileId: MARKUP_FILE_ID,
      SessionId: MARKUP_SESSION_ID,
      Type: m.Type || null,
      Subject: m.Subject || null,
      Comment: m.Comment || null,
      Author: m.Author || null,
      DateCreated: m.DateCreated || null,
      Page: m.Page || null,
      Status: m.Status || null
    }));

    console.log(`✅ Returning ${flattened.length} markups`);
    res.json(flattened);
  } catch (err) {
    console.error('❌ Error in /powerbi/markups:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 📁 SESSION CLOSEOUT DEMO — LIST FILES (v1)
// -----------------------------------------------------------------------------
app.get('/api/closeout/files', async (req, res) => {
  try {
    console.log(
      `📂 Listing files for session ${CLOSEOUT_SESSION_ID} (project ${CLOSEOUT_PROJECT_ID})...`
    );

    const accessToken = await tokenManager.getValidAccessToken();

    const response = await fetch(
      `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          client_id: CLIENT_ID,
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Failed to fetch files for session: ${response.status} - ${err}`
      );
    }

    const files = await response.json();

    const mapped = files.map((f) => ({
      fileName: f.FileName || 'Unknown File',
      sessionFileId: f.FileId,
      projectFileId: f.ProjectFileId // MUST EXIST for closeout
    }));

    console.log(`✅ Found ${mapped.length} file(s)`);
    res.json(mapped);
  } catch (err) {
    console.error('❌ /api/closeout/files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 📁 SESSION CLOSEOUT DEMO — FULL AUTOMATION FLOW (v1)
// -----------------------------------------------------------------------------
app.post('/api/closeout-file', async (req, res) => {
  try {
    const { sessionFileId, projectFileId } = req.body;

    if (!sessionFileId || !projectFileId) {
      throw new Error('Missing sessionFileId or projectFileId');
    }

    const accessToken = await tokenManager.getValidAccessToken();

    console.log(
      `🚀 Starting closeout: sessionFile=${sessionFileId}, projectFile=${projectFileId}`
    );

    // -------------------------------------------------------------------------
    // 1️⃣ Update Project Copy (via Session Checkin)
    // POST /publicapi/v1/sessions/{sessionId}/files/{id}/checkin
    // -------------------------------------------------------------------------
    const updateUrl = `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files/${sessionFileId}/checkin`;

    console.log(`🔧 Step 1 → Updating project copy: ${updateUrl}`);

    const updateResp = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        checkInMessage: 'Updating project copy before file removal'
      })
    });

    if (!updateResp.ok) {
      throw new Error(
        `Update project copy failed: ${updateResp.status} - ${await updateResp.text()}`
      );
    }

    console.log('✅ Step 1 complete — project file copy updated');

    // -------------------------------------------------------------------------
    // 2️⃣ Remove File from Session
    // DELETE /publicapi/v1/sessions/{sessionId}/files/{id}
    // -------------------------------------------------------------------------
    const deleteUrl = `${API_V1}/sessions/${CLOSEOUT_SESSION_ID}/files/${sessionFileId}`;

    console.log(`🗑️ Step 2 → Removing file from session: ${deleteUrl}`);

    const deleteResp = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID
      }
    });

    if (!deleteResp.ok) {
      throw new Error(
        `Removing file from session failed: ${deleteResp.status} - ${await deleteResp.text()}`
      );
    }

    console.log('✅ Step 2 complete — file removed from session');

    // -------------------------------------------------------------------------
    // 3️⃣ Final Checkin into Project
    // POST /publicapi/v1/projects/{projectId}/files/{id}/checkin
    // -------------------------------------------------------------------------
    const checkinUrl = `${API_V1}/projects/${CLOSEOUT_PROJECT_ID}/files/${projectFileId}/checkin`;

    console.log(`📥 Step 3 → Final project check-in: ${checkinUrl}`);

    const checkinResp = await fetch(checkinUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        checkInMessage: 'Automated final check-in after session closeout'
      })
    });

    if (!checkinResp.ok) {
      throw new Error(
        `Final project check-in failed: ${checkinResp.status} - ${await checkinResp.text()}`
      );
    }

    console.log('🎉 Closeout completed successfully!');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Closeout Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GLOBAL ERROR HANDLERS
// -----------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Promise Rejection:', reason);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  tokenManager.close();
  process.exit(0);
});

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 API Demo running at http://localhost:${PORT}`);
  console.log(`📄 Markup API (v2): /powerbi/markups`);
  console.log(
    `📁 Closeout (v1): session ${CLOSEOUT_SESSION_ID}, project ${CLOSEOUT_PROJECT_ID}`
  );
});
