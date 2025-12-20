require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
// Use global fetch available in Node 18+; no external dependency required.
const fetch = global.fetch;

function getApiBase() {
  const envUrl = process.env.REACT_APP_RELIVRE_API_URL || process.env.REACT_APP_API_URL;
  if (envUrl && String(envUrl).trim()) return String(envUrl).trim().replace(/\/$/, '');
  // fallback to known deployed endpoint (from repo env)
  return 'https://olc433bmpe.execute-api.eu-west-3.amazonaws.com';
}

const API_BASE = getApiBase();
const ENDPOINT = `${API_BASE}/search`;

const QUERIES = [
  { name: 'relaxing_not_horror_zh', q: '想看放鬆、不血腥、不要恐怖' },
  { name: 'romantic_not_too_sad_en', q: 'romantic but not too sad' },
  { name: 'family_fun', q: '適合全家一起看的歡樂電影' },
  { name: 'suspense_chinese', q: '懸疑緊張，不要太暴力' },
  { name: 'alien_adventure', q: '外星人冒險、刺激、想要輕鬆感' },
];

async function runOne(q) {
  const body = { query: q, topK: 5 };
  const start = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const dur = Date.now() - start;
  let data = null;
  try { data = await res.json(); } catch (e) { data = { parseError: String(e) }; }
  return { query: q, status: res.status, ok: res.ok, durationMs: dur, data };
}

async function main() {
  console.log('API endpoint:', ENDPOINT);
  const results = [];
  for (const item of QUERIES) {
    try {
      const r = await runOne(item.q);
      const top = Array.isArray(r.data?.results) && r.data.results.length > 0 ? r.data.results[0] : null;
      results.push({ name: item.name, query: item.q, status: r.status, ok: r.ok, durationMs: r.durationMs, top });
      console.log(`${item.name} | ok=${r.ok} status=${r.status} time=${r.durationMs}ms top=${top ? (top.title || top.imdbId) : 'none'}`);
    } catch (e) {
      console.error('Error for', item.name, e?.message || e);
      results.push({ name: item.name, error: String(e) });
    }
  }

  const out = path.join(__dirname, 'frontend_search_test_results.json');
  fs.writeFileSync(out, JSON.stringify({ timestamp: new Date().toISOString(), api: ENDPOINT, results }, null, 2), 'utf8');
  console.log('Wrote:', out);
}

main().catch(e => { console.error(e); process.exit(1); });
