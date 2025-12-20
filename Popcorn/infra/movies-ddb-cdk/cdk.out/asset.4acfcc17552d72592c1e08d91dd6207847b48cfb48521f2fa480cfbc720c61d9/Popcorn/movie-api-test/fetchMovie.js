// =========================
// Utility: Hard Filter Extraction
// =========================
function extractHardFilters(queryTextInfo) {
  const o = (queryTextInfo?.original || '').toLowerCase();
  const e = (queryTextInfo?.english || '').toLowerCase();

  return {
    requireAnimation:
      o.includes('動畫') ||
      o.includes('動漫') ||
      o.includes('アニメ') ||
      e.includes('animation') ||
      e.includes('anime') ||
      e.includes('animated'),
    requireJapan:
      o.includes('日本') ||
      e.includes('japan') ||
      e.includes('japanese'),
    avoidViolence:
      o.includes('不血腥') ||
      o.includes('不暴力') ||
      e.includes('non-violent') ||
      e.includes('no violence'),
  };
}

function movieIsAnimation(movie) {
  const genre = String(movie?.genre || '').toLowerCase();
  const tags = String(movie?.tags || '').toLowerCase();
  return genre.includes('animation') || tags.includes('animation');
}

function movieIsJapan(movie) {
  const productionCountry = String(movie?.productionCountry || '').toLowerCase();
  const language = String(movie?.language || '').toLowerCase();
  return productionCountry.includes('japan') || language === 'ja' || language === 'jp';
}
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const axios = require('axios');  // 使用 axios 進行 HTTP 請求
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });




function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function hasEnv(name) {
  const value = process.env[name];
  return !!(value && String(value).trim());
}

function isMissingText(value) {
  if (value == null) return true;
  const s = String(value).trim();
  if (!s) return true;
  return /^(n\/a|na|null|undefined)$/i.test(s);
}

function normalizeText(value) {
  return isMissingText(value) ? undefined : String(value).trim();
}

function getEnvNumber(name, defaultValue, opts = {}) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.warn(`[Config] ${name} must be a finite number. Using default: ${defaultValue}`);
    return defaultValue;
  }

  const min = Number.isFinite(opts?.min) ? opts.min : null;
  const max = Number.isFinite(opts?.max) ? opts.max : null;
  if (min != null && value < min) {
    console.warn(`[Config] ${name} must be >= ${min}. Using default: ${defaultValue}`);
    return defaultValue;
  }
  if (max != null && value > max) {
    console.warn(`[Config] ${name} must be <= ${max}. Using default: ${defaultValue}`);
    return defaultValue;
  }

  return value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHttpStatus(error) {
  return error?.response?.status ?? error?.status ?? error?.statusCode ?? null;
}

function isRetryableError(error) {
  const status = getHttpStatus(error);
  if (status === 429) return true;
  if (status === 408) return true;
  if (status >= 500 && status <= 599) return true;

  // Network-ish errors (axios / node)
  const code = String(error?.code || '').toUpperCase();
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED'].includes(code)) {
    return true;
  }
  return false;
}

function computeBackoffMs(attempt, baseDelayMs, maxDelayMs) {
  const exp = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxDelayMs, exp + jitter);
}

async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    label = 'request',
  } = opts;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      const status = getHttpStatus(error);

      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      const statusText = status ? ` status=${status}` : '';
      console.warn(`[Retry] ${label} failed (attempt ${attempt}/${maxAttempts})${statusText}. Waiting ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function axiosGetWithRetry(url, config = {}, opts = {}) {
  const {
    label = 'http',
    timeoutMs = 15000,
    maxAttempts = 5,
  } = opts;

  return withRetry(
    () => axios.get(url, { timeout: timeoutMs, ...config }),
    { maxAttempts, label, baseDelayMs: 500, maxDelayMs: 8000 },
  );
}

// Newer embedding model with better multilingual performance (incl. Chinese)
// Default dimension for text-embedding-3-small is 1536.
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EXPECTED_EMBEDDING_DIM = 1536;

function tryGetVectorSearchFast() {
  try {
    // eslint-disable-next-line global-require
    const mod = require('./vectorSearchFast');
    if (typeof mod?.vectorSearchFast === 'function') {
      return mod.vectorSearchFast;
    }
  } catch {
    // Optional dependency; ignore.
  }
  return null;
}

let _cachedIndexMetaCount = null;
function getLocalFaissMetaCountIfAny() {
  if (_cachedIndexMetaCount !== null) {
    return _cachedIndexMetaCount;
  }

  try {
    const root = String(process.env.LOCAL_DATA_PATH || '').trim();
    if (!root) {
      _cachedIndexMetaCount = null;
      return null;
    }
    const p = path.join(root, 'index', 'meta.json');
    if (!fs.existsSync(p)) {
      _cachedIndexMetaCount = null;
      return null;
    }
    const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    const count = Number(meta?.count);
    const itemsLen = Array.isArray(meta?.items) ? meta.items.length : NaN;
    const v = Number.isFinite(count) ? count : (Number.isFinite(itemsLen) ? itemsLen : NaN);
    _cachedIndexMetaCount = Number.isFinite(v) ? v : null;
    return _cachedIndexMetaCount;
  } catch {
    _cachedIndexMetaCount = null;
    return null;
  }
}

function buildMovieKey(movie) {
  const imdbId = String(movie?.imdbId || '').trim();
  if (imdbId) return imdbId;
  const id = String(movie?.id || '').trim();
  if (id) return id;
  const title = String(movie?.title || '').trim().toLowerCase();
  const year = String(movie?.year || '').trim();
  if (title && year) return `${title}|${year}`;
  if (title) return `title:${title}`;
  return '';
}

async function getCandidateMoviesForQuery(queryEmbedding, storedMovieData, candidateK) {
  const vectorSearchFast = tryGetVectorSearchFast();
  const k = Math.max(1, Math.min(200, Math.floor(Number(candidateK) || 50)));

  if (!vectorSearchFast) {
    return storedMovieData;
  }

  // If the FAISS index is stale (common during local builds), candidate search can silently exclude the true answer.
  // In that case, prefer correctness over speed and do a full scan.
  const metaCount = getLocalFaissMetaCountIfAny();
  const vectorCount = storedMovieData.filter(m => isValidEmbeddingVector(m?.vector)).length;
  if (metaCount != null && vectorCount > 0 && metaCount < Math.floor(vectorCount * 0.9)) {
    console.warn(`[VectorService] Detected stale index meta (meta.count=${metaCount}, vectors=${vectorCount}). Bypassing candidate search and doing full scan.`);
    return storedMovieData;
  }

  try {
    const hits = await vectorSearchFast(queryEmbedding, k);
    if (!Array.isArray(hits) || hits.length === 0) {
      return storedMovieData;
    }

    const map = new Map();
    for (const m of storedMovieData) {
      const key = buildMovieKey(m);
      if (key) map.set(key, m);
    }

    const out = [];
    for (const hit of hits) {
      const key = buildMovieKey(hit);
      const base = key ? map.get(key) : null;
      if (base) {
        out.push({ ...base, score: hit?.score });
      } else {
        out.push(hit);
      }
    }

    return out;
  } catch (error) {
    const msg = error?.response?.data || error?.message || String(error);
    console.warn(`[VectorService] candidate search failed; falling back to full scan. (${msg})`);
    return storedMovieData;
  }
}

// Minimum cosine similarity considered "relevant" for this dataset.
// Override via env: SIMILARITY_THRESHOLD (range: -1..1)
// Default is intentionally strict to avoid showing unrelated results.
const SIMILARITY_THRESHOLD = getEnvNumber('SIMILARITY_THRESHOLD', 0.40, { min: -1, max: 1 });

// Mood-only / mood-heavy queries (e.g. "想看療癒溫馨、不要恐怖") tend to have lower raw cosine similarity.
// Use a more permissive threshold so moodTags weighting can take effect.
// Override via env: SIMILARITY_THRESHOLD_MOOD (range: -1..1)
const SIMILARITY_THRESHOLD_MOOD = getEnvNumber('SIMILARITY_THRESHOLD_MOOD', 0.15, { min: -1, max: 1 });

// 情緒/氛圍標籤（用於情緒搜尋）
// 觀影感受/族群標籤（只允許這些，禁止 genre/氛圍/主題）
const MOOD_TAGS = [
  '放鬆', '療癒', '溫馨', '感人', '沉重', '刺激', '燒腦', '黑色幽默', '緊張', '恐怖', '歡樂', '正能量', '悲傷',
  '適合情侶', '適合家庭', '適合朋友', '適合獨自', '適合小孩', '適合長輩', '適合全家',
  '勵志', '熱血', '浪漫', '青春', '成長', '反思', '發人深省', '驚悚', '史詩', '冒險', '感官刺激',
  '黑暗', '壓抑', '溫暖', '療傷', '心靈', '哲理', '懸疑', '爆笑', '輕鬆', '感官享受',
];

// 生成嵌入（將文本轉換為向量）
async function generateEmbedding(text) {
  requireEnv('OPENAI_API_KEY');
  try {
    const response = await withRetry(
      () => openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
      }),
      { label: 'openai.embeddings.create', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
    );

    const embedding = response.data[0].embedding;

    // 檢查查詢向量是否有效
    if (!embedding || embedding.some(isNaN)) {
      console.error('Generated query embedding contains invalid values');
      return [];  // 返回空向量，避免後續錯誤
    }

    return embedding;
  } catch (error) {
    console.error(`Error generating embedding: ${error?.message || error}`);
    return [];
  }
}

// 計算餘弦相似度
function cosineSimilarity(vec1, vec2) {
  if (!Array.isArray(vec1) || !Array.isArray(vec2) || vec1.length === 0 || vec2.length === 0) {
    return 0;
  }

  // 兩個向量維度不同時，無法計算有效相似度
  if (vec1.length !== vec2.length) {
    return 0;
  }

  // 如果有向量包含 NaN，返回 0
  if (vec1.some(isNaN) || vec2.some(isNaN)) {
    return 0;
  }

  const dotProduct = vec1.reduce((sum, val, index) => sum + val * vec2[index], 0);
  const norm1 = Math.sqrt(vec1.reduce((sum, val) => sum + val ** 2, 0));
  const norm2 = Math.sqrt(vec2.reduce((sum, val) => sum + val ** 2, 0));

  // 防止除數為 0
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (norm1 * norm2);
}

function normalizeQueryText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function averageVectors(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return vecA;
  }
  const out = new Array(vecA.length);
  for (let i = 0; i < vecA.length; i++) {
    out[i] = (Number(vecA[i]) + Number(vecB[i])) / 2;
  }
  return out;
}

async function translateQueryToEnglish(query) {
  const text = normalizeQueryText(query);
  if (!text) {
    return '';
  }

  // Keep this lightweight: translate for retrieval only.
  const prompt = [
    'Translate the following movie search query into English.',
    '- Preserve proper nouns (movie titles, names) and don\'t invent details.',
    '- If the query is already English, output it as-is.',
    '- Output ONLY the translated text.',
    '',
    `QUERY: ${text}`,
  ].join('\n');

  try {
    const response = await withRetry(
      () => openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
      { label: 'openai.chat.completions.create (translate)', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
    );
    return normalizeQueryText(response.choices?.[0]?.message?.content || '');
  } catch (error) {
    console.warn(`Query translation failed; using original query only. (${error?.message || error})`);
    return '';
  }
}

async function generateMultilingualQueryEmbeddingWithText(query) {
  const original = normalizeQueryText(query);
  if (!original) {
    return { original: '', english: '', embedding: [] };
  }

  const originalEmbedding = await generateEmbedding(original);
  if (!isValidEmbeddingVector(originalEmbedding)) {
    return { original, english: '', embedding: [] };
  }

  const english = await translateQueryToEnglish(original);
  if (!english || english.toLowerCase() === original.toLowerCase()) {
    return { original, english: english || '', embedding: originalEmbedding };
  }

  const englishEmbedding = await generateEmbedding(english);
  if (!isValidEmbeddingVector(englishEmbedding)) {
    return { original, english, embedding: originalEmbedding };
  }

  return { original, english, embedding: averageVectors(originalEmbedding, englishEmbedding) };
}

function buildMovieSearchText(movie) {
  return [
    movie?.title,
    movie?.genre,
    movie?.director,
    movie?.language,
    movie?.keywords,
    movie?.tags,
    Array.isArray(movie?.moodTags) ? movie.moodTags.join(' ') : movie?.moodTags,
    movie?.plot,
    movie?.unifiedPlot,
    movie?.expandedOverview,
    movie?.detailedPlot,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function extractQueryTermsForLexical(original, english) {
  const terms = new Set();
  const o = (original || '').toLowerCase();
  const e = (english || '').toLowerCase();

  // Query expansion for small-dataset precision (kept intentionally minimal)
  const addAll = (arr) => { for (const t of arr) if (t) terms.add(t); };

  const mentionsAlien = o.includes('外星') || o.includes('外星人') || o.includes('異星') || o.includes('外星世界')
    || e.includes('alien') || e.includes('extraterrestrial');
  if (mentionsAlien) {
    // Avatar universe anchors often appear in plot text
    addAll(['pandora', "na'vi", 'avatar']);
  }

  // Keep anchored phrases as-is
  const anchoredPhrases = [
    'world war ii',
    'second world war',
    'wwii',
    'nazi',
    'hitler',
    'holocaust',
    'enigma',
  ];
  for (const p of anchoredPhrases) {
    if (e.includes(p) || o.includes(p)) {
      terms.add(p);
    }
  }

  // Map common zh anchors
  if (o.includes('二戰') || o.includes('第二次世界大戰')) {
    terms.add('world war ii');
    terms.add('wwii');
  }

  // Specific zh title/topic anchors that appear often in natural input
  if (o.includes('敦克爾克')) {
    addAll(['dunkirk', 'evacuation', 'operation dynamo']);
  }
  if (o.includes('邱吉爾') || o.includes('丘吉爾') || o.includes('丘吉尔')) {
    addAll(['churchill', 'prime minister']);
  }
  if (o.includes('七宗罪')) {
    addAll(['se7en', 'seven', 'seven deadly sins']);
  }
  if (o.includes('沉默的羔羊')) {
    addAll(['silence of the lambs', 'hannibal', 'lecter']);
  }
  if (o.includes('賭城十一') || o.includes('十一羅漢') || o.includes('十一罗汉') || o.includes('十一人')) {
    addAll(["ocean's eleven", "ocean's", 'heist']);
  }
  if (o.includes('拆彈') || o.includes('拆弹') || o.includes('炸彈') || o.includes('炸弹')) {
    addAll(['bomb', 'explosive', 'ied', 'ordnance']);
  }
  if (o.includes('拳擊') || o.includes('拳击') || o.includes('拳手') || o.includes('拳王')) {
    addAll(['boxing', 'boxer']);
  }

  // Topic-style zh queries (map to common English words that exist in plot/keywords)
  if (o.includes('官僚')) {
    addAll(['bureaucracy', 'bureaucratic']);
  }
  if (o.includes('反烏托邦') || o.includes('反乌托邦') || o.includes('反烏托') || o.includes('反乌托')) {
    addAll(['dystopia', 'dystopian']);
  }
  if (o.includes('荒誕') || o.includes('荒诞')) {
    addAll(['absurd', 'surreal']);
  }
  if (o.includes('黑色幽默') || o.includes('黑色幽默')) {
    addAll(['black comedy', 'dark comedy', 'satire']);
  }

  // Journalism / voyeuristic thriller intents (helps Nightcrawler-style queries)
  const mentionsReporter = o.includes('記者') || o.includes('记者') || o.includes('新聞') || o.includes('新闻');
  if (mentionsReporter) {
    addAll(['journalism', 'news', 'reporter', 'crime journalism', 'local tv news']);
  }
  if (o.includes('偷拍')) {
    addAll(['camera', 'film', 'freelance', 'camera crews']);
  }
  if (o.includes('社會新聞') || o.includes('社会新闻')) {
    addAll(['crime', 'crime scene']);
  }

  // Black-and-white hint (e.g., Raging Bull)
  if (o.includes('黑白')) {
    terms.add('black and white');
  }
  if (o.includes('傳記') || o.includes('传记')) {
    terms.add('biography');
  }

  // Light synonym expansion (tiny dataset; prioritize precision)
  if (e.includes('dictatorship')) terms.add('autocracy');
  if (e.includes('fascist')) terms.add('fascism');
  if (e.includes('bomb disposal')) addAll(['ied', 'explosive', 'ordnance']);
  if (e.includes('boxer')) terms.add('boxing');
  if (e.includes('hannibal')) addAll(['silence of the lambs', 'lecter']);
  if (e.includes('bureaucrat')) addAll(['bureaucracy', 'bureaucratic']);
  if (e.includes('anti-utopia') || e.includes('anti utopia')) addAll(['dystopia', 'dystopian']);
  if (e.includes('black comedy')) terms.add('dark comedy');

  // Stopwords / overly generic tokens that harm reranking in a tiny dataset
  const stop = new Set([
    'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with',
    'about', 'within', 'style',
    'movie', 'movies', 'film', 'films',
    'related', 'relevant',
    'world',
    // genre-level generics (too broad)
    'science', 'fiction', 'sci', 'sci-fi', 'scifi',
    'adventure', 'action', 'drama', 'comedy', 'family',
  ]);

  // Tokenize english into a few meaningful tokens
  const englishTokens = e.split(/[^a-z0-9']+/g);
  let kept = 0;
  for (const token of englishTokens) {
    const t = token.trim();
    if (!t) continue;
    if (stop.has(t)) continue;
    // Keep moderately specific tokens only
    if (t.length >= 5 || anchoredPhrases.includes(t)) {
      terms.add(t);
      kept += 1;
      if (kept >= 8) break;
    }
  }

  return [...terms];
}

function isAnchoredWorldWarIIQuery(original, english) {
  const o = (original || '').toLowerCase();
  const e = (english || '').toLowerCase();
  return o.includes('二戰')
    || o.includes('第二次世界大戰')
    || e.includes('world war ii')
    || e.includes('second world war')
    || e.includes('wwii');
}

function movieMentionsWorldWarII(movieText) {
  const t = (movieText || '').toLowerCase();
  return t.includes('world war ii')
    || t.includes('second world war')
    || t.includes('wwii')
    || t.includes('nazi')
    || t.includes('hitler')
    || t.includes('holocaust')
    || t.includes('enigma');
}

function isResultRelevant(similarity) {
  return isResultRelevantWithThreshold(similarity, SIMILARITY_THRESHOLD);
}

function isResultRelevantWithThreshold(similarity, threshold) {
  return typeof similarity === 'number'
    && !Number.isNaN(similarity)
    && similarity >= threshold;
}

function rankMoviesWithSignals(queryVector, storedMovieData, moodPreferences, queryTextInfo, topK = 5) {
  const WANT_WEIGHT_DEFAULT = 0.10;
  const AVOID_WEIGHT_DEFAULT = 0.12;
  const WANT_WEIGHT_MOOD = 0.18;
  const AVOID_WEIGHT_MOOD = 0.18;
  const LEXICAL_HIT_WEIGHT = 0.015;
  const LEXICAL_ANCHOR_WEIGHT = 0.07;
  const STRONG_SINGLE_TERMS = new Set([
    'pandora', "na'vi", 'avatar', 'enigma',
    // Strong but still specific topic terms
    'boxing', 'boxer',
    'bureaucracy', 'dystopia', 'dystopian',
    'journalism',
  ]);

  const want = toTagArray(moodPreferences?.want);
  const avoid = toTagArray(moodPreferences?.avoid);

  const queryOriginal = queryTextInfo?.original || '';
  const queryEnglish = queryTextInfo?.english || '';
  const queryTerms = extractQueryTermsForLexical(queryOriginal, queryEnglish);

  const moodishQuery = want.length > 0 || avoid.length > 0 || querySeemsMoodRelated(queryOriginal);
  const similarityThreshold = moodishQuery ? SIMILARITY_THRESHOLD_MOOD : SIMILARITY_THRESHOLD;
  const hasStrongAnchor = queryTerms.some(t => t.includes(' ')
    || t === 'wwii'
    || t === 'world war ii'
    || t === 'dunkirk'
    || t === 'se7en'
    || t === 'hannibal'
    || t === "ocean's eleven"
    || STRONG_SINGLE_TERMS.has(t));
  const softSimilarityFloor = moodishQuery
    ? similarityThreshold
    : (hasStrongAnchor ? Math.min(similarityThreshold, 0.28) : similarityThreshold);
  const WANT_WEIGHT = moodishQuery ? WANT_WEIGHT_MOOD : WANT_WEIGHT_DEFAULT;
  const AVOID_WEIGHT = moodishQuery ? AVOID_WEIGHT_MOOD : AVOID_WEIGHT_DEFAULT;

  // If the user explicitly expressed "want" mood tags, and at least one movie has any of them,
  // require at least one want-tag match. This prevents mood-only queries from returning random results.
  let requireWantMatch = false;
  if (moodishQuery && want.length > 0) {
    const wantSet = new Set(want.map(t => String(t).trim().toLowerCase()).filter(Boolean));
    for (const m of storedMovieData) {
      const mt = Array.isArray(m?.moodTags) ? m.moodTags : [];
      if (mt.some(t => wantSet.has(String(t).trim().toLowerCase()))) {
        requireWantMatch = true;
        break;
      }
    }
  }

  // If the user explicitly wants to avoid certain moods, filter them out (when possible).
  let requireAvoidFree = false;
  if (moodishQuery && avoid.length > 0) {
    const avoidSet = new Set(avoid.map(t => String(t).trim().toLowerCase()).filter(Boolean));
    for (const m of storedMovieData) {
      const mt = Array.isArray(m?.moodTags) ? m.moodTags : [];
      if (!mt.some(t => avoidSet.has(String(t).trim().toLowerCase()))) {
        requireAvoidFree = true;
        break;
      }
    }
  }

  // Core comfort requirement: if the user asks for any of these, prefer movies that actually carry them.
  const CORE_COMFORT_TAGS = new Set(['療癒', '溫馨', '溫暖', '感人', '正能量']);
  let requireCoreWantMatch = false;
  let coreWantSet = null;
  if (moodishQuery && want.length > 0) {
    const coreWant = want
      .map(t => String(t).trim())
      .filter(t => CORE_COMFORT_TAGS.has(t));
    if (coreWant.length > 0) {
      coreWantSet = new Set(coreWant.map(t => t.toLowerCase()));
      for (const m of storedMovieData) {
        const mt = Array.isArray(m?.moodTags) ? m.moodTags : [];
        if (mt.some(t => coreWantSet.has(String(t).trim().toLowerCase()))) {
          requireCoreWantMatch = true;
          break;
        }
      }
    }
  }

  // =========================
  // 第二層：Hard Filters（不符合直接丟）
  // =========================
  const hardFilters = extractHardFilters(queryTextInfo);

  const ranked = [];
  for (const movie of storedMovieData) {
    // =========================
    // 第二層：Hard Filters（不符合直接丟）
    // =========================
    if (
      hardFilters.requireAnimation &&
      !movieIsAnimation(movie)
    ) {
      continue;
    }

    if (
      hardFilters.requireJapan &&
      !movieIsJapan(movie)
    ) {
      continue;
    }

    if (
      hardFilters.avoidViolence &&
      (
        movie.moodTags?.includes('恐怖') ||
        movie.moodTags?.includes('驚悚') ||
        movie.moodTags?.includes('黑暗') ||
        movie.moodTags?.includes('感官刺激')
      )
    ) {
      continue;
    }

    const hasScore = Number.isFinite(Number(movie?.score));
    const hasVector = isValidEmbeddingVector(movie?.vector);
    if (!movie || (!hasScore && !hasVector)) {
      continue;
    }

    const similarity = hasScore
      ? Number(movie.score)
      : cosineSimilarity(queryVector, movie.vector);
    if (Number.isNaN(similarity)) {
      continue;
    }

    const movieText = buildMovieSearchText(movie);

    // Hard relevance gate: normally strict, but allow strong lexical anchors to pass with a softer floor.
    if (!isResultRelevantWithThreshold(similarity, similarityThreshold)) {
      if (!(hasStrongAnchor
        && isResultRelevantWithThreshold(similarity, softSimilarityFloor)
        && queryTerms.some(t => t && movieText.includes(t)))) {
        continue;
      }
    }

    const matchedWant = want.length > 0 ? intersectTags(movie.moodTags, want) : [];
    const matchedAvoid = avoid.length > 0 ? intersectTags(movie.moodTags, avoid) : [];

    if (requireWantMatch && matchedWant.length === 0) {
      continue;
    }

    if (requireCoreWantMatch && coreWantSet && !matchedWant.some(t => coreWantSet.has(String(t).trim().toLowerCase()))) {
      continue;
    }

    if (requireAvoidFree && matchedAvoid.length > 0) {
      continue;
    }

    let lexicalBoost = 0;
    const matchedTerms = [];
    for (const term of queryTerms) {
      if (!term) continue;
      if (movieText.includes(term)) {
        matchedTerms.push(term);
        lexicalBoost += (term.includes(' ') || term === 'wwii' || term === 'world war ii' || STRONG_SINGLE_TERMS.has(term))
          ? LEXICAL_ANCHOR_WEIGHT
          : LEXICAL_HIT_WEIGHT;
      }
    }
    lexicalBoost = Math.min(0.25, lexicalBoost);

    // =========================
    // 第三層：Hard condition boost
    // =========================
    let score = similarity + lexicalBoost;
    if (moodishQuery) {
      const wantBoost = matchedWant.reduce((sum, t) => sum + getMoodTagImportance(t), 0) * 0.08;
      const avoidPenalty = matchedAvoid.reduce((sum, t) => sum + getMoodTagImportance(t), 0) * 0.10;
      score += wantBoost - avoidPenalty;
    } else {
      score += (matchedWant.length * WANT_WEIGHT) - (matchedAvoid.length * AVOID_WEIGHT);
    }

    if (
      hardFilters.requireAnimation &&
      movieIsAnimation(movie)
    ) {
      score += 0.15;
    }

    if (
      hardFilters.requireJapan &&
      movieIsJapan(movie)
    ) {
      score += 0.15;
    }

    ranked.push({
      title: movie.title,
      imdbId: movie.imdbId,
      key: movie.key,
      similarity,
      score,
      lexicalBoost,
      matchedTerms: [...new Set(matchedTerms)],
      matchedWantTags: matchedWant,
      matchedAvoidTags: matchedAvoid,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, topK));
}

function toTagArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(String).map(s => s.trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,，、\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function intersectTags(a, b) {
  const left = new Set(toTagArray(a).map(t => t.toLowerCase()));
  const right = new Set(toTagArray(b).map(t => t.toLowerCase()));
  const out = [];
  for (const t of left) {
    if (right.has(t)) {
      out.push(t);
    }
  }
  return out;
}

function inferMoodPreferencesDirectMatch(query) {
  const text = normalizeQueryText(query).toLowerCase();
  if (!text) {
    return { want: [], avoid: [] };
  }

  const want = new Set();
  const avoid = new Set();

  const addWant = (tag) => { if (MOOD_TAGS.includes(tag)) want.add(tag); };
  const addAvoid = (tag) => { if (MOOD_TAGS.includes(tag)) avoid.add(tag); };

  const isNegatedNear = (idx) => {
    const prefix = text.slice(Math.max(0, idx - 6), idx);
    return /不要|不想|避免|別|不要太|不太|not\s+too|no\s+|avoid/i.test(prefix);
  };

  // 1) Direct tag mentions
  for (const tag of MOOD_TAGS) {
    const needle = String(tag).toLowerCase();
    const idx = text.indexOf(needle);
    if (idx === -1) continue;
    if (isNegatedNear(idx)) {
      addAvoid(tag);
    } else {
      addWant(tag);
    }
  }

  // 2) Minimal synonym mapping
  if (text.includes('暖心') || text.includes('heartwarming')) {
    addWant('溫馨');
    addWant('溫暖');
  }
  if (text.includes('治癒') || text.includes('治愈') || text.includes('healing') || text.includes('heal')) {
    addWant('療癒');
  }
  if (text.includes('紓壓') || text.includes('解壓') || text.includes('relax') || text.includes('relaxing')) {
    addWant('放鬆');
    addWant('輕鬆');
  }
  if (/不要.{0,3}沉重|不想.{0,3}沉重|不太.{0,3}沉重/.test(text)) {
    addAvoid('沉重');
  }
  if (/不要.{0,3}恐怖|不想.{0,3}恐怖|不太.{0,3}恐怖/.test(text)) {
    addAvoid('恐怖');
  }
  if (/不要.{0,3}驚悚|不想.{0,3}驚悚|不太.{0,3}驚悚/.test(text)) {
    addAvoid('驚悚');
  }
  if (text.includes('不要血腥') || text.includes('不血腥') || text.includes('non-violent') || text.includes('no violence')) {
    addAvoid('恐怖');
    addAvoid('驚悚');
    addAvoid('黑暗');
    addAvoid('感官刺激');
  }

  // Compatibility expansion (conservative): only expand 放鬆→輕鬆 when query has no other strong comfort wants.
  const strongWants = ['療癒', '溫馨', '感人', '正能量', '溫暖'];
  const hasStrongWant = strongWants.some(t => want.has(t));
  if (!hasStrongWant && want.size === 1 && want.has('放鬆')) {
    addWant('輕鬆');
  }

  // Resolve conflicts
  for (const t of avoid) {
    want.delete(t);
  }

  return {
    want: [...want],
    avoid: [...avoid],
  };
}

function getMoodTagImportance(tag) {
  switch (String(tag || '').trim()) {
    case '療癒':
    case '溫馨':
    case '溫暖':
      return 3.0;
    case '感人':
    case '正能量':
    case '勵志':
      return 2.6;
    case '爆笑':
    case '歡樂':
    case '浪漫':
      return 2.2;
    case '放鬆':
      return 1.7;
    case '輕鬆':
      return 1.4;
    case '適合家庭':
    case '適合全家':
    case '適合情侶':
    case '適合朋友':
    case '適合獨自':
      return 1.2;
    default:
      return 1.0;
  }
}

function inferMoodPreferencesHeuristic(query) {
  const text = normalizeQueryText(query).toLowerCase();
  if (!text) {
    return { want: [], avoid: [] };
  }

  const want = new Set();
  const avoid = new Set();

  const hasAny = (list) => list.some(w => text.includes(w));

  // Want light / uplifting
  if (hasAny(['輕鬆', '放鬆', '輕鬆一點', '紓壓', '治癒', '療癒', '溫馨', '暖心', '可愛', '搞笑', '好笑', '喜劇', '開心', '快樂', '正能量',
    'light', 'feel good', 'feel-good', 'relax', 'relaxing', 'uplifting', 'funny', 'comedy', 'wholesome',
    'ligera', 'relajante', 'divertida', 'comedia', 'alegre',
    '癒し', '癒やし', '気楽', '気軽', 'コメディ', '笑える', '面白い', 'ほのぼの',
  ])) {
    want.add('輕鬆');
    want.add('放鬆');
    want.add('溫馨');
    want.add('療癒');
    want.add('正能量');
  }

  // User feels bad -> avoid heavy/dark
  if (hasAny(['心情不好', '心情很差', '低落', '憂鬱', '難過', '不開心', '壓力', '焦慮',
    'sad', 'depressed', 'down', 'stress', 'anxious',
    'triste', 'deprimido', 'estresado', 'ansioso',
    '落ち込', 'しんど', 'つらい', '憂鬱',
  ])) {
    want.add('療癒');
    want.add('溫馨');
    want.add('正能量');
    want.add('放鬆');
    avoid.add('黑暗');
    avoid.add('壓抑');
    avoid.add('恐怖');
    avoid.add('驚悚');
    avoid.add('沉重');
  }

  return {
    want: [...want].filter(t => MOOD_TAGS.includes(t)),
    avoid: [...avoid].filter(t => MOOD_TAGS.includes(t)),
  };
}

function querySeemsMoodRelated(query) {
  const text = normalizeQueryText(query).toLowerCase();
  if (!text) {
    return false;
  }

  // Keep this conservative: only trigger on clear mood/feeling/tone intent.
  const signals = [
    // zh
    '心情', '情緒', '想看', '想要', '輕鬆', '放鬆', '紓壓', '治癒', '療癒', '溫馨', '暖心', '感人', '催淚',
    '搞笑', '好笑', '喜劇', '浪漫', '恐怖', '驚悚', '緊張', '刺激', '黑暗',
    // en
    'mood', 'feel', 'feel-good', 'feel good', 'uplifting', 'light', 'relax', 'relaxing', 'funny', 'comedy',
    'romantic', 'scary', 'horror', 'thriller', 'dark', 'sad',
    // ja (common)
    '気分', '癒し', '癒やし', 'ほのぼの', '笑える', '怖い',
    // es (common)
    'ánimo', 'relaj', 'ligera', 'divertida', 'comedia', 'terror', 'triste',
  ];

  return signals.some(s => s && text.includes(s));
}

async function inferMoodPreferencesFromQuery(query) {
  const original = normalizeQueryText(query);
  if (!original) {
    return { want: [], avoid: [] };
  }

  // First: deterministic direct tag extraction (fast, no API calls)
  const direct = inferMoodPreferencesDirectMatch(original);
  if (direct.want.length > 0 || direct.avoid.length > 0) {
    return direct;
  }

  // First try deterministic heuristic (cheap + stable)
  const heuristic = inferMoodPreferencesHeuristic(original);
  if (heuristic.want.length > 0 || heuristic.avoid.length > 0) {
    return heuristic;
  }

  // Important: if the query doesn't look mood-related, don't call the LLM.
  // Otherwise sports/topic searches (e.g., baseball) can get noisy mood boosts and rank wrong.
  if (!querySeemsMoodRelated(original)) {
    return { want: [], avoid: [] };
  }

  // Fallback to LLM classification when heuristic can't infer intent
  const english = await translateQueryToEnglish(original);
  const allowed = MOOD_TAGS.join('、');
  const prompt = [
    'Classify the user\'s movie search query into mood preferences.',
    'Return ONLY valid tags from the allowed list.',
    'Output MUST be a JSON object with exactly two keys: want (array) and avoid (array).',
    'Choose 0-5 tags for each array.',
    '',
    `Allowed tags: ${allowed}`,
    '',
    `User query (original): ${original}`,
    `User query (English): ${english || '(translation unavailable)'}`,
  ].join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 160,
    });

    const raw = (response.choices?.[0]?.message?.content || '').trim();
    if (!raw) {
      return { want: [], avoid: [] };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { want: [], avoid: [] };
    }

    const want = Array.isArray(parsed?.want) ? parsed.want : [];
    const avoid = Array.isArray(parsed?.avoid) ? parsed.avoid : [];
    return {
      want: [...new Set(want.map(String).map(s => s.trim()).filter(Boolean))].filter(t => MOOD_TAGS.includes(t)).slice(0, 5),
      avoid: [...new Set(avoid.map(String).map(s => s.trim()).filter(Boolean))].filter(t => MOOD_TAGS.includes(t)).slice(0, 5),
    };
  } catch (error) {
    console.warn(`inferMoodPreferencesFromQuery failed: ${error?.message || error}`);
    return { want: [], avoid: [] };
  }
}

function findBestMovieWithMood(queryVector, storedMovieData, moodPreferences, queryTextInfo) {
  const WANT_WEIGHT_DEFAULT = 0.10;
  const AVOID_WEIGHT_DEFAULT = 0.12;
  const WANT_WEIGHT_MOOD = 0.18;
  const AVOID_WEIGHT_MOOD = 0.18;
  const LEXICAL_HIT_WEIGHT = 0.015;
  const LEXICAL_ANCHOR_WEIGHT = 0.07;
  const STRONG_SINGLE_TERMS = new Set([
    'pandora', "na'vi", 'avatar', 'enigma',
    'boxing', 'boxer',
    'bureaucracy', 'dystopia', 'dystopian',
    'journalism',
  ]);

  let best = null;
  let bestScore = -Infinity;
  let bestSimilarity = -1;
  let bestMatchedMoodTags = [];
  let bestAvoidMatchedMoodTags = [];

  const want = toTagArray(moodPreferences?.want);
  const avoid = toTagArray(moodPreferences?.avoid);

  const queryOriginal = queryTextInfo?.original || '';
  const queryEnglish = queryTextInfo?.english || '';
  const queryTerms = extractQueryTermsForLexical(queryOriginal, queryEnglish);

  const moodishQuery = want.length > 0 || avoid.length > 0 || querySeemsMoodRelated(queryOriginal);
  const similarityThreshold = moodishQuery ? SIMILARITY_THRESHOLD_MOOD : SIMILARITY_THRESHOLD;
  const WANT_WEIGHT = moodishQuery ? WANT_WEIGHT_MOOD : WANT_WEIGHT_DEFAULT;
  const AVOID_WEIGHT = moodishQuery ? AVOID_WEIGHT_MOOD : AVOID_WEIGHT_DEFAULT;

  // If the query is mood-heavy, apply the same precision guards as rankMoviesWithSignals.
  let requireWantMatch = false;
  if (moodishQuery && want.length > 0) {
    const wantSet = new Set(want.map(t => String(t).trim().toLowerCase()).filter(Boolean));
    for (const m of storedMovieData) {
      const mt = Array.isArray(m?.moodTags) ? m.moodTags : [];
      if (mt.some(t => wantSet.has(String(t).trim().toLowerCase()))) {
        requireWantMatch = true;
        break;
      }
    }
  }

  let requireAvoidFree = false;
  if (moodishQuery && avoid.length > 0) {
    const avoidSet = new Set(avoid.map(t => String(t).trim().toLowerCase()).filter(Boolean));
    for (const m of storedMovieData) {
      const mt = Array.isArray(m?.moodTags) ? m.moodTags : [];
      if (!mt.some(t => avoidSet.has(String(t).trim().toLowerCase()))) {
        requireAvoidFree = true;
        break;
      }
    }
  }

  const CORE_COMFORT_TAGS = new Set(['療癒', '溫馨', '溫暖', '感人', '正能量']);
  let requireCoreWantMatch = false;
  let coreWantSet = null;
  if (moodishQuery && want.length > 0) {
    const coreWant = want
      .map(t => String(t).trim())
      .filter(t => CORE_COMFORT_TAGS.has(t));
    if (coreWant.length > 0) {
      coreWantSet = new Set(coreWant.map(t => t.toLowerCase()));
      for (const m of storedMovieData) {
        const mt = Array.isArray(m?.moodTags) ? m.moodTags : [];
        if (mt.some(t => coreWantSet.has(String(t).trim().toLowerCase()))) {
          requireCoreWantMatch = true;
          break;
        }
      }
    }
  }

  const hardFilters = extractHardFilters(queryTextInfo);

  for (const movie of storedMovieData) {
    if (hardFilters.requireAnimation && !movieIsAnimation(movie)) {
      continue;
    }
    if (hardFilters.requireJapan && !movieIsJapan(movie)) {
      continue;
    }
    if (
      hardFilters.avoidViolence &&
      (
        movie.moodTags?.includes('恐怖') ||
        movie.moodTags?.includes('驚悚') ||
        movie.moodTags?.includes('黑暗') ||
        movie.moodTags?.includes('感官刺激')
      )
    ) {
      continue;
    }

    const hasScore = Number.isFinite(Number(movie?.score));
    const hasVector = isValidEmbeddingVector(movie?.vector);
    if (!movie || (!hasScore && !hasVector)) {
      continue;
    }

    const similarity = hasScore
      ? Number(movie.score)
      : cosineSimilarity(queryVector, movie.vector);
    if (isNaN(similarity)) {
      continue;
    }

    // Hard relevance gate
    if (!isResultRelevantWithThreshold(similarity, similarityThreshold)) {
      continue;
    }

    const matchedWant = want.length > 0 ? intersectTags(movie.moodTags, want) : [];
    const matchedAvoid = avoid.length > 0 ? intersectTags(movie.moodTags, avoid) : [];

    if (requireWantMatch && matchedWant.length === 0) {
      continue;
    }

    if (requireCoreWantMatch && coreWantSet && !matchedWant.some(t => coreWantSet.has(String(t).trim().toLowerCase()))) {
      continue;
    }

    if (requireAvoidFree && matchedAvoid.length > 0) {
      continue;
    }

    // Lexical boost: tiny rerank signal for exact term hits in stored text
    const movieText = buildMovieSearchText(movie);
    let lexicalBoost = 0;
    for (const term of queryTerms) {
      if (!term) continue;
      if (movieText.includes(term)) {
        lexicalBoost += (term.includes(' ') || term === 'wwii' || term === 'world war ii' || STRONG_SINGLE_TERMS.has(term))
          ? LEXICAL_ANCHOR_WEIGHT
          : LEXICAL_HIT_WEIGHT;
      }
    }
    // cap to avoid overpowering semantics
    lexicalBoost = Math.min(0.25, lexicalBoost);

    let score = similarity + lexicalBoost;
    if (moodishQuery) {
      const wantBoost = matchedWant.reduce((sum, t) => sum + getMoodTagImportance(t), 0) * 0.08;
      const avoidPenalty = matchedAvoid.reduce((sum, t) => sum + getMoodTagImportance(t), 0) * 0.10;
      score += wantBoost - avoidPenalty;
    } else {
      score += (matchedWant.length * WANT_WEIGHT) - (matchedAvoid.length * AVOID_WEIGHT);
    }

    if (score > bestScore) {
      best = movie;
      bestScore = score;
      bestSimilarity = similarity;
      bestMatchedMoodTags = matchedWant;
      bestAvoidMatchedMoodTags = matchedAvoid;
    }
  }

  return {
    movie: best,
    similarity: bestSimilarity,
    score: bestScore,
    matchedMoodTags: bestMatchedMoodTags,
    matchedAvoidMoodTags: bestAvoidMatchedMoodTags,
  };
}

const OMDB_BASE_URL = 'https://www.omdbapi.com/';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3/movie/';

function getTmdbApiKey() {
  const apiKey = process.env.TMDB_API_KEY;
  return apiKey && String(apiKey).trim() ? String(apiKey).trim() : '';
}

function sanitizePlotForAi(plot) {
  if (!plot || !String(plot).trim()) {
    return '';
  }
  // Wikipedia summary often contains cast lists like "It stars ..." — remove those sentences
  return String(plot)
    .replace(/\bIt\s+stars\b[^.]*\./gi, '')
    .replace(/\bThe\s+film\s+stars\b[^.]*\./gi, '')
    .replace(/\bStarring\b[^.]*\./gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function htmlToText(html) {
  if (!html || !String(html).trim()) {
    return '';
  }
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars).trim() + '\n\n[Truncated]';
}

function stripTruncatedMarker(text) {
  return String(text || '').replace(/\n\n\[Truncated\]\s*$/i, '').trim();
}

function normalizePlotText(text) {
  let value = stripTruncatedMarker(text);
  if (!value) return '';

  value = value
    .replace(/^\s*Plot\s*\[edit\]\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return value;
}

function looksLikeWikipediaCssDump(text) {
  const v = String(text || '').trim();
  if (!v) return false;
  return v.startsWith('.mw-parser-output') || v.includes('mw-parser-output .ambox') || v.includes('{border:');
}

function clipTextAtBoundary(text, maxChars) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (value.length <= maxChars) return value;

  const slice = value.slice(0, maxChars);
  const lastBoundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  const cutoff = lastBoundary >= 180 ? lastBoundary + 1 : maxChars;
  return value.slice(0, cutoff).trim() + '…';
}

function extractiveOverviewFromPlot(text, maxChars) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const sentences = [];
  const re = /[^.!?]+[.!?]+(\s+|$)/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    const s = m[0].trim();
    if (!s) continue;
    sentences.push(s);
    const joined = sentences.join(' ');
    if (joined.length >= maxChars) {
      return clipTextAtBoundary(joined, maxChars);
    }
    if (sentences.length >= 6) {
      break;
    }
  }
  return clipTextAtBoundary(sentences.join(' ') || value, maxChars);
}

function fixLeadingSentenceFragment(text) {
  const v = String(text || '').trim();
  if (!v) return '';
  // If we start with a lowercase fragment like "her car. Michael ...", drop the fragment.
  if (/^[a-z]/.test(v)) {
    const idx = v.indexOf('. ');
    if (idx >= 0 && idx <= 80) {
      const rest = v.slice(idx + 2).trim();
      return rest || v;
    }
  }
  return v;
}

function cutAfterFirstSentence(text) {
  const v = String(text || '').trim();
  if (!v) return '';
  const nextDot = v.indexOf('.');
  const nextBang = v.indexOf('!');
  const nextQ = v.indexOf('?');
  const candidates = [nextDot, nextBang, nextQ].filter(i => i >= 0);
  if (candidates.length === 0) return '';
  const cutAt = Math.min(...candidates) + 1;
  return v.slice(cutAt).trim();
}

function longestCommonPrefixLen(a, b) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  const n = Math.min(s1.length, s2.length);
  let i = 0;
  while (i < n && s1.charCodeAt(i) === s2.charCodeAt(i)) i += 1;
  return i;
}

function postProcessPlotFields(movie) {
  if (!movie) return;
  let detailed = normalizePlotText(movie.detailedPlot);
  let expanded = normalizePlotText(movie.expandedOverview);

  if (!detailed && !expanded) {
    return;
  }

  if (!expanded && detailed) {
    expanded = extractiveOverviewFromPlot(detailed, 420);
  }
  if (!detailed && expanded) {
    detailed = expanded;
  }

  if (expanded && detailed) {
    const lcp = longestCommonPrefixLen(expanded, detailed);
    const minLen = Math.min(expanded.length, detailed.length);
    const lcpRatio = minLen > 0 ? (lcp / minLen) : 0;
    const oneContainsOther = expanded === detailed || detailed.includes(expanded) || expanded.includes(detailed);
    if (oneContainsOther || (lcp >= 200 && lcpRatio >= 0.5)) {
      expanded = extractiveOverviewFromPlot(detailed, 420);
    }

    // Clean up any leading fragment (best-effort).
    detailed = fixLeadingSentenceFragment(detailed);

    // De-overlap by dropping the first sentence if expandedOverview is a prefix.
    // This keeps both fields useful while avoiding repeated text.
    const expandedBase = String(expanded || '').replace(/…\s*$/u, '').trim();
    if (expandedBase && expanded.endsWith('…') && detailed.startsWith(expandedBase)) {
      const remaining = cutAfterFirstSentence(detailed);
      if (remaining.length >= 220) {
        detailed = remaining;
      }
    }

    // Requirement: combined length must be <= 1/2 of the current combined length.
    const initialCombined = detailed.length + expanded.length;
    const target = Math.floor(initialCombined / 2);
    if (Number.isFinite(target) && target > 0) {
      const detailedBudget = Math.max(220, Math.floor(target * 0.75));
      let expandedBudget = Math.max(120, target - detailedBudget);

      detailed = clipTextAtBoundary(detailed, detailedBudget);
      expanded = clipTextAtBoundary(expanded, expandedBudget);

      const nowCombined = detailed.length + expanded.length;
      if (nowCombined > target) {
        expandedBudget = Math.max(80, target - detailed.length);
        expanded = clipTextAtBoundary(expanded, expandedBudget);
      }
    }
  }

  movie.detailedPlot = detailed;
  movie.expandedOverview = expanded;
}

// 創建一個簡單的函數來查詢電影資料
const fetchMovieData = async (movieTitle, opts = {}) => {
  const canUseOmdb = hasEnv('OMDB_API_KEY');
  const year = opts?.year;
  const fastMode = !!opts?.fast;
  const quietMode = !!opts?.quiet;

  // 1. 查詢 OMDb API 獲取基本資料（如果有 OMDB_API_KEY）
  const omdbData = canUseOmdb ? await fetchOMDbMovieData(movieTitle, year) : null;

  if (omdbData) {
    if (!quietMode) {
      console.log(`Title: ${omdbData.title}`);
      console.log(`Year: ${omdbData.year}`);
      console.log(`Genre: ${omdbData.genre}`);
      console.log(`IMDb Rating: ${omdbData.imdbRating}`);
      console.log(`Director: ${omdbData.director}`);
      console.log(`Runtime: ${omdbData.runtime}`);
      console.log(`Language: ${omdbData.language}`);
    }

    const result = {
      ...omdbData,
      actors: undefined,
      keywords: undefined,
      tags: undefined,
      detailedPlot: undefined,
    };

    // 2. 查詢 TMDb API 獲取演員名單、關鍵字和標籤
    // fetchTMDbMovieData 需要 IMDb ID（tt...），OMDb 回傳在 imdbId
    const tmdbData = await fetchTMDbMovieData(omdbData.imdbId);
    if (tmdbData) {
      if (!quietMode) {
        console.log(`Actors from TMDb: ${tmdbData.actors}`);
        console.log(`Keywords from TMDb: ${tmdbData.keywords}`);
        console.log(`Tags from TMDb: ${tmdbData.tags}`);

        // 顯示電影原產地
        if (tmdbData.productionCountry) {
          console.log(`電影原產地: ${tmdbData.productionCountry}`);
        }
      }

      result.actors = tmdbData.actors;
      result.keywords = tmdbData.keywords;
      result.tags = tmdbData.tags;
      result.moodKeywords = tmdbData.moodKeywords;
      result.tmdbId = tmdbData.tmdbId;
      // 修正語言欄位：只顯示 TMDb 的 original_language
      if (tmdbData.original_language) {
        result.language = tmdbData.original_language;
      }
      // 新增原產國家欄位
      if (tmdbData.productionCountry) {
        // 標明是電影原產地
        result.productionCountry = tmdbData.productionCountry; // 電影原產地
      }
    }

    // If OMDb returned missing/N/A fields (or TMDb enrichment failed), try to fill required fields via TMDb search/details.
    if (['year', 'genre', 'director', 'runtime', 'language', 'imdbId', 'plot'].some(k => isMissingText(result?.[k]))) {
      const full = result.tmdbId
        ? await fetchTMDbMovieFullById(result.tmdbId)
        : await fetchTMDbMovieFullByTitle(movieTitle, year);
      fillMissingFrom(result, full);
      if (full?.original_language) {
        result.language = full.original_language;
      }
    }

    // 3. 用 Wikipedia/OMDb 的 plot 當素材，產生可用於 embedding 的文本。
    // 在 --fast 模式下不呼叫 Chat Completions（省成本/加速，且避免敏感劇情觸發拒答）。
    const wikipediaDescription = await fetchWikipediaDescription(movieTitle);
    const baseDetailedSource = stripTruncatedMarker(wikipediaDescription || '') || String(omdbData.plot || '').trim();
    const plotForAi = sanitizePlotForAi(baseDetailedSource || '');
    if (!fastMode) {
      // expandedOverview: AI short synopsis; detailedPlot: Wikipedia/OMDb plot text.
      const synopsis = await generateExpandedOverview(plotForAi);
      result.expandedOverview = synopsis;
      result.detailedPlot = baseDetailedSource;
      if (synopsis && !quietMode) {
        console.log(`Expanded Overview (AI): ${synopsis}`);
      }
    } else {
      // No AI in --fast: build a short overview from the detailed plot.
      result.detailedPlot = truncateText(baseDetailedSource || plotForAi || '', 1200);
      result.expandedOverview = extractiveOverviewFromPlot(result.detailedPlot, 520);
    }

    postProcessPlotFields(result);

    return result;
  } else {
    if (!canUseOmdb) {
      console.warn('OMDB_API_KEY is not set; falling back to Wikipedia-only data.');
    } else {
      console.log('Movie not found in OMDb; falling back to Wikipedia-only data if available.');
    }

    // TMDb-by-title fallback (prevents many INCOMPLETE skips when OMDb is missing).
    const tmdbFull = await fetchTMDbMovieFullByTitle(movieTitle, year);

    // Wikipedia is optional; use as detailedPlot when available.
    const wikipediaDescription = await fetchWikipediaDescription(movieTitle);
    if (!wikipediaDescription && !tmdbFull) {
      console.log('Movie not found.');
      return null;
    }

    const out = {
      title: movieTitle,
      year: undefined,
      genre: undefined,
      imdbRating: undefined,
      director: undefined,
      runtime: undefined,
      language: undefined,
      actors: undefined,
      keywords: undefined,
      tags: undefined,
      imdbId: undefined,
      plot: undefined,
      expandedOverview: undefined,
      detailedPlot: undefined,
    };

    fillMissingFrom(out, tmdbFull);
    if (tmdbFull?.original_language) {
      out.language = tmdbFull.original_language;
    }

    const detailedSource = stripTruncatedMarker(wikipediaDescription || '') || String(out.plot || '').trim();
    const plotForAi = sanitizePlotForAi(detailedSource || '');

    if (!fastMode) {
      const synopsis = await generateExpandedOverview(plotForAi);
      out.expandedOverview = synopsis;
      out.detailedPlot = detailedSource;
    } else {
      out.detailedPlot = truncateText(detailedSource || plotForAi || '', 1200);
      out.expandedOverview = extractiveOverviewFromPlot(out.detailedPlot, 520);
    }

    // Ensure plot exists for storage validation.
    if (isMissingText(out.plot)) {
      out.plot = normalizeText(tmdbFull?.plot) || normalizeText(out.detailedPlot) || normalizeText(out.expandedOverview);
    }

    postProcessPlotFields(out);
    return out;
  }
};

function shouldGenerateMoodTags(movie) {
  const hasText = !!(
    (movie?.plot && String(movie.plot).trim())
    || (movie?.detailedPlot && String(movie.detailedPlot).trim())
    || (movie?.expandedOverview && String(movie.expandedOverview).trim())
    || (movie?.keywords && String(movie.keywords).trim())
    || (movie?.tags && String(movie.tags).trim())
  );
  return hasText;
}

function validateMovieForStorage(movie) {
  const missing = [];

  const requireString = (key) => {
    const value = movie?.[key];
    if (isMissingText(value)) {
      missing.push(key);
    }
  };

  requireString('title');
  requireString('year');
  requireString('genre');
  requireString('director');
  requireString('runtime');
  requireString('language');
  requireString('imdbId');
  // plot 與 AI 劇情至少要有一個完整
  const plot = !isMissingText(movie?.plot);
  const detailedPlot = !isMissingText(movie?.detailedPlot);
  const expandedOverview = !isMissingText(movie?.expandedOverview);
  if (!plot) {
    missing.push('plot');
  }
  if (!detailedPlot && !expandedOverview) {
    missing.push('detailedPlot');
  }

  return { ok: missing.length === 0, missing };
}

function buildMovieEmbeddingText(movie) {
  // 只拼接非演員資訊（actors 欄位獨立，不進入 embedding）
  return [
    movie.title,
    movie.genre,
    movie.director,
    movie.language,
    movie.keywords,
    movie.tags,
    Array.isArray(movie.moodTags) ? movie.moodTags.join(', ') : movie.moodTags,
    movie.plot,
    movie.expandedOverview,
    movie.detailedPlot,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildMoodAnalysisText(movie) {
  return [
    `Title: ${movie.title || ''}`,
    `Genre: ${movie.genre || ''}`,
    `Tags: ${movie.tags || ''}`,
    `Keywords: ${movie.keywords || ''}`,
    `Plot: ${movie.plot || ''}`,
    `DetailedPlot: ${movie.detailedPlot || ''}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// 用 OpenAI 自動生成情緒/氛圍標籤（供使用者依情緒搜尋）
async function generateMoodTags(movie) {
  const allowedSet = new Set(MOOD_TAGS);
  const fallbackPool = [
    '放鬆',
    '輕鬆',
    '緊張',
    '刺激',
    '感人',
    '溫馨',
    '燒腦',
    '適合朋友',
    '適合情侶',
    '適合家庭',
    '適合獨自',
    '反思',
    '心靈',
    '哲理',
    '懸疑',
  ].filter(t => allowedSet.has(t));

  const normalize = (value) => {
    const list = Array.isArray(value) ? value : [];
    const cleaned = [];
    for (const t of list) {
      const s = String(t || '').trim();
      if (!s) continue;
      if (!allowedSet.has(s)) continue;
      if (cleaned.includes(s)) continue;
      cleaned.push(s);
    }

    if (cleaned.length > 5) {
      return cleaned.slice(0, 5);
    }
    if (cleaned.length < 5) {
      for (const t of fallbackPool) {
        if (cleaned.length >= 5) break;
        if (!cleaned.includes(t)) cleaned.push(t);
      }
    }
    return cleaned.slice(0, 5);
  };

  const analysisText = buildMoodAnalysisText(movie);
  const allowed = MOOD_TAGS.join(', ');
  const buildPrompt = (retryNote = '') => [
    '你是一個電影情緒/族群標籤專家。根據下方電影資訊，請只從「允許標籤清單」中，選出「剛好 5 個」最貼近觀影感受、適合族群、情境的標籤。',
    '嚴禁選 genre、主題、氛圍、劇情類型，只能選「觀影感受」或「適合族群/情境」的標籤。',
    '你必須輸出剛好 5 個標籤（JSON array 長度=5），不要多也不要少。',
    '輸出格式必須是 JSON array（如：["放鬆","適合家庭","療癒","輕鬆","感人"]），不要有其他文字。',
    retryNote ? `\n修正提醒: ${retryNote}` : '',
    '',
    `允許標籤清單: ${allowed}`,
    '',
    `電影資訊:\n${analysisText}`,
  ].filter(Boolean).join('\n');

  try {
    let lastRaw = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const retryNote = attempt === 1
        ? ''
        : `上次輸出不是「剛好 5 個允許標籤」。上次輸出：${lastRaw}`;

      const prompt = buildPrompt(retryNote);
      const response = await withRetry(
        () => openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 120,
        }),
        { label: 'openai.chat.completions.create (moodTags)', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
      );

      const raw = (response.choices?.[0]?.message?.content || '').trim();
      lastRaw = raw;
      if (!raw) continue;

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw
          .replace(/[[\]"]+/g, '')
          .split(/[,，、\n]+/)
          .map(s => s.trim())
          .filter(Boolean);
      }

      const normalized = normalize(parsed);
      if (normalized.length === 5) {
        return normalized;
      }
    }

    // Last resort: normalize whatever we have (pad/trim deterministically).
    return normalize([]);
  } catch (error) {
    console.error('Error generating mood tags:', error);
    return normalize([]);
  }
}

function isValidEmbeddingVector(vector) {
  return Array.isArray(vector)
    && vector.length === EXPECTED_EMBEDDING_DIM
    && !vector.some(isNaN);
}

function loadTitlesFromFileOrArgs(args, titlesFilePath) {
  const titlesFromArgs = args.filter(Boolean);
  if (titlesFromArgs.length > 0) {
    return titlesFromArgs;
  }

  if (fs.existsSync(titlesFilePath)) {
    const raw = JSON.parse(fs.readFileSync(titlesFilePath));
    if (Array.isArray(raw)) {
      return raw.filter(Boolean);
    }
  }

  return [];
}

function validateStoredMovieData(storedMovieData) {
  if (!Array.isArray(storedMovieData) || storedMovieData.length === 0) {
    return { ok: false, reason: 'stored movie dataset is empty or not an array' };
  }

  for (const movie of storedMovieData) {
    if (!movie || typeof movie.title !== 'string') {
      return { ok: false, reason: 'local dataset contains an item without a valid title' };
    }
    if (!isValidEmbeddingVector(movie.vector)) {
      return { ok: false, reason: `invalid embedding vector for: ${movie.title}` };
    }
  }

  return { ok: true };
}

function shouldReadFromDynamo(args) {
  return args.includes('--dynamodb') || args.includes('--ddb');
}

function getDynamoScanLimit(args) {
  const idx = args.findIndex(a => a === '--limit');
  if (idx >= 0 && args[idx + 1]) {
    const n = Number(args[idx + 1]);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return null;
}

function stripArgs(args, stripList) {
  const strip = new Set(stripList);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (strip.has(a)) {
      // skip value for flags like --limit
      if (a === '--limit' || a === '--topk') {
        i += 1;
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

function coerceMovieFromDynamo(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const movie = { ...item };
  if (Array.isArray(movie.vector)) {
    movie.vector = movie.vector.map(Number);
  }
  return movie;
}

async function loadMoviesFromDynamo(args) {
  const tableName = getDynamoTableName();
  const docClient = getDynamoDocClient();
  // eslint-disable-next-line global-require
  const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

  const limit = getDynamoScanLimit(args);
  const items = [];
  let lastKey = undefined;
  do {
    const res = await docClient.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastKey,
    }));
    const batch = (res.Items || []).map(coerceMovieFromDynamo);
    items.push(...batch);
    lastKey = res.LastEvaluatedKey;
    if (limit && items.length >= limit) {
      return items.slice(0, limit);
    }
  } while (lastKey);

  return items;
}

async function loadStoredMoviesForSearch(args) {
  if (shouldReadFromDynamo(args)) {
    console.log(`[Search] Loading movies from DynamoDB table: ${getDynamoTableName()} ...`);
    const movies = await loadMoviesFromDynamo(args);
    console.log(`[Search] Loaded ${movies.length} movie(s) from DynamoDB.`);
    return movies;
  }

  const localPaths = getLocalPaths();
  ensureLocalDirs(localPaths);
  return loadLocalMoviesForSearch(localPaths);
}

async function promptQueryLoop(storedMovieData) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\n輸入自然語言查詢來做搜尋（輸入 exit / quit 結束）');
    while (true) {
      let query;
      try {
        query = await rl.question('Query> ');
      } catch (error) {
        const code = error?.code;
        // When stdin is piped and ends, readline can throw after close.
        if (code === 'ERR_USE_AFTER_CLOSE' || code === 'ERR_INVALID_STATE') {
          break;
        }
        // Treat any other question() failure as end-of-input.
        break;
      }

      query = String(query || '').trim();
      if (!query) {
        continue;
      }
      if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
        break;
      }

      const queryInfo = await generateMultilingualQueryEmbeddingWithText(query);
      const queryEmbedding = queryInfo.embedding;
      if (!isValidEmbeddingVector(queryEmbedding)) {
        console.log('Query embedding 無效，請再試一次。');
        continue;
      }

      if (isAnchoredWorldWarIIQuery(queryInfo.original, queryInfo.english)) {
        const hasAnyWWII = storedMovieData.some(m => movieMentionsWorldWarII(buildMovieSearchText(m)));
        if (!hasAnyWWII) {
          console.log('No relevant movies found.');
          continue;
        }
      }

      const moodPreferences = await inferMoodPreferencesFromQuery(query);
      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        const wantText = moodPreferences.want.length > 0 ? moodPreferences.want.join(', ') : '(none)';
        const avoidText = moodPreferences.avoid.length > 0 ? moodPreferences.avoid.join(', ') : '(none)';
        console.log(`Mood intent (want): ${wantText}`);
        console.log(`Mood intent (avoid): ${avoidText}`);
      }

      const moodish = (moodPreferences?.want?.length || 0) > 0 || (moodPreferences?.avoid?.length || 0) > 0;
      const candidates = moodish
        ? storedMovieData
        : await getCandidateMoviesForQuery(queryEmbedding, storedMovieData, 50);
      const result = findBestMovieWithMood(queryEmbedding, candidates, moodPreferences, queryInfo);
      if (!result.movie) {
        console.log('找不到相似電影（可能是資料庫是空的或向量無效）。');
        continue;
      }
      console.log(`Most similar movie: ${result.movie.title} (similarity=${result.similarity})`);
      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        console.log(`Matched want tags: ${(result.matchedMoodTags || []).join(', ') || '(none)'}`);
        console.log(`Matched avoid tags: ${(result.matchedAvoidMoodTags || []).join(', ') || '(none)'}`);
      }
    }
  } finally {
    rl.close();
  }
}

// 查詢 OMDb API
const fetchOMDbMovieData = async (movieTitle, year) => {
  const apiKey = requireEnv('OMDB_API_KEY');
  // Use plot=full for richer plot text (helps downstream AI rewriting)
  const yearParam = year ? `&y=${encodeURIComponent(String(year))}` : '';
  const url = `${OMDB_BASE_URL}?t=${encodeURIComponent(movieTitle)}${yearParam}&plot=full&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const response = await axiosGetWithRetry(url, {}, { label: 'omdb.get', timeoutMs: 15000, maxAttempts: 5 });
    const data = response.data;

    if (data.Response === 'True') {
      return {
        title: normalizeText(data.Title),
        year: normalizeText(data.Year),
        genre: normalizeText(data.Genre),  // 多個電影類型
        imdbRating: normalizeText(data.imdbRating),
        director: normalizeText(data.Director),  // 導演
        runtime: normalizeText(data.Runtime),  // 時長
        language: normalizeText(data.Language),  // 原始語言
        actors: normalizeText(data.Actors),
        plot: normalizeText(data.Plot),  // 簡短的電影劇情
        imdbId: normalizeText(data.imdbID), // IMDb ID（用於 TMDb find）
      };
    } else {
      return null;
    }
  } catch (error) {
    console.log(`OMDb fetch failed: ${error?.message || error}`);
    return null;
  }
};

// 使用 TMDb API 獲取電影詳細資料和演員名單
const fetchTMDbMovieData = async (imdbId) => {
  if (!imdbId) {
    console.log('TMDb fetch skipped: missing IMDb ID');
    return null;
  }

  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    console.warn('TMDB_API_KEY is not set; skipping TMDb enrichment.');
    return null;
  }
  const findUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&external_source=imdb_id`;
  try {
    const findResponse = await axiosGetWithRetry(findUrl, {}, { label: 'tmdb.find', timeoutMs: 15000, maxAttempts: 5 });
    const findData = findResponse.data;
    const tmdbId = findData?.movie_results?.[0]?.id;
    if (!tmdbId) {
      console.log(`TMDb find returned no movie for IMDb ID: ${imdbId}`);
      return null;
    }

    const detailsUrl = `${TMDB_BASE_URL}${tmdbId}?api_key=${apiKey}&append_to_response=credits,keywords,external_ids`;
    const detailsResponse = await axiosGetWithRetry(detailsUrl, {}, { label: 'tmdb.details', timeoutMs: 15000, maxAttempts: 5 });
    const data = detailsResponse.data;

    // 只取前 10 位主要演員
    const actors = data?.credits?.cast && Array.isArray(data.credits.cast)
      ? data.credits.cast.slice(0, 10).map(actor => actor.name).join(', ')
      : 'No actors found';


    // 關鍵字（TMDb keywords 的格式可能是 keywords.keywords）
    const keywordItems = data?.keywords?.keywords || data?.keywords?.results || [];
    let keywordsArr = Array.isArray(keywordItems) && keywordItems.length > 0
      ? keywordItems.map(k => k.name).filter(Boolean)
      : [];
    // 只取前 10 個
    keywordsArr = keywordsArr.slice(0, 10);
    const keywords = keywordsArr.join(', ') || 'No keywords found';

    // 標籤（genres）
    const tags = Array.isArray(data?.genres) && data.genres.length > 0
      ? data.genres.map(g => g.name).join(', ')
      : 'No tags found';

    // TMDb 的原始語言
    const original_language = data?.original_language || '';
    // TMDb 的原產國家（陣列，取英文名稱）
    const countriesArr = Array.isArray(data?.production_countries) ? data.production_countries.map(c => c.name).filter(Boolean) : [];
    const productionCountry = countriesArr.join(', ');
    const imdbIdOut = normalizeText(data?.external_ids?.imdb_id) || normalizeText(imdbId);
    return { actors, keywords, tags, tmdbId, original_language, productionCountry, imdbId: imdbIdOut };
  } catch (error) {
    console.log(`TMDb fetch failed: ${error?.message || error}`);
    return null;
  }
};

async function searchTMDbMovieIdByTitle(title, year) {
  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    return null;
  }

  const q = String(title || '').trim();
  if (!q) return null;

  const yearParam = year ? `&year=${encodeURIComponent(String(year))}` : '';
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(apiKey)}&language=en-US&query=${encodeURIComponent(q)}&include_adult=false&page=1${yearParam}`;

  try {
    const resp = await axiosGetWithRetry(url, {}, { label: 'tmdb.search', timeoutMs: 15000, maxAttempts: 5 });
    const results = Array.isArray(resp.data?.results) ? resp.data.results : [];
    if (results.length === 0) return null;

    const wantYear = year ? String(year).trim() : '';
    const normalizedTitle = q.toLowerCase();

    const withScores = results.map(r => {
      const t = String(r?.title || r?.original_title || '').trim();
      const tLower = t.toLowerCase();
      const release = String(r?.release_date || '').trim();
      const y = release ? release.slice(0, 4) : '';
      const voteCount = Number(r?.vote_count || 0);
      const titleExact = tLower === normalizedTitle;
      const yearExact = !!(wantYear && y === wantYear);

      // Prefer exact title match, then exact year, then higher vote_count.
      const score = (titleExact ? 1000000 : 0) + (yearExact ? 10000 : 0) + (Number.isFinite(voteCount) ? voteCount : 0);
      return { id: r?.id, score };
    });

    withScores.sort((a, b) => b.score - a.score);
    return withScores[0]?.id ?? null;
  } catch (error) {
    console.log(`TMDb search failed: ${error?.message || error}`);
    return null;
  }
}

async function fetchTMDbMovieFullById(tmdbId) {
  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    return null;
  }
  if (!tmdbId) return null;

  const url = `${TMDB_BASE_URL}${encodeURIComponent(String(tmdbId))}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits,keywords,external_ids`;
  try {
    const resp = await axiosGetWithRetry(url, {}, { label: 'tmdb.details.full', timeoutMs: 15000, maxAttempts: 5 });
    const data = resp.data;
    if (!data) return null;

    const releaseDate = String(data?.release_date || '').trim();
    const outYear = releaseDate ? releaseDate.slice(0, 4) : undefined;
    const outGenre = Array.isArray(data?.genres) ? data.genres.map(g => g?.name).filter(Boolean).join(', ') : undefined;
    const runtimeMin = Number(data?.runtime);
    const outRuntime = Number.isFinite(runtimeMin) && runtimeMin > 0 ? `${runtimeMin} min` : undefined;

    const directors = Array.isArray(data?.credits?.crew)
      ? data.credits.crew
        .filter(p => String(p?.job || '').toLowerCase() === 'director')
        .map(p => p?.name)
        .filter(Boolean)
      : [];
    const outDirector = directors.length > 0 ? directors.join(', ') : undefined;

    const outActors = Array.isArray(data?.credits?.cast)
      ? data.credits.cast.slice(0, 10).map(a => a?.name).filter(Boolean).join(', ')
      : undefined;

    const keywordItems = data?.keywords?.keywords || data?.keywords?.results || [];
    const keywordsArr = Array.isArray(keywordItems)
      ? keywordItems.map(k => k?.name).filter(Boolean).slice(0, 10)
      : [];
    const outKeywords = keywordsArr.length > 0 ? keywordsArr.join(', ') : undefined;

    const countriesArr = Array.isArray(data?.production_countries)
      ? data.production_countries.map(c => c?.name).filter(Boolean)
      : [];
    const outProductionCountry = countriesArr.length > 0 ? countriesArr.join(', ') : undefined;

    const outImdbId = normalizeText(data?.external_ids?.imdb_id);
    const outPlot = normalizeText(data?.overview);
    const outLang = normalizeText(data?.original_language);

    return {
      tmdbId: data?.id,
      imdbId: outImdbId,
      year: normalizeText(outYear),
      genre: normalizeText(outGenre),
      tags: normalizeText(outGenre),
      director: normalizeText(outDirector),
      runtime: normalizeText(outRuntime),
      original_language: outLang,
      language: outLang,
      actors: normalizeText(outActors),
      keywords: normalizeText(outKeywords),
      productionCountry: normalizeText(outProductionCountry),
      plot: outPlot,
      tmdbVoteAverage: Number(data?.vote_average),
      tmdbVoteCount: Number(data?.vote_count),
      tmdbPopularity: Number(data?.popularity),
    };
  } catch (error) {
    console.log(`TMDb details fetch failed: ${error?.message || error}`);
    return null;
  }
}

async function fetchTMDbMovieFullByTitle(title, year) {
  const id = await searchTMDbMovieIdByTitle(title, year);
  if (!id) return null;
  return fetchTMDbMovieFullById(id);
}

function fillMissingFrom(base, patch) {
  if (!base || !patch) return;
  const keys = ['year', 'genre', 'director', 'runtime', 'language', 'imdbId', 'plot', 'actors', 'keywords', 'tags', 'tmdbId', 'productionCountry', 'tmdbVoteAverage', 'tmdbVoteCount', 'tmdbPopularity'];
  for (const k of keys) {
    if (isMissingText(base?.[k]) && !isMissingText(patch?.[k])) {
      base[k] = patch[k];
    }
  }
}

// 使用 axios 從 Wikipedia 獲取電影詳細劇情描述
const fetchWikipediaDescription = async (movieTitle) => {
  try {
    // 注意：Wikipedia URL 中的電影名稱需要用 "_" 替代空格
    const formattedTitle = movieTitle.replace(/\s+/g, '_');

    // Prefer the MediaWiki Action API to fetch the "Plot" section (mobile-sections is decommissioned).
    // 1) Get section list
    const apiUrl = 'https://en.wikipedia.org/w/api.php';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    try {
      const sectionsResponse = await axiosGetWithRetry(apiUrl, {
        headers,
        params: {
          action: 'parse',
          page: movieTitle,
          prop: 'sections',
          format: 'json',
          redirects: 1,
        },
      }, { label: 'wikipedia.parse.sections', timeoutMs: 15000, maxAttempts: 5 });

      const sections = sectionsResponse.data?.parse?.sections || [];
      const plotSection = sections.find(s => String(s?.line || '').trim().toLowerCase() === 'plot');

      if (plotSection?.index) {
        // 2) Fetch the plot section HTML
        const plotResponse = await axiosGetWithRetry(apiUrl, {
          headers,
          params: {
            action: 'parse',
            page: movieTitle,
            prop: 'text',
            section: plotSection.index,
            format: 'json',
            redirects: 1,
          },
        }, { label: 'wikipedia.parse.plot', timeoutMs: 15000, maxAttempts: 5 });

        const html = plotResponse.data?.parse?.text?.['*'] || '';
        const plotText = htmlToText(html);
        if (plotText && !looksLikeWikipediaCssDump(plotText)) {
          return truncateText(plotText, 8000);
        }
      }
    } catch (e) {
      console.log(`Wikipedia plot-section fetch failed; falling back to summary. (${e?.message || e})`);
    }

    // Fallback to summary
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${formattedTitle}`;
    const summaryResponse = await axiosGetWithRetry(summaryUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    }, { label: 'wikipedia.summary', timeoutMs: 15000, maxAttempts: 5 });

    if (summaryResponse.data && summaryResponse.data.extract) {
      return truncateText(summaryResponse.data.extract, 8000);
    }

    console.log('Wikipedia: No plot/summary extract found');
    return null;
  } catch (error) {
    console.log(`Wikipedia fetch failed: ${error?.message || error}`);
    return null;
  }
};

function usage() {
  console.log('Usage:');
  console.log('  node fetchMovie.js build                # build from LOCAL_DATA_PATH/movies/movie_titles.json');
  console.log('  node fetchMovie.js build --fresh        # rebuild from scratch (truncate local NDJSON files)');
  console.log('  node fetchMovie.js build --dynamodb     # also write each saved movie to DynamoDB');
  console.log('  node fetchMovie.js build --fast         # faster build (skip AI plot rewrite; mood tags optional via --moodtags)');
  console.log('  node fetchMovie.js build --moodtags     # generate moodTags (viewer feeling) for emotion-based search');
  console.log('  node fetchMovie.js build "The Matrix"   # build one (or many) titles from args');
  console.log('  node fetchMovie.js build-popular        # sample from TMDb popular and build');
  console.log('    --count 100 --pages 10 --min-votes 500 --delay-ms 350 [--min-vote-average 7.5] [--min-imdb-rating 7.5] [--top-rated] [--resample] [--fresh] [--dynamodb] [--fast] [--moodtags]');
  console.log('  node fetchMovie.js fix-plots            # de-overlap expandedOverview/detailedPlot and halve combined length (local movies.ndjson)');
  console.log('    [--dry-run] [--limit 1000]');
  console.log('  node fetchMovie.js fix-moodtags         # backfill moodTags for local movies (and refresh embeddings)');
  console.log('    [--dry-run] [--limit 1000] [--title "Inception"] [--all]');
  console.log('  node fetchMovie.js search               # interactive semantic search (uses stored vectors)');
  console.log('  node fetchMovie.js search "QUERY" --topk 10 [--json]   # one-shot search with similarity breakdown');
  console.log('  node fetchMovie.js search-batch [queries.json]          # batch eval (prints topK + PASS/FAIL if expected is provided)');
  console.log('');
  console.log('  node fetchMovie.js count                # count movies in local NDJSON store');
  console.log('  node fetchMovie.js count --dynamodb     # count movies in DynamoDB table');
  console.log('  node fetchMovie.js purge-dynamodb --yes # DELETE ALL movies in DynamoDB table (irreversible)');
  console.log('    [--dry-run] [--limit 1000] [--progress-every 500]');
  console.log('  node fetchMovie.js sync-dynamodb --yes  # OVERWRITE local NDJSON store from DynamoDB (make them identical)');
  console.log('    [--dry-run] [--limit 1000]');
  console.log('  node fetchMovie.js deploy-dynamodb --yes # Upload local NDJSON store to DynamoDB (deploy after local verification)');
  console.log('    [--dry-run] [--limit 1000] [--purge-first]');
  console.log('Required env:');
  console.log('  OPENAI_API_KEY');
  console.log('  LOCAL_DATA_PATH');
  console.log('If using --dynamodb:');
  console.log('  DDB_TABLE_NAME (default: reLivre-movies)');
  console.log('  AWS_REGION (or configured AWS profile/credentials)');
  console.log('Recommended env (for richer metadata):');
  console.log('  OMDB_API_KEY');
  console.log('Optional env:');
  console.log('  TMDB_API_KEY (required for build-popular; optional for build enrichment)');
}

function hasFlag(args, name) {
  return args.includes(name);
}

async function purgeDynamoTable(args) {
  const confirmed = hasFlag(args, '--yes');
  const dryRun = hasFlag(args, '--dry-run');
  const tableName = getDynamoTableName();
  const docClient = getDynamoDocClient();

  const limit = (() => {
    const v = getFlagNumber(args, '--limit', NaN);
    return Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null;
  })();
  const progressEvery = (() => {
    const v = getFlagNumber(args, '--progress-every', 500);
    return Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 500;
  })();

  // eslint-disable-next-line global-require
  const { ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

  if (!confirmed && !dryRun) {
    console.error('[Purge-DynamoDB] Refusing to delete without --yes.');
    console.error(`Table: ${tableName}`);
    console.error('Run: node fetchMovie.js purge-dynamodb --yes');
    console.error('Or:  node fetchMovie.js purge-dynamodb --dry-run');
    return;
  }

  console.log(`[Purge-DynamoDB] Table=${tableName} dryRun=${dryRun} limit=${limit ?? '(none)'}`);

  let deleted = 0;
  let scanned = 0;
  let lastKey = undefined;

  const flushDeletes = async (keys) => {
    if (!keys || keys.length === 0) return;
    if (dryRun) {
      // For dry-run, treat as if deleted, but respect limit.
      const remaining = limit ? Math.max(0, limit - deleted) : null;
      const n = remaining == null ? keys.length : Math.min(keys.length, remaining);
      deleted += n;
      return;
    }

    // BatchWrite supports max 25 items.
    const maxKeys = limit ? keys.slice(0, Math.max(0, limit - deleted)) : keys;
    for (let i = 0; i < maxKeys.length; i += 25) {
      const batch = maxKeys.slice(i, i + 25);
      let req = {
        RequestItems: {
          [tableName]: batch.map(k => ({ DeleteRequest: { Key: k } })),
        },
      };

      // Retry unprocessed items a few times.
      for (let attempt = 1; attempt <= 6; attempt++) {
        const res = await docClient.send(new BatchWriteCommand(req));
        const unprocessed = res?.UnprocessedItems?.[tableName] || [];
        const done = batch.length - unprocessed.length;
        deleted += done;

        if (!unprocessed || unprocessed.length === 0) {
          break;
        }

        if (attempt === 6) {
          console.warn(`[Purge-DynamoDB] Unprocessed items remain after retries: ${unprocessed.length}`);
          break;
        }

        req = { RequestItems: { [tableName]: unprocessed } };
        await sleep(Math.min(2000, 200 * attempt));
      }
    }
  };

  try {
    const pendingKeys = [];
    do {
      const res = await docClient.send(new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        ProjectionExpression: 'imdbId',
      }));

      const items = Array.isArray(res?.Items) ? res.Items : [];
      scanned += items.length;
      for (const it of items) {
        const imdbId = it?.imdbId;
        if (!imdbId) continue;
        const collected = deleted + pendingKeys.length;
        if (limit && collected >= limit) {
          break;
        }
        pendingKeys.push({ imdbId });
      }

      // Flush in chunks to keep memory stable.
      if (pendingKeys.length >= 500) {
        await flushDeletes(pendingKeys.splice(0, pendingKeys.length));
      }

      if (deleted > 0 && deleted % progressEvery === 0) {
        console.log(`[Purge-DynamoDB] progress deleted=${deleted} scanned=${scanned}`);
      }

      lastKey = res?.LastEvaluatedKey;
      if (limit) {
        const collected = deleted + pendingKeys.length;
        if (collected >= limit) {
          lastKey = undefined;
        }
      }
    } while (lastKey);

    if (pendingKeys.length > 0) {
      await flushDeletes(pendingKeys);
    }

    console.log(`[Purge-DynamoDB] Done. ${dryRun ? 'Would delete' : 'Deleted'} ${deleted} item(s).`);
  } catch (e) {
    console.error(`[Purge-DynamoDB] Failed: ${e?.message || e}`);
  }
}

function shouldWriteToDynamo(args) {
  return args.includes('--dynamodb') || args.includes('--ddb');
}

function getDynamoTableName() {
  return (process.env.DDB_TABLE_NAME || process.env.MOVIES_TABLE_NAME || 'reLivre-movies').trim();
}

function getDynamoDocClient() {
  // Require lazily so users can run without AWS deps unless they use --dynamodb.
  // eslint-disable-next-line global-require
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  // eslint-disable-next-line global-require
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION;
  const ddb = new DynamoDBClient(region ? { region } : {});
  return DynamoDBDocumentClient.from(ddb, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

async function putMovieToDynamo(docClient, tableName, movie) {
  // eslint-disable-next-line global-require
  const { PutCommand } = require('@aws-sdk/lib-dynamodb');

  if (!movie || !movie.imdbId) {
    throw new Error('Missing imdbId; cannot write to DynamoDB');
  }

  const item = {
    ...movie,
    titleLower: String(movie.title || '').toLowerCase(),
    // Keep year as-is (string) to match CDK GSI sortKey
    year: movie.year,
  };

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: item,
  }));
}

async function deleteMovieFromDynamo(docClient, tableName, imdbId) {
  // eslint-disable-next-line global-require
  const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');

  if (!imdbId) {
    return;
  }

  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { imdbId },
  }));
}

function writeJsonArrayOrThrow(filePath, value) {
  const json = JSON.stringify(value, null, 2);
  fs.writeFileSync(filePath, json, { encoding: 'utf8' });

  // 立即讀回驗證，避免「看似成功但檔案實際不可讀/被清空」的情況
  const verifyText = fs.readFileSync(filePath, 'utf8');
  if (!verifyText || !verifyText.trim()) {
    throw new Error(`Write failed: ${filePath} is empty after write`);
  }
  const parsed = JSON.parse(verifyText);
  if (!Array.isArray(parsed)) {
    throw new Error(`Write failed: ${filePath} is not a JSON array after write`);
  }
}

function writeJsonOrWarn(filePath, value) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { encoding: 'utf8' });
    return true;
  } catch (e) {
    console.warn(`[Logs] Failed to write: ${filePath} (${e?.message || e})`);
    return false;
  }
}

function makeRunId() {
  // ISO-ish, but safe for Windows file names
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveLocalDataRoot() {
  const root = requireEnv('LOCAL_DATA_PATH');
  return path.resolve(String(root));
}

function getLocalPaths() {
  const root = resolveLocalDataRoot();
  const moviesDir = path.join(root, 'movies');
  const vectorsDir = path.join(root, 'vectors');
  const indexDir = path.join(root, 'index');
  const logsDir = path.join(root, 'logs');
  const incompleteDir = path.join(logsDir, 'incomplete');
  const runsDir = path.join(logsDir, 'runs');
  return {
    root,
    moviesDir,
    vectorsDir,
    indexDir,
    logsDir,
    incompleteDir,
    runsDir,
    moviesNdjsonPath: path.join(moviesDir, 'movies.ndjson'),
    vectorsNdjsonPath: path.join(vectorsDir, 'embeddings.ndjson'),
    titlesPath: path.join(moviesDir, 'movie_titles.json'),
    popularSeedsPath: path.join(moviesDir, 'build_popular_seeds.ndjson'),
    topRatedSeedsPath: path.join(moviesDir, 'build_top_rated_seeds.ndjson'),
    queriesPath: path.join(moviesDir, 'search_queries.json'),
    incompleteTitlesPath: path.join(incompleteDir, 'incomplete_titles.json'),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureLocalDirs(localPaths) {
  ensureDir(localPaths.root);
  ensureDir(localPaths.moviesDir);
  ensureDir(localPaths.vectorsDir);
  ensureDir(localPaths.indexDir);
  ensureDir(localPaths.logsDir);
  ensureDir(localPaths.incompleteDir);
  ensureDir(localPaths.runsDir);
}

function normalizeNdjsonLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  if (s.startsWith('#') || s.startsWith('//')) return null;
  return s;
}

async function readNdjsonToArray(filePath, opts = {}) {
  const {
    mapFn = (x) => x,
  } = opts;

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out = [];
  try {
    for await (const line of rl) {
      const s = normalizeNdjsonLine(line);
      if (!s) continue;
      try {
        const obj = JSON.parse(s);
        const mapped = mapFn(obj);
        if (mapped !== undefined) {
          out.push(mapped);
        }
      } catch {
        // Ignore invalid lines (best-effort local cache).
      }
    }
  } finally {
    rl.close();
  }
  return out;
}

function openNdjsonAppendStream(filePath) {
  ensureDir(path.dirname(filePath));
  return fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
}

function openNdjsonWriteStream(filePath) {
  ensureDir(path.dirname(filePath));
  return fs.createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });
}

async function appendNdjson(stream, obj) {
  const line = `${JSON.stringify(obj)}\n`;
  const ok = stream.write(line);
  if (!ok) {
    await once(stream, 'drain');
  }
}

async function closeWriteStream(stream) {
  if (!stream) return;
  stream.end();
  await once(stream, 'finish');
}

function stripVectorFromMovie(movie) {
  if (!movie || typeof movie !== 'object') {
    return movie;
  }
  // eslint-disable-next-line no-unused-vars
  const { vector, ...rest } = movie;
  return rest;
}

async function writeLocalStoreFromMovies(localPaths, movies, opts = {}) {
  const {
    dryRun = false,
  } = opts;

  const list = Array.isArray(movies) ? movies : [];
  const filtered = [];
  for (const m of list) {
    if (!m?.imdbId) continue;
    if (!isValidEmbeddingVector(m?.vector)) continue;
    const key = String(m?.key || buildMovieKey(m) || '').trim();
    if (!key) continue;
    filtered.push({ ...m, key });
  }

  if (dryRun) {
    return { ok: true, wouldWrite: filtered.length };
  }

  ensureLocalDirs(localPaths);

  const moviesOut = openNdjsonWriteStream(localPaths.moviesNdjsonPath);
  const vectorsOut = openNdjsonWriteStream(localPaths.vectorsNdjsonPath);
  try {
    for (const movie of filtered) {
      await appendNdjson(moviesOut, stripVectorFromMovie(movie));
      await appendNdjson(vectorsOut, { key: movie.key, imdbId: movie.imdbId, vector: movie.vector });
    }
  } finally {
    await closeWriteStream(moviesOut);
    await closeWriteStream(vectorsOut);
  }

  return { ok: true, wrote: filtered.length };
}

async function syncLocalFromDynamo(args, localPaths) {
  const confirmed = args.includes('--yes');
  const dryRun = args.includes('--dry-run');

  if (!dryRun && !confirmed) {
    console.error('[Sync-DynamoDB] Refusing to overwrite local store without --yes.');
    console.error('Run: node fetchMovie.js sync-dynamodb --yes');
    console.error('Or:  node fetchMovie.js sync-dynamodb --dry-run');
    return;
  }

  console.log(`[Sync-DynamoDB] Loading movies from DynamoDB table: ${getDynamoTableName()} ...`);
  const movies = await loadMoviesFromDynamo(args);
  console.log(`[Sync-DynamoDB] Loaded ${movies.length} item(s) from DynamoDB.`);

  const res = await writeLocalStoreFromMovies(localPaths, movies, { dryRun });
  if (dryRun) {
    console.log(`[Sync-DynamoDB] Dry-run: would overwrite local store with ${res.wouldWrite} movie(s).`);
    return;
  }

  console.log(`[Sync-DynamoDB] Done. Local store overwritten with ${res.wrote} movie(s).`);
}

async function fixLocalPlotFields(args, localPaths) {
  const dryRun = args.includes('--dry-run');
  const limit = (() => {
    const v = getFlagNumber(args, '--limit', NaN);
    return Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null;
  })();

  ensureLocalDirs(localPaths);
  const inPath = localPaths.moviesNdjsonPath;
  if (!fs.existsSync(inPath)) {
    console.log(`[Fix-Plots] No local movies file found: ${inPath}`);
    return;
  }

  const tmpPath = `${inPath}.tmp`;
  const inStream = fs.createReadStream(inPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: inStream, crlfDelay: Infinity });
  const outStream = openNdjsonWriteStream(tmpPath);

  let processed = 0;
  let changed = 0;
  let skipped = 0;

  try {
    for await (const line of rl) {
      const s = normalizeNdjsonLine(line);
      if (!s) continue;
      if (limit != null && processed >= limit) break;

      processed += 1;
      try {
        const obj = JSON.parse(s);
        const beforeExpanded = String(obj?.expandedOverview ?? '');
        const beforeDetailed = String(obj?.detailedPlot ?? '');

        postProcessPlotFields(obj);

        const afterExpanded = String(obj?.expandedOverview ?? '');
        const afterDetailed = String(obj?.detailedPlot ?? '');
        if (beforeExpanded !== afterExpanded || beforeDetailed !== afterDetailed) {
          changed += 1;
        }

        await appendNdjson(outStream, obj);
      } catch {
        skipped += 1;
      }
    }
  } finally {
    rl.close();
    await closeWriteStream(outStream);
  }

  if (dryRun) {
    fs.rmSync(tmpPath, { force: true });
    console.log(`[Fix-Plots] Dry-run: processed=${processed} changed=${changed} skipped=${skipped}`);
    return;
  }

  // Replace original file.
  fs.rmSync(inPath, { force: true });
  fs.renameSync(tmpPath, inPath);
  console.log(`[Fix-Plots] Done. processed=${processed} changed=${changed} skipped=${skipped}`);
}

async function fixLocalMoodTags(args, localPaths) {
  requireEnv('OPENAI_API_KEY');

  const dryRun = args.includes('--dry-run');
  const limit = (() => {
    const v = getFlagNumber(args, '--limit', NaN);
    return Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null;
  })();
  const all = args.includes('--all');

  const titleFilter = (() => {
    const idx = args.findIndex(a => a === '--title');
    if (idx >= 0 && args[idx + 1] != null) {
      return String(args[idx + 1] || '').trim().toLowerCase();
    }
    return null;
  })();

  const deleteTitle = (() => {
    const idx = args.findIndex(a => a === '--delete-title');
    if (idx >= 0 && args[idx + 1] != null) {
      return String(args[idx + 1] || '').trim().toLowerCase();
    }
    return null;
  })();

  ensureLocalDirs(localPaths);
  const movieMap = await loadLocalMoviesMap(localPaths);
  const vectorMap = await loadLocalVectorsMap(localPaths);

  const movies = [];
  for (const [key, m] of movieMap.entries()) {
    if (deleteTitle) {
      const t = String(m?.title || '').trim().toLowerCase();
      if (t && t === deleteTitle) {
        continue;
      }
    }
    const vector = vectorMap.get(key);
    if (!isValidEmbeddingVector(vector)) {
      continue;
    }
    movies.push({ ...m, key, imdbId: m?.imdbId || (key.startsWith('tt') ? key : undefined), vector });
  }

  console.log(`[Fix-MoodTags] Loaded ${movies.length} local movie(s). dryRun=${dryRun} limit=${limit ?? '(none)'} title=${titleFilter ?? '(all)'} all=${all} deleteTitle=${deleteTitle ?? '(none)'}`);

  let processed = 0;
  let changed = 0;

  for (const movie of movies) {
    if (limit != null && processed >= limit) break;
    if (titleFilter) {
      const t = String(movie?.title || '').trim().toLowerCase();
      if (t !== titleFilter) {
        continue;
      }
    }

    processed += 1;

    const hasFiveMoodTags = Array.isArray(movie.moodTags) && movie.moodTags.length === 5;
    if (!all && hasFiveMoodTags) {
      continue;
    }

    if (!shouldGenerateMoodTags(movie)) {
      continue;
    }

    const next = { ...movie };
    if (!Array.isArray(next.moodTags)) next.moodTags = [];

    if (!dryRun) {
      next.moodTags = await generateMoodTags(next);
      const embeddingText = buildMovieEmbeddingText(next);
      const vector = await generateEmbedding(embeddingText);
      if (isValidEmbeddingVector(vector)) {
        next.vector = vector;
      }
    }

    // Apply back to array in-place.
    Object.assign(movie, next);
    changed += 1;
    console.log(`[Fix-MoodTags] Updated: ${movie.title} -> ${Array.isArray(movie.moodTags) ? movie.moodTags.join(', ') : ''}`);
  }

  if (dryRun) {
    console.log(`[Fix-MoodTags] Dry-run complete. Would process=${processed}, wouldChange=${changed}.`);
    return;
  }

  const res = await writeLocalStoreFromMovies(localPaths, movies);
  console.log(`[Fix-MoodTags] Done. processed=${processed}, changed=${changed}, rewrote=${res.wrote}.`);
}

async function deployLocalToDynamo(args, localPaths) {
  const confirmed = args.includes('--yes');
  const dryRun = args.includes('--dry-run');
  const purgeFirst = args.includes('--purge-first') || args.includes('--purge') || args.includes('--truncate-first');
  const limit = getDynamoScanLimit(args);

  if (!dryRun && !confirmed) {
    console.error('[Deploy-DynamoDB] Refusing to write without --yes.');
    console.error('Run: node fetchMovie.js deploy-dynamodb --yes');
    console.error('Or:  node fetchMovie.js deploy-dynamodb --dry-run');
    return;
  }

  ensureLocalDirs(localPaths);
  const stored = await loadLocalMoviesForSearch(localPaths);
  const valid = stored
    .filter(m => m && m.imdbId && isValidEmbeddingVector(m.vector))
    .map(m => ({ ...m, key: String(m?.key || buildMovieKey(m) || '').trim() }))
    .filter(m => !!m.key);

  const subset = (limit && valid.length > limit) ? valid.slice(0, limit) : valid;
  console.log(`[Deploy-DynamoDB] Local valid movies=${valid.length}${limit ? ` (limit=${limit})` : ''}`);

  if (dryRun) {
    console.log(`[Deploy-DynamoDB] Dry-run: would write ${subset.length} item(s) to DynamoDB table: ${getDynamoTableName()}`);
    if (purgeFirst) {
      console.log('[Deploy-DynamoDB] Dry-run: would purge DynamoDB first.');
    }
    return;
  }

  const tableName = getDynamoTableName();
  const docClient = getDynamoDocClient();

  if (purgeFirst) {
    console.log('[Deploy-DynamoDB] Purging DynamoDB first to ensure exact consistency...');
    await purgeDynamoTable(['deploy-dynamodb', '--yes']);
  }

  // eslint-disable-next-line global-require
  const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

  let written = 0;
  const maxItems = subset.length;

  const toPutReq = (movie) => {
    const item = {
      ...movie,
      titleLower: String(movie.title || '').toLowerCase(),
      year: movie.year,
    };
    return { PutRequest: { Item: item } };
  };

  for (let i = 0; i < maxItems; i += 25) {
    const batchMovies = subset.slice(i, i + 25);
    let req = {
      RequestItems: {
        [tableName]: batchMovies.map(toPutReq),
      },
    };

    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await docClient.send(new BatchWriteCommand(req));
      const unprocessed = res?.UnprocessedItems?.[tableName] || [];
      const done = batchMovies.length - unprocessed.length;
      written += done;

      if (!unprocessed || unprocessed.length === 0) {
        break;
      }
      if (attempt === 6) {
        console.warn(`[Deploy-DynamoDB] Unprocessed items remain after retries: ${unprocessed.length}`);
        break;
      }
      req = { RequestItems: { [tableName]: unprocessed } };
      await sleep(Math.min(2000, 200 * attempt));
    }

    if (written > 0 && written % 500 === 0) {
      console.log(`[Deploy-DynamoDB] progress written=${written}/${maxItems}`);
    }
  }

  console.log(`[Deploy-DynamoDB] Done. Wrote ${written}/${maxItems} item(s) to DynamoDB table: ${tableName}`);
}

function coerceMovieFromLocalLine(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const movie = { ...item };
  if (Array.isArray(movie.moodTags)) {
    movie.moodTags = movie.moodTags.map(String).map(s => s.trim()).filter(Boolean);
  }
  return movie;
}

async function loadLocalMoviesMap(localPaths) {
  const movies = await readNdjsonToArray(localPaths.moviesNdjsonPath, {
    mapFn: (obj) => (typeof obj === 'object' && obj ? coerceMovieFromLocalLine(obj) : undefined),
  });

  const map = new Map();
  for (const m of movies) {
    const key = String(m?.key || buildMovieKey(m) || '').trim();
    if (!key) continue;
    map.set(key, m);
  }
  return map;
}

async function loadLocalVectorsMap(localPaths) {
  const rows = await readNdjsonToArray(localPaths.vectorsNdjsonPath, {
    mapFn: (obj) => (typeof obj === 'object' && obj ? obj : undefined),
  });

  const map = new Map();
  for (const r of rows) {
    const key = String(r?.key || r?.imdbId || '').trim();
    if (!key) continue;
    if (Array.isArray(r.vector)) {
      map.set(key, r.vector.map(Number));
    }
  }
  return map;
}

async function loadLocalMoviesForSearch(localPaths) {
  const movieMap = await loadLocalMoviesMap(localPaths);
  const vectorMap = await loadLocalVectorsMap(localPaths);

  const out = [];
  for (const [key, m] of movieMap.entries()) {
    const vector = vectorMap.get(key);
    out.push(vector ? { ...m, key, vector } : { ...m, key });
  }

  for (const [key, vector] of vectorMap.entries()) {
    if (movieMap.has(key)) continue;
    out.push({ key, imdbId: key.startsWith('tt') ? key : undefined, vector });
  }

  return out;
}

function upsertMovieByTitle(existing, movie) {
  const titleKey = String(movie?.title || '').trim().toLowerCase();
  if (!titleKey) {
    return existing;
  }

  const next = Array.isArray(existing) ? [...existing] : [];
  const idx = next.findIndex(m => String(m?.title || '').trim().toLowerCase() === titleKey);
  if (idx >= 0) {
    next[idx] = { ...next[idx], ...movie };
  } else {
    next.push(movie);
  }
  return next;
}

async function buildOneMovie(title, opts = {}) {
  const movie = await fetchMovieData(title, opts);
  if (!movie) {
    return null;
  }

  // expandedOverview/detailedPlot are generated inside fetchMovieData.
  // Only fill missing fields if needed.
  if (!movie.expandedOverview && movie.detailedPlot) {
    movie.expandedOverview = extractiveOverviewFromPlot(movie.detailedPlot, 420);
  }
  if (!movie.detailedPlot && movie.expandedOverview) {
    movie.detailedPlot = movie.expandedOverview;
  }
  if (!movie.expandedOverview && !movie.detailedPlot) {
    if (opts?.fast) {
      movie.detailedPlot = movie.plot || '';
      movie.expandedOverview = extractiveOverviewFromPlot(movie.detailedPlot, 420);
    } else {
      movie.expandedOverview = await generateExpandedOverview(movie.plot || '');
      movie.detailedPlot = movie.plot || movie.expandedOverview;
    }
  }

  postProcessPlotFields(movie);

  // 融合 plot/detailedPlot/expandedOverview 成 unifiedPlot
  const plots = [movie.plot, movie.detailedPlot, movie.expandedOverview]
    .map(s => String(s || '').trim())
    .filter(Boolean);
  // 避免重複，合併時去掉重複片段
  let unified = '';
  let last = '';
  for (const p of plots) {
    if ((p && !last) || (last && !p.startsWith(last))) {
      if (unified && !unified.endsWith('。') && !unified.endsWith('.')) unified += ' ';
      unified += p;
      last = p.slice(0, 40);
    }
  }
  movie.unifiedPlot = unified.trim();

  const validation = validateMovieForStorage(movie);
  if (!validation.ok) {
    throw new Error(`[INCOMPLETE] missing fields: ${validation.missing.join(', ')}`);
  }

  const minImdbRating = Number(opts?.minImdbRating);
  if (Number.isFinite(minImdbRating)) {
    const rating = Number(movie?.imdbRating);
    if (!Number.isFinite(rating) || rating < minImdbRating) {
      return null;
    }
  }

  const wantMoodTags = (!opts?.fast) || !!opts?.moodTags;
  if (!Array.isArray(movie.moodTags)) {
    movie.moodTags = [];
  }
  if (movie.moodTags.length === 0 && wantMoodTags && shouldGenerateMoodTags(movie)) {
    movie.moodTags = await generateMoodTags(movie);
  }

  const embeddingText = buildMovieEmbeddingText(movie);
  const vector = await generateEmbedding(embeddingText);
  if (!isValidEmbeddingVector(vector)) {
    console.error(`[Build] Invalid embedding vector for: ${title}`);
    return null;
  }
  movie.vector = vector;
  return movie;
}

function getFlagNumber(args, name, defaultValue) {
  const idx = args.findIndex(a => a === name);
  if (idx >= 0 && args[idx + 1] != null) {
    const v = Number(args[idx + 1]);
    if (Number.isFinite(v)) {
      return v;
    }
  }
  return defaultValue;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchPopularSeedsFromTMDb({ pages, minVotes }) {
  return fetchMovieSeedsFromTMDb({ pages, minVotes, category: 'popular' });
}

async function fetchMovieSeedsFromTMDb({ pages, minVotes, minVoteAverage, category }) {
  const apiKey = requireEnv('TMDB_API_KEY');
  const results = [];

  const cat = (category || 'popular').toLowerCase();
  const endpoint = (cat === 'top-rated' || cat === 'top_rated' || cat === 'toprated')
    ? 'top_rated'
    : 'popular';

  const minAvg = (minVoteAverage == null)
    ? null
    : (Number.isFinite(Number(minVoteAverage)) ? Number(minVoteAverage) : null);

  for (let page = 1; page <= pages; page++) {
    if (page === 1 || page % 10 === 0 || page === pages) {
      const minAvgText = minAvg != null ? ` minVoteAverage>=${minAvg}` : '';
      console.log(`[TMDb] Fetching ${endpoint} page ${page}/${pages} (minVotes>=${minVotes}${minAvgText})`);
    }
    const url = `https://api.themoviedb.org/3/movie/${endpoint}?api_key=${encodeURIComponent(apiKey)}&language=en-US&page=${page}`;
    const resp = await axiosGetWithRetry(url, {}, { label: `tmdb.${endpoint}.page.${page}`, timeoutMs: 15000, maxAttempts: 5 });
    const items = Array.isArray(resp.data?.results) ? resp.data.results : [];
    for (const item of items) {
      const title = String(item?.title || item?.original_title || '').trim();
      if (!title) continue;
      const voteCount = Number(item?.vote_count || 0);
      if (Number.isFinite(minVotes) && voteCount < minVotes) continue;
      const voteAverage = Number(item?.vote_average || 0);
      if (minAvg != null && (!Number.isFinite(voteAverage) || voteAverage < minAvg)) continue;

      const releaseDate = String(item?.release_date || '').trim();
      const year = releaseDate ? releaseDate.slice(0, 4) : '';
      results.push({
        tmdbId: item?.id,
        title,
        year,
        voteCount,
        voteAverage,
        popularity: Number(item?.popularity || 0),
      });
    }
  }

  // De-dupe by title+year (best-effort)
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = `${String(r.title).toLowerCase()}|${String(r.year || '').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return deduped;
}

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'build').toLowerCase();

  if (command === '--help' || command === '-h' || command === 'help') {
    usage();
    return;
  }

  const localPaths = getLocalPaths();

  if (command === 'purge-dynamodb' || command === 'purge-ddb' || command === 'truncate-dynamodb') {
    // Intentionally does NOT require OPENAI_API_KEY.
    await purgeDynamoTable(args);
    return;
  }

  if (command === 'sync-dynamodb' || command === 'sync-ddb') {
    // Intentionally does NOT require OPENAI_API_KEY.
    await syncLocalFromDynamo(args, localPaths);
    return;
  }

  if (command === 'deploy-dynamodb' || command === 'deploy-ddb') {
    // Intentionally does NOT require OPENAI_API_KEY.
    await deployLocalToDynamo(args, localPaths);
    return;
  }

  // === New: count command ===
  if (command === 'count') {
    const useDynamo = shouldReadFromDynamo(args);
    if (useDynamo) {
      try {
        const movies = await loadMoviesFromDynamo(args);
        console.log(`[Count] DynamoDB contains ${movies.length} movie(s).`);
      } catch (err) {
        console.error(`[Count] Failed to load from DynamoDB: ${err?.message || err}`);
      }
    } else {
      ensureLocalDirs(localPaths);
      const stored = await loadLocalMoviesForSearch(localPaths);
      const valid = stored.filter(m => isValidEmbeddingVector(m?.vector));
      console.log(`[Count] Local NDJSON store contains ${valid.length} movie(s) with valid vectors.`);
    }
    return;
  }

  if (command === 'fix-plots' || command === 'fix-plot' || command === 'fix-plot-fields') {
    await fixLocalPlotFields(args, localPaths);
    return;
  }

  if (command === 'fix-moodtags' || command === 'fix-moodtag' || command === 'fix-mood-tags' || command === 'fix-mood_tags') {
    await fixLocalMoodTags(args, localPaths);
    return;
  }

  if (command === 'search') {
    requireEnv('OPENAI_API_KEY');
    const storedMovieData = await loadStoredMoviesForSearch(args);
    const validation = validateStoredMovieData(storedMovieData);
    if (!validation.ok) {
      console.error(`Cannot search: ${validation.reason}`);
      console.error('Run: node fetchMovie.js build (or use --dynamodb)');
      return;
    }

    const TOP_K = Math.max(1, Math.min(50, Math.floor(getFlagNumber(args, '--topk', 5))));
    const asJson = args.includes('--json');
    const queryArgs = stripArgs(args.slice(1), ['--dynamodb', '--ddb', '--limit', '--topk', '--json']);
    const oneShotQuery = queryArgs.join(' ').trim();
    if (oneShotQuery) {
      const queryInfo = await generateMultilingualQueryEmbeddingWithText(oneShotQuery);
      const queryEmbedding = queryInfo.embedding;
      if (!isValidEmbeddingVector(queryEmbedding)) {
        if (asJson) {
          console.log(JSON.stringify({ ok: false, error: 'Invalid query embedding' }));
        } else {
          console.log('Query embedding 無效，請再試一次。');
        }
        return;
      }

      if (isAnchoredWorldWarIIQuery(queryInfo.original, queryInfo.english)) {
        const hasAnyWWII = storedMovieData.some(m => movieMentionsWorldWarII(buildMovieSearchText(m)));
        if (!hasAnyWWII) {
          console.log('No relevant movies found.');
          return;
        }
      }

      const moodPreferences = await inferMoodPreferencesFromQuery(oneShotQuery);
      const moodish = (moodPreferences?.want?.length || 0) > 0 || (moodPreferences?.avoid?.length || 0) > 0;
      const candidates = moodish
        ? storedMovieData
        : await getCandidateMoviesForQuery(queryEmbedding, storedMovieData, Math.max(50, TOP_K));
      const top = rankMoviesWithSignals(queryEmbedding, candidates, moodPreferences, queryInfo, TOP_K);
      const best = top[0];

      if (!best) {
        if (asJson) {
          console.log(JSON.stringify({
            ok: true,
            query: oneShotQuery,
            queryEnglish: queryInfo?.english && queryInfo.english !== queryInfo.original ? queryInfo.english : undefined,
            mood: moodPreferences,
            topK: TOP_K,
            results: [],
          }, null, 2));
        } else {
          console.log('No relevant movies found.');
        }
        return;
      }

      if (asJson) {
        console.log(JSON.stringify({
          ok: true,
          query: oneShotQuery,
          queryEnglish: queryInfo?.english && queryInfo.english !== queryInfo.original ? queryInfo.english : undefined,
          mood: moodPreferences,
          topK: TOP_K,
          results: top,
        }, null, 2));
        return;
      }

      console.log(`\n[Query] ${oneShotQuery}`);
      if (queryInfo.english && queryInfo.english.toLowerCase() !== queryInfo.original.toLowerCase()) {
        console.log(`[EN] ${queryInfo.english}`);
      }
      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        const wantText = moodPreferences.want.length > 0 ? moodPreferences.want.join(', ') : '(none)';
        const avoidText = moodPreferences.avoid.length > 0 ? moodPreferences.avoid.join(', ') : '(none)';
        console.log(`Mood intent (want): ${wantText}`);
        console.log(`Mood intent (avoid): ${avoidText}`);
      }

      console.log('Top results:');
      for (const r of top) {
        const terms = r.matchedTerms.length > 0 ? ` terms=[${r.matchedTerms.join(', ')}]` : '';
        const mw = r.matchedWantTags.length > 0 ? ` want=[${r.matchedWantTags.join(', ')}]` : '';
        const ma = r.matchedAvoidTags.length > 0 ? ` avoid=[${r.matchedAvoidTags.join(', ')}]` : '';
        console.log(`- ${r.title} | score=${r.score.toFixed(4)} | sim=${r.similarity.toFixed(4)} | lex=${r.lexicalBoost.toFixed(3)}${terms}${mw}${ma}`);
      }
      return;
    }

    await promptQueryLoop(storedMovieData);
    return;
  }

  if (command === 'search-batch') {
    requireEnv('OPENAI_API_KEY');
    const storedMovieData = await loadStoredMoviesForSearch(args);
    const validation = validateStoredMovieData(storedMovieData);
    if (!validation.ok) {
      console.error(`Cannot search: ${validation.reason}`);
      console.error('Run: node fetchMovie.js build');
      return;
    }

    const batchArgs = stripArgs(args.slice(1), ['--dynamodb', '--ddb', '--limit']);
    const queriesFile = batchArgs[0]
      ? path.resolve(process.cwd(), batchArgs[0])
      : localPaths.queriesPath;

    let queries;
    try {
      queries = JSON.parse(fs.readFileSync(queriesFile, 'utf8'));
    } catch (error) {
      console.error(`Cannot read queries file: ${queriesFile}`);
      console.error(error?.message || error);
      return;
    }

    if (!Array.isArray(queries) || queries.length === 0) {
      console.error('Queries file must be a non-empty JSON array.');
      return;
    }

    const TOP_K = (() => {
      const v = getFlagNumber(batchArgs, '--topk', 5);
      return Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 5;
    })();

    const outJsonPath = (() => {
      const idx = batchArgs.findIndex(a => String(a).toLowerCase() === '--out-json');
      if (idx >= 0 && batchArgs[idx + 1]) {
        return path.resolve(process.cwd(), String(batchArgs[idx + 1]));
      }
      return null;
    })();

    const reportRows = [];
    let pass = 0;
    let fail = 0;

    for (const item of queries) {
      const query = String(item?.query || '').trim();
      if (!query) {
        continue;
      }

      const expectedRaw = item?.expected;
      const expectedTitleRaw = item?.expectedTitle ?? expectedRaw;
      const expectedImdbRaw = item?.expectedImdbId ?? item?.expectedImdbIds;
      const expectedKeyRaw = item?.expectedKey ?? item?.expectedKeys;

      const expectedTitles = Array.isArray(expectedTitleRaw)
        ? expectedTitleRaw.map(String).map(s => s.trim()).filter(Boolean)
        : (expectedTitleRaw ? [String(expectedTitleRaw).trim()].filter(Boolean) : []);

      const expectedImdbIds = Array.isArray(expectedImdbRaw)
        ? expectedImdbRaw.map(String).map(s => s.trim()).filter(Boolean)
        : (expectedImdbRaw ? [String(expectedImdbRaw).trim()].filter(Boolean) : []);

      const expectedKeys = Array.isArray(expectedKeyRaw)
        ? expectedKeyRaw.map(String).map(s => s.trim()).filter(Boolean)
        : (expectedKeyRaw ? [String(expectedKeyRaw).trim()].filter(Boolean) : []);

      const hasExpectations = expectedTitles.length > 0 || expectedImdbIds.length > 0 || expectedKeys.length > 0;

      const queryInfo = await generateMultilingualQueryEmbeddingWithText(query);
      const queryEmbedding = queryInfo.embedding;
      if (!isValidEmbeddingVector(queryEmbedding)) {
        console.log(`\n[Query] ${query}`);
        console.log('No relevant movies found.');
        if (hasExpectations) {
          fail += 1;
        }

        reportRows.push({
          query,
          queryEnglish: queryInfo?.english && queryInfo.english !== queryInfo.original ? queryInfo.english : undefined,
          expectedTitles,
          expectedImdbIds,
          expectedKeys,
          results: [],
          pass: !hasExpectations,
          reason: 'invalid_query_embedding',
        });
        continue;
      }

      // Anchored WWII: if none exist in DB, it's a hard "no".
      if (isAnchoredWorldWarIIQuery(queryInfo.original, queryInfo.english)) {
        const hasAnyWWII = storedMovieData.some(m => movieMentionsWorldWarII(buildMovieSearchText(m)));
        if (!hasAnyWWII) {
          console.log(`\n[Query] ${query}`);
          console.log('No relevant movies found.');
          if (hasExpectations) {
            fail += 1;
          }

          reportRows.push({
            query,
            queryEnglish: queryInfo?.english && queryInfo.english !== queryInfo.original ? queryInfo.english : undefined,
            expectedTitles,
            expectedImdbIds,
            expectedKeys,
            results: [],
            pass: !hasExpectations,
            reason: 'anchored_wwii_but_no_wwii_in_db',
          });
          continue;
        }
      }

      const moodPreferences = await inferMoodPreferencesFromQuery(query);
      const moodish = (moodPreferences?.want?.length || 0) > 0 || (moodPreferences?.avoid?.length || 0) > 0;
      const candidates = moodish
        ? storedMovieData
        : await getCandidateMoviesForQuery(queryEmbedding, storedMovieData, 50);
      const top = rankMoviesWithSignals(queryEmbedding, candidates, moodPreferences, queryInfo, TOP_K);
      const best = top[0];

      console.log(`\n[Query] ${query}`);
      if (queryInfo.english && queryInfo.english.toLowerCase() !== queryInfo.original.toLowerCase()) {
        console.log(`[EN] ${queryInfo.english}`);
      }

      if (!best) {
        console.log('No relevant movies found.');
        if (hasExpectations) {
          fail += 1;
        }

        reportRows.push({
          query,
          queryEnglish: queryInfo?.english && queryInfo.english !== queryInfo.original ? queryInfo.english : undefined,
          expectedTitles,
          expectedImdbIds,
          expectedKeys,
          results: [],
          pass: !hasExpectations,
          reason: 'no_results',
        });
        continue;
      }

      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        console.log(`[Mood want] ${moodPreferences.want.join(', ') || '(none)'}`);
        console.log(`[Mood avoid] ${moodPreferences.avoid.join(', ') || '(none)'}`);
      }

      console.log('Top results:');
      for (const r of top) {
        const terms = r.matchedTerms.length > 0 ? ` terms=[${r.matchedTerms.join(', ')}]` : '';
        const mw = r.matchedWantTags.length > 0 ? ` want=[${r.matchedWantTags.join(', ')}]` : '';
        const ma = r.matchedAvoidTags.length > 0 ? ` avoid=[${r.matchedAvoidTags.join(', ')}]` : '';
        console.log(`- ${r.title} | score=${r.score.toFixed(4)} | sim=${r.similarity.toFixed(4)} | lex=${r.lexicalBoost.toFixed(3)}${terms}${mw}${ma}`);
      }

      const resultMatchesAnyExpectation = (row) => {
        if (!row) return false;
        const t = String(row.title || '').trim().toLowerCase();
        const imdb = String(row.imdbId || '').trim().toLowerCase();
        const k = String(row.key || '').trim();
        if (expectedTitles.length > 0 && expectedTitles.some(x => String(x).trim().toLowerCase() === t)) return true;
        if (expectedImdbIds.length > 0 && expectedImdbIds.some(x => String(x).trim().toLowerCase() === imdb)) return true;
        if (expectedKeys.length > 0 && expectedKeys.some(x => String(x).trim() === k)) return true;
        return false;
      };

      const didPass = hasExpectations
        ? top.some(resultMatchesAnyExpectation)
        : top.length === 0;

      if (hasExpectations) {
        if (didPass) {
          console.log(`Result: PASS (hit within top ${TOP_K})`);
          pass += 1;
        } else {
          const expParts = [];
          if (expectedTitles.length > 0) expParts.push(`title=${expectedTitles.join(' | ')}`);
          if (expectedImdbIds.length > 0) expParts.push(`imdbId=${expectedImdbIds.join(' | ')}`);
          if (expectedKeys.length > 0) expParts.push(`key=${expectedKeys.join(' | ')}`);
          console.log(`Result: FAIL (expected: ${expParts.join(' ; ')})`);
          fail += 1;
        }
      }

      reportRows.push({
        query,
        queryEnglish: queryInfo?.english && queryInfo.english !== queryInfo.original ? queryInfo.english : undefined,
        expectedTitles,
        expectedImdbIds,
        expectedKeys,
        results: top.map(r => ({
          title: r.title,
          imdbId: r.imdbId,
          key: r.key,
          score: r.score,
          similarity: r.similarity,
          lexicalBoost: r.lexicalBoost,
          matchedTerms: r.matchedTerms,
          matchedWantTags: r.matchedWantTags,
          matchedAvoidTags: r.matchedAvoidTags,
        })),
        pass: didPass,
      });
    }

    if (pass + fail > 0) {
      console.log(`\nSummary: PASS=${pass} FAIL=${fail}`);
    }

    if (outJsonPath) {
      try {
        fs.writeFileSync(outJsonPath, JSON.stringify({
          ok: true,
          topK: TOP_K,
          pass,
          fail,
          totalWithExpectation: pass + fail,
          rows: reportRows,
        }, null, 2));
        console.log(`Wrote report: ${outJsonPath}`);
      } catch (e) {
        console.warn(`Cannot write report JSON: ${outJsonPath} (${e?.message || e})`);
      }
    }
    return;
  }

  if (command === 'build-popular') {
    requireEnv('OPENAI_API_KEY');
    requireEnv('TMDB_API_KEY');
    if (!hasEnv('OMDB_API_KEY')) {
      console.log('OMDB_API_KEY is missing. Build will use Wikipedia-only fallback (less accurate metadata).');
    }

    const count = Math.floor(getFlagNumber(args, '--count', 100));
    const pages = Math.floor(getFlagNumber(args, '--pages', 10));
    const minVotes = Math.floor(getFlagNumber(args, '--min-votes', 500));
    const minVoteAverage = getFlagNumber(args, '--min-vote-average', NaN);
    const minImdbRating = getFlagNumber(args, '--min-imdb-rating', NaN);
    const delayMs = Math.floor(getFlagNumber(args, '--delay-ms', 350));
    const resample = args.includes('--resample');
    const fastMode = args.includes('--fast');
    const moodTagsMode = args.includes('--moodtags') || args.includes('--mood-tags') || args.includes('--mood_tags');
    const useTopRated = args.includes('--top-rated') || args.includes('--top_rated') || args.includes('--toprated');

    // Goal: end with at least this many movies in the local store.
    // We oversample seeds because some titles may be skipped or fail.
    const targetTotal = Math.max(0, count);
    const hasImdbGate = Number.isFinite(Number(minImdbRating));
    const oversampleMultiplier = hasImdbGate ? 6.0 : 2.0;
    const seedOversample = Math.max(targetTotal, Math.ceil(targetTotal * oversampleMultiplier));

    const freshBuild = args.includes('--fresh') || args.includes('--reset');
    const toDynamo = shouldWriteToDynamo(args);

    ensureLocalDirs(localPaths);
    if (freshBuild) {
      fs.rmSync(localPaths.moviesNdjsonPath, { force: true });
      fs.rmSync(localPaths.vectorsNdjsonPath, { force: true });
    }

    const moviesOut = openNdjsonAppendStream(localPaths.moviesNdjsonPath);
    const vectorsOut = openNdjsonAppendStream(localPaths.vectorsNdjsonPath);

    const movieMap = freshBuild ? new Map() : await loadLocalMoviesMap(localPaths);
    const titleYearSet = new Set();
    for (const m of movieMap.values()) {
      const t = String(m?.title || '').trim().toLowerCase();
      if (!t) continue;
      const y = String(m?.year || '').trim();
      titleYearSet.add(`${t}|${y}`);
    }

    const seedsPath = useTopRated ? localPaths.topRatedSeedsPath : localPaths.popularSeedsPath;
    let seeds;
    if (!resample && fs.existsSync(seedsPath)) {
      try {
        seeds = await readNdjsonToArray(seedsPath, { mapFn: (x) => x });
      } catch {
        seeds = [];
      }
      console.log(`[Build-Popular] Loaded ${seeds.length} seed(s) from ${seedsPath}`);
      if (seeds.length > 0 && seeds.length < seedOversample) {
        console.log(`[Build-Popular] Cached seeds (${seeds.length}) < required (${seedOversample}). Will refetch.`);
        seeds = [];
      }
    }

    if (!Array.isArray(seeds) || seeds.length === 0) {
      const category = useTopRated ? 'top_rated' : 'popular';
      const minAvg = Number.isFinite(Number(minVoteAverage)) ? Number(minVoteAverage) : null;
      const minAvgText = minAvg != null ? `, minVoteAverage=${minAvg}` : '';
      console.log(`[Build-Popular] Fetching TMDb ${useTopRated ? 'top_rated' : 'popular'} seeds: pages=${pages}, minVotes=${minVotes}${minAvgText}`);
      const fetched = await fetchMovieSeedsFromTMDb({ pages, minVotes, minVoteAverage: minAvg, category });
      shuffleInPlace(fetched);
      seeds = fetched.slice(0, seedOversample);

      fs.rmSync(seedsPath, { force: true });
      const seedsOut = openNdjsonAppendStream(seedsPath);
      try {
        for (const s of seeds) {
          await appendNdjson(seedsOut, s);
        }
      } finally {
        await closeWriteStream(seedsOut);
      }
      console.log(`[Build-Popular] Sampled ${seeds.length} seed(s) and saved (NDJSON) to ${seedsPath}`);
    }

    if (seeds.length === 0) {
      console.error('[Build-Popular] No seeds to process. Try lowering --min-votes or increasing --pages.');
      return;
    }

    const tableName = toDynamo ? getDynamoTableName() : '';
    const ddbDoc = toDynamo ? getDynamoDocClient() : null;
    const ddbErrorTitles = [];

    const runId = makeRunId();
    const skippedTitles = [];
    const incompleteTitles = [];
    const errorTitles = [];
    const alreadyHaveTitles = [];

    const minImdbText = Number.isFinite(Number(minImdbRating)) ? ` minImdbRating>=${Number(minImdbRating)}` : '';
    console.log(`[Build-Popular] Starting. targetTotal=${targetTotal} seeds=${seeds.length} fresh=${freshBuild} delayMs=${delayMs} dynamodb=${toDynamo} fast=${fastMode}${minImdbText}`);

    try {
      for (let i = 0; i < seeds.length; i++) {
        const seed = seeds[i];
        const title = String(seed?.title || '').trim();
        const year = seed?.year ? String(seed.year).trim() : '';
        if (!title) {
          continue;
        }

        if (targetTotal > 0 && movieMap.size >= targetTotal) {
          console.log(`\n[Build-Popular] Reached targetTotal=${targetTotal}. Stopping early.`);
          break;
        }

        const titleKey = title.toLowerCase();
        const already = titleYearSet.has(`${titleKey}|${year}`);
        if (already) {
          console.log(`\n[Build-Popular] (${i + 1}/${seeds.length}) Already have: ${title}${year ? ` (${year})` : ''}`);
          alreadyHaveTitles.push(title);
          continue;
        }

        console.log(`\n[Build-Popular] (${i + 1}/${seeds.length}) Processing: ${title}${year ? ` (${year})` : ''}`);
        try {
          const movie = await buildOneMovie(title, {
            year,
            fast: fastMode,
            moodTags: moodTagsMode,
            quiet: true,
            minImdbRating: Number.isFinite(Number(minImdbRating)) ? Number(minImdbRating) : undefined,
          });
          if (!movie) {
            console.log(`[Build] Skipped: ${title}`);
            skippedTitles.push(title);
            continue;
          }

          // Persist TMDb seed signals (helps export/sorting even when imdbRating is missing).
          if (seed && typeof seed === 'object') {
            if (movie.tmdbId == null && seed.tmdbId != null) movie.tmdbId = seed.tmdbId;
            if (movie.tmdbVoteAverage == null && seed.voteAverage != null) movie.tmdbVoteAverage = seed.voteAverage;
            if (movie.tmdbVoteCount == null && seed.voteCount != null) movie.tmdbVoteCount = seed.voteCount;
            if (movie.tmdbPopularity == null && seed.popularity != null) movie.tmdbPopularity = seed.popularity;
          }

          const key = buildMovieKey(movie);
          movie.key = key;

          // Safety: if we already have this key in the local store, do NOT append duplicates.
          if (movieMap.has(key)) {
            console.log(`[Build] Already have (key match); skipping save: ${movie.title}`);
            alreadyHaveTitles.push(movie.title);
            continue;
          }

          // Local-first: persist locally, then (optionally) deploy to DynamoDB.
          await appendNdjson(moviesOut, stripVectorFromMovie(movie));
          await appendNdjson(vectorsOut, { key, imdbId: movie.imdbId, vector: movie.vector });
          console.log(`[Build] Appended (NDJSON): ${movie.title}`);

          movieMap.set(key, stripVectorFromMovie(movie));
          titleYearSet.add(`${String(movie.title || '').trim().toLowerCase()}|${String(movie.year || '').trim()}`);

          if (toDynamo) {
            try {
              await putMovieToDynamo(ddbDoc, tableName, movie);
              console.log(`[Build] Saved to DynamoDB: ${movie.title} -> ${tableName}`);
            } catch (ddbError) {
              console.error(`[Build] DynamoDB write failed for "${movie.title}": ${ddbError?.message || ddbError}`);
              ddbErrorTitles.push(movie.title);
            }
          }
        } catch (error) {
          const message = String(error?.message || error);
          if (message.includes('[INCOMPLETE]')) {
            console.log(`[Build] Incomplete: ${title} -> ${message}`);
            incompleteTitles.push(title);
          } else {
            console.log(`[Build] Error processing "${title}": ${message}`);
            errorTitles.push(title);
          }
          console.log(`[Build] Skipped: ${title}`);
        } finally {
          if (delayMs > 0 && i < seeds.length - 1) {
            await sleep(delayMs);
          }
        }
      }
    } finally {
      await closeWriteStream(moviesOut);
      await closeWriteStream(vectorsOut);
    }

    console.log(`\nDone. Processed ${seeds.length} seed(s). Local store now contains ${movieMap.size} movie(s).`);
    if (alreadyHaveTitles.length > 0) {
      console.log(`\n=== 已存在（略過）===`);
      console.log(`- ${alreadyHaveTitles.slice(0, 40).join(' | ')}${alreadyHaveTitles.length > 40 ? ' ...' : ''}`);
    }

    const notSaved = [...new Set([...skippedTitles, ...incompleteTitles, ...errorTitles])];
    if (notSaved.length > 0) {
      console.log('\n=== 未成功儲存的電影（抓不到 / 資訊不完整 / 例外）===');
      if (skippedTitles.length > 0) {
        console.log(`- 抓不到或向量無效（Skipped）: ${skippedTitles.join(' | ')}`);
      }
      if (incompleteTitles.length > 0) {
        console.log(`- 資訊不完整（Incomplete）: ${incompleteTitles.join(' | ')}`);
      }
      if (errorTitles.length > 0) {
        console.log(`- 其他錯誤（Error）: ${errorTitles.join(' | ')}`);
      }
    }

    if (toDynamo) {
      if (ddbErrorTitles.length > 0) {
        console.log(`\n=== DynamoDB 寫入失敗（本地已寫入；建議稍後用 deploy-dynamodb 重送/部署）===`);
        console.log(`- ${ddbErrorTitles.join(' | ')}`);
      } else {
        console.log(`\nDynamoDB write complete: ${tableName}`);
      }
    }

    // Run artifacts (helps large batch reliability / post-mortem)
    const baseName = `build-popular_${runId}`;
    writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_summary.json`), {
      runId,
      command: 'build-popular',
      targetTotal,
      seedsProcessed: seeds.length,
      localTotalAfter: movieMap.size,
      skipped: skippedTitles.length,
      incomplete: incompleteTitles.length,
      errors: errorTitles.length,
      alreadyHave: alreadyHaveTitles.length,
      dynamodb: toDynamo ? { enabled: true, tableName, writeFailures: ddbErrorTitles.length } : { enabled: false },
      fast: fastMode,
      delayMs,
      timestamp: new Date().toISOString(),
    });
    if (skippedTitles.length > 0) {
      writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_skipped_titles.json`), skippedTitles);
    }
    if (errorTitles.length > 0) {
      writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_error_titles.json`), errorTitles);
    }
    if (ddbErrorTitles.length > 0) {
      writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_dynamodb_write_failed_titles.json`), ddbErrorTitles);
    }


    // Always persist incomplete_titles.json (even if empty)
    try {
      const outPath = localPaths.incompleteTitlesPath;
      writeJsonArrayOrThrow(outPath, incompleteTitles);
      if (incompleteTitles.length > 0) {
        console.log(`\n[Incomplete] Saved ${incompleteTitles.length} title(s) to: ${outPath}`);
      } else {
        console.log(`\n[Incomplete] No incomplete titles. Empty file written to: ${outPath}`);
      }
    } catch (e) {
      console.warn(`[Incomplete] Failed to write incomplete titles list: ${e?.message || e}`);
    }
    return;
  }

  if (command !== 'build') {
    usage();
    return;
  }

  requireEnv('OPENAI_API_KEY');
  if (!hasEnv('OMDB_API_KEY')) {
    console.log('OMDB_API_KEY is missing. Build will use Wikipedia-only fallback (less accurate metadata).');
  }

  const freshBuild = args.includes('--fresh') || args.includes('--reset');
  const toDynamo = shouldWriteToDynamo(args);
  const fastMode = args.includes('--fast');
  const moodTagsMode = args.includes('--moodtags') || args.includes('--mood-tags') || args.includes('--mood_tags');
  const titleArgs = args
    .slice(1)
    .filter(a => !String(a).startsWith('--'))
    .filter(a => !['--fresh', '--reset', '--dynamodb', '--ddb', '--fast', '--moodtags', '--mood-tags', '--mood_tags'].includes(a));

  ensureLocalDirs(localPaths);
  const titles = loadTitlesFromFileOrArgs(titleArgs, localPaths.titlesPath);
  if (titles.length === 0) {
    console.error('No titles provided and movie_titles.json is empty/missing.');
    usage();
    return;
  }

  console.log(`[Build] Loaded ${titles.length} title(s) from ${titleArgs.length > 0 ? 'command-line args' : localPaths.titlesPath}.`);
  if (freshBuild) {
    console.log('[Build] Fresh mode: truncating local NDJSON files');
  }

  if (freshBuild) {
    fs.rmSync(localPaths.moviesNdjsonPath, { force: true });
    fs.rmSync(localPaths.vectorsNdjsonPath, { force: true });
  }

  const moviesOut = openNdjsonAppendStream(localPaths.moviesNdjsonPath);
  const vectorsOut = openNdjsonAppendStream(localPaths.vectorsNdjsonPath);
  const movieMap = freshBuild ? new Map() : await loadLocalMoviesMap(localPaths);

  const tableName = toDynamo ? getDynamoTableName() : '';
  const ddbDoc = toDynamo ? getDynamoDocClient() : null;
  const ddbErrorTitles = [];

  const skippedTitles = [];
  const incompleteTitles = [];
  const errorTitles = [];
  const alreadyHaveTitles = [];
  const runId = makeRunId();

  try {
    for (const title of titles) {
      console.log(`\n[Build] Processing: ${title}`);
      try {
        const movie = await buildOneMovie(title, { fast: fastMode, moodTags: moodTagsMode });
        if (!movie) {
          console.log(`[Build] Skipped: ${title}`);
          skippedTitles.push(title);
          continue;
        }

        const key = buildMovieKey(movie);
        movie.key = key;

        // Safety: if we already have this key in the local store, do NOT append duplicates.
        if (movieMap.has(key)) {
          console.log(`[Build] Already have (key match); skipping save: ${movie.title}`);
          alreadyHaveTitles.push(movie.title);
          continue;
        }
        // Local-first: persist locally, then (optionally) deploy to DynamoDB.
        await appendNdjson(moviesOut, stripVectorFromMovie(movie));
        await appendNdjson(vectorsOut, { key, imdbId: movie.imdbId, vector: movie.vector });
        console.log(`[Build] Appended (NDJSON): ${movie.title}`);

        movieMap.set(key, stripVectorFromMovie(movie));

        if (toDynamo) {
          try {
            await putMovieToDynamo(ddbDoc, tableName, movie);
            console.log(`[Build] Saved to DynamoDB: ${movie.title} -> ${tableName}`);
          } catch (ddbError) {
            console.error(`[Build] DynamoDB write failed for "${movie.title}": ${ddbError?.message || ddbError}`);
            ddbErrorTitles.push(movie.title);
          }
        }
      } catch (error) {
        const message = String(error?.message || error);
        if (message.includes('[INCOMPLETE]')) {
          console.log(`[Build] Incomplete: ${title} -> ${message}`);
          incompleteTitles.push(title);
        } else {
          console.log(`[Build] Error processing "${title}": ${message}`);
          errorTitles.push(title);
        }
        console.log(`[Build] Skipped: ${title}`);
        continue;
      }
    }
  } finally {
    await closeWriteStream(moviesOut);
    await closeWriteStream(vectorsOut);
  }

  console.log(`\nDone. Processed ${titles.length} title(s). Local store now contains ${movieMap.size} movie(s).`);

  // Run artifacts (helps large batch reliability / post-mortem)
  const baseName = `build_${runId}`;
  writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_summary.json`), {
    runId,
    command: 'build',
    titlesRequested: titles.length,
    localTotalAfter: movieMap.size,
    skipped: skippedTitles.length,
    incomplete: incompleteTitles.length,
    errors: errorTitles.length,
    alreadyHave: alreadyHaveTitles.length,
    dynamodb: toDynamo ? { enabled: true, tableName, writeFailures: ddbErrorTitles.length } : { enabled: false },
    fast: fastMode,
    fresh: freshBuild,
    timestamp: new Date().toISOString(),
  });
  if (skippedTitles.length > 0) {
    writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_skipped_titles.json`), skippedTitles);
  }
  if (errorTitles.length > 0) {
    writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_error_titles.json`), errorTitles);
  }
  if (ddbErrorTitles.length > 0) {
    writeJsonOrWarn(path.join(localPaths.runsDir, `${baseName}_dynamodb_write_failed_titles.json`), ddbErrorTitles);
  }


  const notSaved = [...new Set([...skippedTitles, ...incompleteTitles, ...errorTitles])];
  if (notSaved.length > 0) {
    console.log('\n=== 未成功儲存的電影（抓不到 / 資訊不完整 / 例外）===');
    if (skippedTitles.length > 0) {
      console.log(`- 抓不到或向量無效（Skipped）: ${skippedTitles.join(' | ')}`);
    }
    if (incompleteTitles.length > 0) {
      console.log(`- 資訊不完整（Incomplete）: ${incompleteTitles.join(' | ')}`);
    }
    if (errorTitles.length > 0) {
      console.log(`- 其他錯誤（Error）: ${errorTitles.join(' | ')}`);
    }
  }

  if (toDynamo) {
    if (ddbErrorTitles.length > 0) {
      console.log(`\n=== DynamoDB 寫入失敗（本地已寫入；建議稍後用 deploy-dynamodb 重送/部署）===`);
      console.log(`- ${ddbErrorTitles.join(' | ')}`);
    } else {
      console.log(`\nDynamoDB write complete: ${tableName}`);
    }
  }

  // Always persist incomplete_titles.json (even if empty)
  try {
    const outPath = localPaths.incompleteTitlesPath;
    writeJsonArrayOrThrow(outPath, incompleteTitles);
    if (incompleteTitles.length > 0) {
      console.log(`\n[Incomplete] Saved ${incompleteTitles.length} title(s) to: ${outPath}`);
    } else {
      console.log(`\n[Incomplete] No incomplete titles. Empty file written to: ${outPath}`);
    }
  } catch (e) {
    console.warn(`[Incomplete] Failed to write incomplete titles list: ${e?.message || e}`);
  }
}

// 用 OpenAI 生成擴展劇情描述
async function generateExpandedOverview(plot) {
  if (!plot || !String(plot).trim()) {
    return '';
  }
  const prompt = `請將下方 SOURCE PLOT 內容，重寫成一段「完整但精簡」的電影劇情摘要，長度和資訊量請參考這個範例：\nThe Imitation Game is a 2014 British-American historical drama film based on the true story of British mathematician Alan Turing. During World War II, Turing (played by Benedict Cumberbatch) is tasked with leading a team to break the Nazi German "Enigma" code, which was considered the most sophisticated cryptographic machine in the world. Despite Turing's eccentric personality causing tension with his colleagues, he overcomes obstacles with the support of his brilliant colleague Joan Clarke, and successfully develops a device to decrypt the enemy's codes. This breakthrough alters the course of the war, saving millions of lives and laying the foundation for modern computer science. However, after the war, Turing is revealed to be homosexual and is convicted by the government, leading to a tragic end.\n---\n請用類似的長度、資訊密度和敘事風格，完整交代電影主線、關鍵事件與結局，不要多寫也不要少寫，不要提演員名字，不要發揮想像。最後請再補上一句話，讓這段摘要更容易被自然語言搜尋找到。只輸出一段純文字。\n\nSOURCE PLOT:\n${plot}\n`;

  try {
    const response = await withRetry(
      () => openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: prompt },
        ],
        max_tokens: 1600,
        temperature: 0.4,
      }),
      { label: 'openai.chat.completions.create (expandedOverview)', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
    );

    return (response.choices?.[0]?.message?.content || '').trim();
  } catch (error) {
    console.error(`Error generating expanded overview: ${error?.message || error}`);
    return '';
  }
}

main();
