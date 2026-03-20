// ============================================================
// SocialBiz Analytics — Instagram OAuth Backend
// Deploy this to Render.com for free
// ============================================================

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({
  origin: [
    'https://symphonious-boba-b7f947.netlify.app',
    'https://www.socialbizmedia.com',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));

// ── CONFIG — paste your values here ──
const INSTAGRAM_APP_ID     = '1720990019276023';
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET; // set in Render dashboard
const REDIRECT_URI         = process.env.REDIRECT_URI || 'https://www.socialbizmedia.com/instagram-analytics';

// ============================================================
// STEP 1 — Exchange auth code for access token
// Called by the frontend after Instagram redirects back
// ============================================================
app.post('/auth/instagram', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     INSTAGRAM_APP_ID,
        client_secret: INSTAGRAM_APP_SECRET,
        grant_type:    'authorization_code',
        redirect_uri:  REDIRECT_URI,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error_type) {
      return res.status(400).json({ error: tokenData.error_message });
    }

    const shortToken = tokenData.access_token;
    const userId     = tokenData.user_id;

    // Exchange for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${INSTAGRAM_APP_SECRET}&access_token=${shortToken}`
    );
    const longData = await longRes.json();
    const accessToken = longData.access_token || shortToken;

    res.json({ access_token: accessToken, user_id: userId });

  } catch (err) {
    console.error('Token exchange error:', err);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

// ============================================================
// STEP 2 — Fetch user profile
// ============================================================
app.get('/instagram/profile', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'No token' });

  try {
    const r = await fetch(
      `https://graph.instagram.com/me?fields=id,username,account_type,media_count&access_token=${token}`
    );
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Profile fetch failed' });
  }
});

// ============================================================
// STEP 3 — Fetch last 30 days of media + insights
// ============================================================
app.get('/instagram/media', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'No token' });

  try {
    // Get recent media
    const mediaRes = await fetch(
      `https://graph.instagram.com/me/media?fields=id,caption,media_type,timestamp,thumbnail_url,media_url,permalink&limit=30&access_token=${token}`
    );
    const mediaData = await mediaRes.json();
    if (mediaData.error) return res.status(400).json({ error: mediaData.error.message });

    const media = mediaData.data || [];

    // Filter to last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentMedia = media.filter(m => new Date(m.timestamp) >= thirtyDaysAgo);

    // Fetch insights for each post (views, likes, comments, shares, follows)
    const enriched = await Promise.all(recentMedia.map(async (post) => {
      try {
        const insightRes = await fetch(
          `https://graph.instagram.com/${post.id}/insights?metric=impressions,reach,likes,comments,shares,saved,follows&access_token=${token}`
        );
        const insightData = await insightRes.json();
        const insights = {};
        if (insightData.data) {
          insightData.data.forEach(i => { insights[i.name] = i.values?.[0]?.value || 0; });
        }
        return {
          id:        post.id,
          title:     post.caption ? post.caption.substring(0, 80) : 'Untitled',
          date:      new Date(post.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }),
          type:      post.media_type,
          url:       post.permalink,
          thumbnail: post.thumbnail_url || post.media_url || null,
          views:     insights.impressions  || insights.reach || 0,
          likes:     insights.likes        || 0,
          comments:  insights.comments     || 0,
          shares:    insights.shares       || 0,
          saved:     insights.saved        || 0,
          follows:   insights.follows      || 0
        };
      } catch {
        return { ...post, views:0, likes:0, comments:0, shares:0, saved:0, follows:0 };
      }
    }));

    res.json({ media: enriched });

  } catch (err) {
    console.error('Media fetch error:', err);
    res.status(500).json({ error: 'Media fetch failed' });
  }
});

// ============================================================
// Health check
// ============================================================
app.get('/', (req, res) => res.json({ status: 'SocialBiz Analytics API running ✓' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
