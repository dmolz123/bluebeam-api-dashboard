require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TokenManager = require('./tokenManager'); // ADD THIS LINE
const app = express();
const PORT = 3000;

// -----------------------------------------------------------------------------
// 🔧 Environment variables and constants
// -----------------------------------------------------------------------------
const API_BASE = 'https://api.bluebeam.com/publicapi/v2';
const CLIENT_ID = process.env.BB_CLIENT_ID;
const CLIENT_SECRET = process.env.BB_CLIENT_SECRET;
const SESSION_ID = '928-286-044';
const FILE_ID = '96495009';
const FILE_NAME = 'Conceptual Design Set_20251008.pdf';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ESM-compatible fetch wrapper
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Initialize token manager
const tokenManager = new TokenManager(); // ADD THIS LINE

// -----------------------------------------------------------------------------
// REMOVE the old refreshAccessToken() function - we don't need it anymore!
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// 🔍 Health check
// -----------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    sessionId: SESSION_ID,
    fileId: FILE_ID
  });
});

// -----------------------------------------------------------------------------
// 📊 Power BI endpoint - returns flattened markups for a single file
// -----------------------------------------------------------------------------
app.get('/powerbi/markups', async (req, res) => {
  try {
    console.log(`📊 Fetching markups for session ${SESSION_ID}, file ${FILE_ID}...`);

    // Get valid access token (automatically refreshes if needed)
    const accessToken = await tokenManager.getValidAccessToken(); // CHANGED THIS LINE

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
});
