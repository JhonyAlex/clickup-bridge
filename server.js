import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3107;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CLICKUP_API = "https://api.clickup.com/api/v2";

// --- OAuth Configuration ---
const CLICKUP_CLIENT_ID = process.env.CLICKUP_CLIENT_ID;
const CLICKUP_CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET;
// IMPORTANT: This must match the Redirect URL in your ClickUp App settings
const REDIRECT_URI = `${BASE_URL}/auth/clickup/callback`;

// In-memory store for the access token. For production, you'd want a more persistent store.
let accessToken = null;

app.use(express.json());

// --- OAuth Routes ---

// 1. Redirects the user to ClickUp to authorize the application
app.get("/auth/clickup", (req, res) => {
  if (!CLICKUP_CLIENT_ID) {
    return res.status(500).send("CLICKUP_CLIENT_ID is not configured.");
  }
  const authUrl = `https://app.clickup.com/api?client_id=${CLICKUP_CLIENT_ID}&redirect_uri=${REDIRECT_URI}`;
  res.redirect(authUrl);
});

// 2. ClickUp redirects back here after authorization
app.get("/auth/clickup/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Authorization code is missing.");
  }

  if (!CLICKUP_CLIENT_ID || !CLICKUP_CLIENT_SECRET) {
    return res.status(500).send("OAuth credentials are not configured.");
  }

  try {
    const response = await fetch(`${CLICKUP_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLICKUP_CLIENT_ID,
        client_secret: CLICKUP_CLIENT_SECRET,
        code,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      accessToken = data.access_token;
      console.log("Successfully obtained access token.");
      res.send("Authentication successful! You can now use the API.");
    } else {
      console.error("Failed to obtain access token:", data);
      res.status(500).send("Failed to obtain access token.");
    }
  } catch (error) {
    console.error("Error during token exchange:", error);
    res.status(500).send("An error occurred during authentication.");
  }
});

// --- API Proxy ---
// This will now use the OAuth access token if available
app.all("/api/*", async (req, res) => {
  const useOAuth = !!accessToken;
  const personalToken = process.env.CLICKUP_API_TOKEN;

  if (!useOAuth && !personalToken) {
    return res.status(401).json({ err: "Not authenticated. Please visit /auth/clickup to log in, or set CLICKUP_API_TOKEN." });
  }

  const path = req.params[0] || "";
  const url = new URL(`${CLICKUP_API}/${path}`);
  for (const [k, v] of Object.entries(req.query || {})) {
    if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, String(vv)));
    else url.searchParams.set(k, String(v));
  }

  const r = await fetch(url.toString(), {
    method: req.method,
    headers: {
      // Prefer OAuth token, fall back to personal token
      Authorization: useOAuth ? `Bearer ${accessToken}` : personalToken,
      "Content-Type": "application/json",
    },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
  });

  const data = await r.json().catch(() => ({}));
  res.status(r.status).json(data);
});

// --- Other Routes ---
app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.write(`event: ready\ndata: ClickUp Bridge activo\n\n`);
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Bridge listening on port ${PORT}`);
  if (CLICKUP_CLIENT_ID && BASE_URL) {
    console.log(`To authenticate, visit: ${BASE_URL}/auth/clickup`);
  } else {
    console.log('OAuth is not configured. Set CLICKUP_CLIENT_ID, CLICKUP_CLIENT_SECRET, and BASE_URL to enable it.');
  }
});
