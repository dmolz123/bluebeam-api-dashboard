require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TokenManager = require('./tokenManager');
const app = express();
const PORT = 3000;

// -----------------------------------------------------------------------------
// 🔧 Environment variables and constants
// -----------------------------------------------------------------------------
const API_BASE = 'https://api.bluebeam.com/publicapi/v2';
const CLIENT_ID = process.env.BB_CLIENT_ID;
const CLIENT_SECRET = process.env.BB_CLIENT_SECRET;

// Markup dashboard demo (Session + File for Markup API)
const SESSION_ID = '515-659-145';
const FILE_ID = '98061063';
const FILE_NAME = 'Chicago Office Complete Document (API Demo).pdf';

// Session Closeout PoC (hard-coded for this demo)
const CLOSEOUT_PROJECT_ID = '564-177-023';
const CLOSEOUT_SESSION_ID = '693-759-210';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ESM-compatible fetch wrapper
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Initialize token manager
const tokenManager = new TokenManager();

// -----------------------------------------------------------------------------
// 🔍 Health check
// -----------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    sessionId: SESSION_ID,
    fileId: FILE_ID,
    closeoutSessionId: CLOSEOUT_SESSION_ID,
    closeoutProjectId: CLOSEOUT_PROJECT_ID
  });
});

// -----------------------------------------------------------------------------
// 📊 Power BI endpoint - returns flattened markups for a single file (markup tab)
// -----------------------------------------------------------------------------
app.get('/powerbi/markups', async (req, res) => {
  try {
    console.log(`📊 Fetching markups for session ${SESSION_ID}, file ${FILE_ID}...`);

    // Get valid access token (automatically refreshes if needed)
    const accessToken = await tokenManager.getValidAccessToken();

    // Fetch markups
    const response = await fetch(
      `${API_BASE}/sessions/${SESSION_ID}/files/${FILE_ID}/markups`,
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
      throw new Error(`Failed to get markups: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const markups = data.Markups || data || [];

    // Flatten markups
    const flattened = markups.map((m) => ({
      MarkupId: m.Id || m.markupId || null,
      FileName: FILE_NAME,
      FileId: FILE_ID,
      SessionId: SESSION_ID,
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
  } catch (error) {
    console.error('❌ Error in /powerbi/markups:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 📁 Session Closeout Demo - List files in the hard-coded closeout session
// -----------------------------------------------------------------------------
app.get('/api/closeout/files', async (req, res) => {
  try {
    console.log(
      `📂 Listing files for closeout session ${CLOSEOUT_SESSION_ID} (project ${CLOSEOUT_PROJECT_ID})...`
    );

    const accessToken = await tokenManager.getValidAccessToken();

    const response = await fetch(
      `${API_BASE}/sessions/${CLOSEOUT_SESSION_ID}/files`,
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
        `Failed to fetch session files: ${response.status} - ${err}`
      );
    }

    const raw = await response.json();
    const files = Array.isArray(raw) ? raw : raw.Files || [];

    const mapped = files.map((f) => ({
      fileName: f.FileName || f.Name || 'Unknown file',
      sessionFileId: f.FileId || f.Id,
      projectFileId: f.ProjectFileId || f.ProjectFileID || null
    }));

    console.log(`✅ Found ${mapped.length} file(s) in closeout session`);
    res.json(mapped);
  } catch (err) {
    console.error('❌ /api/closeout/files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 📁 Session Closeout Demo - Update project copy → remove from session → check in
// -----------------------------------------------------------------------------
app.post('/api/closeout-file', async (req, res) => {
  try {
    const { sessionFileId, projectFileId } = req.body;

    if (!sessionFileId || !projectFileId) {
      throw new Error(
        'Missing required fields: sessionFileId or projectFileId'
      );
    }

    console.log(
      `🚀 Closeout start for session file ${sessionFileId}, project file ${projectFileId}`
    );
    console.log(
      `   Using Session ${CLOSEOUT_SESSION_ID}, Project ${CLOSEOUT_PROJECT_ID}`
    );

    const accessToken = await tokenManager.getValidAccessToken();

    // 1️⃣ Update Project Copy
    const updateUrl = `${API_BASE}/projects/${CLOSEOUT_PROJECT_ID}/files/${projectFileId}:updatefilecopy`;
    console.log(`🔧 Step 1: Updating project copy via ${updateUrl}`);

    const updateResp = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        Accept: 'application/json'
      }
    });

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      throw new Error(
        `UpdateFileCopy failed: ${updateResp.status} - ${errText}`
      );
    }

    console.log('✅ Step 1 complete: Project file copy updated');

    // 2️⃣ Remove file from Session
    const deleteUrl = `${API_BASE}/sessions/${CLOSEOUT_SESSION_ID}/files/${sessionFileId}`;
    console.log(`🗑️ Step 2: Removing file from session via ${deleteUrl}`);

    const deleteResp = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID
      }
    });

    if (!deleteResp.ok) {
      const errText = await deleteResp.text();
      throw new Error(
        `Delete Session File failed: ${deleteResp.status} - ${errText}`
      );
    }

    console.log('✅ Step 2 complete: File removed from session');

    // 3️⃣ Check Project File Back In
    const checkinUrl = `${API_BASE}/projects/${CLOSEOUT_PROJECT_ID}/files/${projectFileId}:checkin`;
    console.log(`📥 Step 3: Checking file back into project via ${checkinUrl}`);

    const checkinResp = await fetch(checkinUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        client_id: CLIENT_ID,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        CheckInMessage: 'Automated closeout via Bluebeam API Demo Dashboard'
      })
    });

    if (!checkinResp.ok) {
      const errText = await checkinResp.text();
      throw new Error(
        `Project Check-in failed: ${checkinResp.status} - ${errText}`
      );
    }

    console.log('✅ Step 3 complete: Project file checked in');
    console.log('🎉 Closeout flow completed successfully');

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Closeout Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// ⚠️ Global unhandled error catcher
// -----------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Promise Rejection:', reason);
});

// Clean up database connection on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  tokenManager.close();
  process.exit(0);
});

// -----------------------------------------------------------------------------
// 🚀 Start server
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Markup API Server running at http://localhost:${PORT}`);
  console.log(`📄 Power BI endpoint: http://localhost:${PORT}/powerbi/markups`);
  console.log(
    `📁 Closeout Session: ${CLOSEOUT_SESSION_ID}, Project: ${CLOSEOUT_PROJECT_ID}`
  );
});
