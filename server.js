require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'soundwave-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';

const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state',
  'playlist-modify-public', 'playlist-modify-private',
  'user-library-modify', 'user-library-read'
].join(' ');

// ── CLIENT CREDENTIALS TOKEN ──────────────────────────────────────────────────
let _clientToken = null;
let _clientTokenExpiry = 0;

async function getClientToken() {
  if (_clientToken && Date.now() < _clientTokenExpiry - 60000) return _clientToken;
  const creds = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + creds } }
  );
  _clientToken = res.data.access_token;
  _clientTokenExpiry = Date.now() + res.data.expires_in * 1000;
  return _clientToken;
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'false'
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
  if (req.query.error || !req.query.code) return res.redirect('/?error=access_denied');
  try {
    const creds = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: REDIRECT_URI }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + creds } }
    );
    req.session.access_token = tokenRes.data.access_token;
    req.session.refresh_token = tokenRes.data.refresh_token;
    req.session.token_expiry = Date.now() + tokenRes.data.expires_in * 1000;

    const profile = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: 'Bearer ' + tokenRes.data.access_token }
    });
    req.session.user = {
      id: profile.data.id,
      name: profile.data.display_name,
      email: profile.data.email,
      image: profile.data.images && profile.data.images[0] ? profile.data.images[0].url : null,
      product: profile.data.product
    };
    res.redirect('/app');
  } catch (err) {
    console.error('Login error:', err.response ? JSON.stringify(err.response.data) : err.message);
    res.redirect('/?error=token_error');
  }
});

app.get('/auth/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ── USER TOKEN ────────────────────────────────────────────────────────────────
app.get('/api/token', async (req, res) => {
  if (!req.session.access_token) return res.status(401).json({ error: 'Not logged in' });
  if (Date.now() > req.session.token_expiry - 300000) {
    try {
      const creds = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
      const tokenRes = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: req.session.refresh_token }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + creds } }
      );
      req.session.access_token = tokenRes.data.access_token;
      req.session.token_expiry = Date.now() + tokenRes.data.expires_in * 1000;
    } catch (e) { return res.status(401).json({ error: 'Token refresh failed' }); }
  }
  res.json({ access_token: req.session.access_token });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

// ── HELPER: search and filter for indie artists ───────────────────────────────
async function searchIndieTracks(token, excludeIds, specificQuery) {
  const searches = [
    'indie folk underground',
    'indie pop lo-fi',
    'dream pop ethereal',
    'bedroom pop indie',
    'indie rock underground',
    'shoegaze indie',
    'indie folk acoustic underground',
    'lo-fi indie singer'
  ];

  // If a specific genre is requested, use 3 variations of it for more tracks
  // Otherwise pick 3 random different searches and run them in parallel
  let queries;
  if (specificQuery) {
    queries = [specificQuery, specificQuery + ' underground', specificQuery + ' lo-fi'];
  } else {
    const shuffled = searches.sort(() => Math.random() - 0.5);
    queries = shuffled.slice(0, 3);
  }

  // Run all 3 searches in parallel
  const results = await Promise.all(queries.map(function(q) {
    return axios.get('https://api.spotify.com/v1/search', {
      headers: { Authorization: 'Bearer ' + token },
      params: { q: q, type: 'track', limit: '5', market: 'US' }
    }).then(function(r) {
      return r.data.tracks.items;
    }).catch(function() {
      return []; // if one query fails, don't break the whole thing
    });
  }));

  // Merge all results and deduplicate by track ID
  const seen = new Set();
  let allTracks = [];
  results.forEach(function(items) {
    items.forEach(function(t) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        allTracks.push(t);
      }
    });
  });

  // Strong indie filter: only keep artists with popularity under 50
  let indieTracks = allTracks.filter(function(t) { return t.popularity < 50; });

  // If we filtered too aggressively, fall back to under 65
  if (indieTracks.length < 5) {
    indieTracks = allTracks.filter(function(t) { return t.popularity < 65; });
  }

  // If still not enough, use all tracks
  if (indieTracks.length === 0) indieTracks = allTracks;

  // Exclude already-seen tracks
  if (excludeIds && excludeIds.length) {
    indieTracks = indieTracks.filter(function(t) { return !excludeIds.includes(t.id); });
  }

  // Sort: lower popularity first (more indie), with slight randomness for variety
  indieTracks.sort(function(a, b) {
    var aScore = a.popularity + Math.random() * 15;
    var bScore = b.popularity + Math.random() * 15;
    return aScore - bScore;
  });

  const q = specificQuery || queries[0];
  return indieTracks.map(function(t) {
    return {
      id: t.id,
      title: t.name,
      artist: t.artists.map(function(a) { return a.name; }).join(', '),
      album: t.album.name,
      album_art: t.album.images && t.album.images[0] ? t.album.images[0].url : null,
      preview_url: t.preview_url || null,
      spotify_url: t.external_urls.spotify,
      popularity: t.popularity,
      indie: t.popularity < 40,
      genre: q.split(' ').slice(0, 2).join(' '),
      has_audio: !!t.preview_url
    };
  });
}

// ── TRACKS ────────────────────────────────────────────────────────────────────
app.get('/api/tracks', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const token = await getClientToken();
    const result = await searchIndieTracks(token, [], req.query.genre || null);
    console.log('Tracks fetched:', result.length, '| Avg popularity:', Math.round(result.reduce(function(s, t) { return s + t.popularity; }, 0) / (result.length || 1)));
    res.json({ tracks: result });
  } catch (err) {
    console.error('Track fetch error:', err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// ── RECOMMENDATIONS ───────────────────────────────────────────────────────────
app.post('/api/recommend', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const token = await getClientToken();
    const liked = req.body.liked_track_ids || [];
    const result = await searchIndieTracks(token, liked, null);
    res.json({ tracks: result });
  } catch (err) {
    console.error('Recommend error:', err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// ── LIKE — save to Spotify library ───────────────────────────────────────────
app.post('/api/like', async (req, res) => {
  if (!req.session.access_token || !req.body.track_id) return res.status(400).json({ error: 'Missing data' });
  try {
    await axios.put(
      'https://api.spotify.com/v1/me/tracks?ids=' + req.body.track_id,
      {},
      { headers: { Authorization: 'Bearer ' + req.session.access_token } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Like error:', err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ error: 'Failed to save track' });
  }
});

// ── UNLIKE — remove from Spotify library ─────────────────────────────────────
app.delete('/api/like', async (req, res) => {
  if (!req.session.access_token || !req.body.track_id) return res.status(400).json({ error: 'Missing data' });
  try {
    await axios.delete(
      'https://api.spotify.com/v1/me/tracks?ids=' + req.body.track_id,
      { headers: { Authorization: 'Bearer ' + req.session.access_token } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Unlike error:', err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ error: 'Failed to remove track' });
  }
});

// ── GET LIKED SONGS from Spotify library ─────────────────────────────────────
app.get('/api/liked', async (req, res) => {
  if (!req.session.access_token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const savedRes = await axios.get('https://api.spotify.com/v1/me/tracks?limit=50&market=US', {
      headers: { Authorization: 'Bearer ' + req.session.access_token }
    });
    const tracks = savedRes.data.items.map(function(item) {
      const t = item.track;
      return {
        id: t.id,
        title: t.name,
        artist: t.artists.map(function(a) { return a.name; }).join(', '),
        album_art: t.album.images && t.album.images[0] ? t.album.images[0].url : null,
        preview_url: t.preview_url || null,
        spotify_url: t.external_urls.spotify,
        popularity: t.popularity,
        indie: t.popularity < 40,
        added_at: item.added_at
      };
    });
    res.json({ tracks: tracks });
  } catch (err) {
    console.error('Liked fetch error:', err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ error: 'Failed to fetch liked tracks' });
  }
});

// ── PAGES ─────────────────────────────────────────────────────────────────────
app.get('/', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/app', function(req, res) {
  if (!req.session.access_token) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, function() {
  console.log('\n🎵 SoundWave running at http://127.0.0.1:' + PORT);
  console.log('   Open in browser: http://127.0.0.1:' + PORT + '\n');
  if (!CLIENT_ID || CLIENT_ID === 'your_client_id_here') {
    console.warn('⚠️  No Spotify credentials found!\n');
  } else {
    console.log('✅ Spotify credentials loaded\n');
  }
});
