// Minimal Lambda:
// - Uses global fetch (Node.js 18+)
// - Uses AWS SDK v3 (bundled via package.json in this folder)
// - Scans DynamoDB, computes cosine similarity locally

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

let cachedOpenAiKey = null;

// Warm caches (persist across Lambda invocations within the same container)
let cachedMovies = null;

const TRANSLATION_CACHE = new Map();
const EMBEDDING_CACHE = new Map();

function nowMs() {
  return Date.now();
}

function getFromCache(map, key, ttlMs) {
  const k = String(key || '').trim();
  if (!k) return null;
  const hit = map.get(k);
  if (!hit) return null;
  if (ttlMs && nowMs() - hit.ts > ttlMs) {
    map.delete(k);
    return null;
  }
  return hit.value;
}

function setInCache(map, key, value, maxEntries) {
  const k = String(key || '').trim();
  if (!k) return;
  map.set(k, { ts: nowMs(), value });
  if (maxEntries && map.size > maxEntries) {
    // naive LRU-ish eviction: delete oldest
    let oldestKey;
    let oldestTs = Infinity;
    for (const [mk, mv] of map.entries()) {
      if (mv?.ts < oldestTs) {
        oldestTs = mv.ts;
        oldestKey = mk;
      }
    }
    if (oldestKey) map.delete(oldestKey);
  }
}

function isProbablyOpenAiApiKey(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  // Guard against accidentally storing placeholders like <NEW_KEY>.
  if (v.includes('<') || v.includes('>')) return false;
  // Common prefixes.
  if (v.startsWith('sk-') || v.startsWith('sk-proj-')) return v.length >= 20;
  return false;
}

function redactPotentialSecrets(text) {
  const s = String(text || '');
  // Redact OpenAI-style keys if they ever appear.
  return s.replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***REDACTED***');
}

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'OPTIONS,POST,GET',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function normalizeQueryText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function buildQueryHints(query) {
  const q = String(query || '').trim();
  const qLower = q.toLowerCase();

  const wantsJapanese =
    /\b(japanese|jp)\b/i.test(qLower)
    || q.includes('日本')
    || q.includes('日文')
    || q.includes('日語')
    || q.includes('日片');

  const wantsKorean = /\b(korean|kr)\b/i.test(qLower) || q.includes('韓') || q.includes('韓國');
  const wantsEnglish = /\b(english|en)\b/i.test(qLower) || q.includes('英文') || q.includes('英語');

  const wantsAnimation =
    /\b(animation|anime)\b/i.test(qLower)
    || q.includes('動畫')
    || q.includes('動漫')
    || q.includes('动漫')
    || q.includes('アニメ');

  const wantsHorror = /\b(horror)\b/i.test(qLower) || q.includes('恐怖');
  const wantsComedy = /\b(comedy)\b/i.test(qLower) || q.includes('喜劇') || q.includes('搞笑') || q.includes('好笑');

  let wantLang;
  if (wantsJapanese) wantLang = 'ja';
  else if (wantsKorean) wantLang = 'ko';
  else if (wantsEnglish) wantLang = 'en';

  // Expand very short queries (esp. non-English) with lightweight English hints.
  // This keeps UX the same but improves embedding intent capture.
  const expansions = [];
  if (wantsJapanese) expansions.push('japanese');
  if (wantsAnimation) expansions.push('anime', 'animation');
  if (wantsHorror) expansions.push('horror');
  if (wantsComedy) expansions.push('comedy');

  const expandedQuery = expansions.length ? `${q} ${expansions.join(' ')}` : q;

  // Lexical terms used for a small rerank boost on tiny/short queries.
  const lexicalTerms = new Set();
  if (wantsJapanese) {
    lexicalTerms.add('japan');
    lexicalTerms.add('japanese');
    lexicalTerms.add('ja');
  }
  if (wantsAnimation) {
    lexicalTerms.add('animation');
    lexicalTerms.add('anime');
  }
  if (wantsHorror) lexicalTerms.add('horror');
  if (wantsComedy) lexicalTerms.add('comedy');

  return {
    expandedQuery,
    wantLang,
    wantsAnimation,
    lexicalTerms: Array.from(lexicalTerms),
  };
}

function normalizeLanguageCode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'ja' || v.startsWith('ja-')) return 'ja';
  if (v === 'ko' || v.startsWith('ko-')) return 'ko';
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v === 'fr' || v.startsWith('fr-')) return 'fr';
  if (v === 'es' || v.startsWith('es-')) return 'es';
  if (v === 'de' || v.startsWith('de-')) return 'de';

  // Common OMDb-style language strings
  if (v.includes('japanese')) return 'ja';
  if (v.includes('korean')) return 'ko';
  if (v.includes('english')) return 'en';
  if (v.includes('french')) return 'fr';
  if (v.includes('spanish')) return 'es';
  if (v.includes('german')) return 'de';

  return '';
}

function cosineSimilarity(vec1, vec2) {
  if (!Array.isArray(vec1) || !Array.isArray(vec2) || vec1.length === 0 || vec2.length === 0) return 0;
  if (vec1.length !== vec2.length) return 0;

  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    const a = Number(vec1[i]);
    const b = Number(vec2[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    norm1 += a * a;
    norm2 += b * b;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

function buildMovieSearchText(movie) {
  return [
    movie?.title,
    movie?.genre,
    movie?.tags,
    movie?.keywords,
    movie?.language,
    movie?.productionCountry,
    movie?.director,
    // Intentionally exclude large plot/overview fields here.
    // They dramatically increase DynamoDB scan payload and latency.
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function movieMatchesHints(movie, hints) {
  if (!movie) return false;

  if (hints?.wantLang) {
    const want = String(hints.wantLang).toLowerCase();
    const langCode = normalizeLanguageCode(movie?.language);
    const country = String(movie?.productionCountry || '').toLowerCase();

    // If we can infer language, enforce it.
    // If language is unknown/empty, allow (to avoid killing recall on incomplete items).
    if (langCode && langCode !== want) {
      // For Japanese intent, accept productionCountry=Japan even if language field is messy.
      if (!(want === 'ja' && country.includes('japan'))) {
        return false;
      }
    }
  }

  if (hints?.wantsAnimation) {
    const t = buildMovieSearchText(movie);
    if (!t.includes('animation') && !t.includes('anime')) {
      return false;
    }
  }

  return true;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableOpenAI(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function looksNonEnglish(query) {
  const q = String(query || '');
  // If query contains CJK / Kana / Hangul, it's almost certainly not English.
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]/.test(q)) {
    return true;
  }
  // If it contains any non-ASCII char (accented letters, etc.), treat as potentially non-English.
  for (let i = 0; i < q.length; i++) {
    if (q.charCodeAt(i) > 127) {
      return true;
    }
  }
  return false;
}

async function openaiChatCompletion({ apiKey, model, messages, temperature = 0, max_tokens = 120, maxAttempts = 6 }) {
  const url = 'https://api.openai.com/v1/chat/completions';

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens }),
      });

      if (!resp.ok) {
        // Do NOT include response body in the error; OpenAI errors can echo sensitive info.
        const err = new Error(`OpenAI chat.completions failed: status=${resp.status}`);
        err.status = resp.status;
        throw err;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      return String(content || '').trim();
    } catch (e) {
      lastErr = e;
      const status = e?.status;
      if (attempt === maxAttempts || (typeof status === 'number' && !isRetryableOpenAI(status))) {
        throw e;
      }
      const backoff = Math.min(12000, 800 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }

  throw lastErr;
}

async function translateQueryToEnglish({ apiKey, query, model }) {
  const original = normalizeQueryText(query);
  if (!original) {
    return { original: '', english: '' };
  }

  const cacheTtlMs = Number(process.env.TRANSLATION_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
  const cached = getFromCache(TRANSLATION_CACHE, original, cacheTtlMs);
  if (cached) {
    return cached;
  }

  // Skip translation for clearly-English queries to save latency and cost.
  if (!looksNonEnglish(original)) {
    const v = { original, english: original };
    setInCache(TRANSLATION_CACHE, original, v, Number(process.env.TRANSLATION_CACHE_MAX || 500));
    return v;
  }

  const prompt = [
    'Detect the language of the user\'s movie search query.',
    'If it is not English, translate it to natural English.',
    'Preserve proper nouns (movie titles, person names) and do not invent details.',
    'Return ONLY a JSON object with exactly two keys: language (BCP-47 or ISO code if possible) and english (string).',
    '',
    `QUERY: ${original}`,
  ].join('\n');

  const raw = await openaiChatCompletion({
    apiKey,
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 180,
  });

  try {
    const parsed = JSON.parse(raw);
    const english = normalizeQueryText(parsed?.english);
    const v = {
      original,
      language: String(parsed?.language || '').trim(),
      english: english || original,
    };
    setInCache(TRANSLATION_CACHE, original, v, Number(process.env.TRANSLATION_CACHE_MAX || 500));
    return v;
  } catch {
    // Fallback: if model returned plain text, treat it as the translation.
    const english = normalizeQueryText(raw);
    const v = { original, english: english || original };
    setInCache(TRANSLATION_CACHE, original, v, Number(process.env.TRANSLATION_CACHE_MAX || 500));
    return v;
  }
}

async function openaiEmbeddings({ apiKey, model, input, maxAttempts = 6 }) {
  const cacheKey = `${String(model || '').trim()}::${normalizeQueryText(input)}`;
  const cacheTtlMs = Number(process.env.EMBEDDING_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
  const cached = getFromCache(EMBEDDING_CACHE, cacheKey, cacheTtlMs);
  if (cached) return cached;

  const url = 'https://api.openai.com/v1/embeddings';

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, input }),
      });

      if (!resp.ok) {
        // Do NOT include response body in the error; OpenAI errors can echo sensitive info.
        const err = new Error(`OpenAI embeddings failed: status=${resp.status}`);
        err.status = resp.status;
        throw err;
      }

      const data = await resp.json();
      const embedding = data?.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('OpenAI embeddings returned empty embedding');
      }

      setInCache(EMBEDDING_CACHE, cacheKey, embedding, Number(process.env.EMBEDDING_CACHE_MAX || 500));
      return embedding;
    } catch (e) {
      lastErr = e;
      const status = e?.status;
      if (attempt === maxAttempts || (typeof status === 'number' && !isRetryableOpenAI(status))) {
        throw e;
      }
      const backoff = Math.min(12000, 800 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }

  throw lastErr;
}

async function resolveOpenAiApiKey() {
  if (cachedOpenAiKey) {
    return cachedOpenAiKey;
  }

  const direct = process.env.OPENAI_API_KEY;
  if (direct && String(direct).trim()) {
    const candidate = String(direct).trim();
    if (!isProbablyOpenAiApiKey(candidate)) {
      throw new Error('OPENAI_API_KEY is set but does not look like a valid OpenAI key');
    }
    cachedOpenAiKey = candidate;
    return cachedOpenAiKey;
  }

  const paramName = process.env.OPENAI_API_KEY_SSM_PARAM;
  if (!paramName || !String(paramName).trim()) {
    throw new Error('Missing OPENAI_API_KEY (or OPENAI_API_KEY_SSM_PARAM) in Lambda env');
  }

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const ssm = new SSMClient(region ? { region } : {});
  const resp = await ssm.send(
    new GetParameterCommand({
      Name: String(paramName).trim(),
      WithDecryption: true,
    }),
  );
  const value = resp?.Parameter?.Value;
  if (!value || !String(value).trim()) {
    throw new Error(`SSM parameter empty: ${paramName}`);
  }

  const candidate = String(value).trim();
  if (!isProbablyOpenAiApiKey(candidate)) {
    throw new Error('SSM OpenAI key looks misconfigured (placeholder or invalid format)');
  }

  cachedOpenAiKey = candidate;
  return cachedOpenAiKey;
}

async function scanAllMovies({ tableName, region, maxItems }) {
  const cacheTtlMs = Number(process.env.MOVIES_CACHE_TTL_MS || 5 * 60 * 1000);
  if (cachedMovies && nowMs() - cachedMovies.ts <= cacheTtlMs && Array.isArray(cachedMovies.items)) {
    return cachedMovies.items;
  }

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  const items = [];
  let lastKey = undefined;

  do {
    const resp = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        Limit: 1000,
        // Project only what we need for ranking + UI.
        // This prevents DynamoDB from returning large plot fields, which can add seconds.
        ProjectionExpression: '#imdbId,#title,#year,#tmdbId,#poster_path,#productionCountry,#language,#genre,#tags,#keywords,#director,#vector',
        ExpressionAttributeNames: {
          '#imdbId': 'imdbId',
          '#title': 'title',
          '#year': 'year',
          '#tmdbId': 'tmdbId',
          '#poster_path': 'poster_path',
          '#productionCountry': 'productionCountry',
          '#language': 'language',
          '#genre': 'genre',
          '#tags': 'tags',
          '#keywords': 'keywords',
          '#director': 'director',
          '#vector': 'vector',
        },
      }),
    );

    const batch = Array.isArray(resp?.Items) ? resp.Items : [];
    for (const item of batch) {
      items.push(item);
      if (maxItems && items.length >= maxItems) {
        return items;
      }
    }

    lastKey = resp?.LastEvaluatedKey;
  } while (lastKey);

  cachedMovies = { ts: nowMs(), items };
  return items;
}

async function batchGetMoviesByImdbIds({ tableName, region, imdbIds }) {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const keys = (Array.isArray(imdbIds) ? imdbIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((imdbId) => ({ imdbId }));

  if (!keys.length) return [];

  const resp = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [tableName]: {
          Keys: keys,
        },
      },
    }),
  );

  const items = resp?.Responses?.[tableName];
  return Array.isArray(items) ? items : [];
}

async function faissSearch({ baseUrl, vector, topK }) {
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}/search`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vector, topK }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(String(data?.detail || data?.error || `FAISS HTTP ${resp.status}`));
  }
  return data;
}

exports.handler = async (event) => {
  const t0 = nowMs();
  // CORS preflight
  if (event?.requestContext?.http?.method === 'OPTIONS') {
    return json(204, {}, { 'content-length': '0' });
  }

  const tableName = process.env.DDB_TABLE_NAME || 'reLivre-movies';
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const translateModel = process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4o-mini';
  const faissServiceUrl = process.env.FAISS_SERVICE_URL || '';

  if (!region) {
    return json(500, { error: 'Missing AWS region (AWS_REGION)' });
  }
  let apiKey;
  try {
    apiKey = await resolveOpenAiApiKey();
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }

  let body = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const query = normalizeQueryText(body?.query);
  const topK = Math.max(1, Math.min(20, Number(body?.topK || 5)));
  const maxScan = body?.maxScan ? Number(body.maxScan) : null;

  if (!query) {
    return json(400, { error: 'Missing query' });
  }

  try {
    const tTranslateStart = nowMs();
    const translated = await translateQueryToEnglish({ apiKey, query, model: translateModel });
    const tTranslateMs = nowMs() - tTranslateStart;

    const effective = translated?.english || query;
    const hints = buildQueryHints(effective);

    const tEmbedStart = nowMs();
    const queryVector = await openaiEmbeddings({ apiKey, model, input: hints.expandedQuery });
    const tEmbedMs = nowMs() - tEmbedStart;

    // Candidate selection via FAISS (preferred)
    const tFaissStart = nowMs();
    let candidateMovies = [];
    let tFaissMs = 0;
    let tFetchMs = 0;
    let usedFaiss = false;

    if (faissServiceUrl && String(faissServiceUrl).trim()) {
      usedFaiss = true;
      const faissTopK = Math.max(50, topK * 20);
      const faissData = await faissSearch({ baseUrl: faissServiceUrl, vector: queryVector, topK: faissTopK });
      tFaissMs = nowMs() - tFaissStart;

      const hits = Array.isArray(faissData?.results) ? faissData.results : [];
      const imdbIds = hits.map((r) => r?.imdbId).filter(Boolean);

      const tFetchStart = nowMs();
      candidateMovies = await batchGetMoviesByImdbIds({ tableName, region, imdbIds });
      tFetchMs = nowMs() - tFetchStart;
    } else {
      // Fallback to scan if FAISS isn't configured
      const tScanStart = nowMs();
      candidateMovies = await scanAllMovies({ tableName, region, maxItems: Number.isFinite(maxScan) && maxScan > 0 ? Math.floor(maxScan) : null });
      tFetchMs = nowMs() - tScanStart;
    }

    const tScoreStart = nowMs();
    const scored = [];
    // First pass: apply heuristic filters when query clearly asks for them.
    // If it becomes too restrictive, we'll fall back to unfiltered scoring.
    const filtered = candidateMovies.filter((m) => movieMatchesHints(m, hints));

    // If the query explicitly asks for a hard constraint (e.g., animation/anime or a target language),
    // never fall back to unfiltered results — better to return fewer/none than irrelevant items.
    const hasHardConstraints = Boolean(hints?.wantsAnimation || hints?.wantLang);
    const candidates = hasHardConstraints
      ? filtered
      : ((filtered.length >= Math.min(50, topK * 10)) ? filtered : candidateMovies);

    for (const m of candidates) {
      const vec = m?.vector;
      const title = m?.title;
      const imdbId = m?.imdbId;
      if (!title || !imdbId || !Array.isArray(vec)) continue;

      const similarity = cosineSimilarity(queryVector, vec);

      // Small lexical rerank boost (helps very short queries like "日本動畫片").
      const movieText = buildMovieSearchText(m);
      let lexicalBoost = 0;
      for (const term of hints.lexicalTerms || []) {
        if (term && movieText.includes(String(term).toLowerCase())) {
          lexicalBoost += 0.02;
        }
      }
      lexicalBoost = Math.min(0.12, lexicalBoost);
      const score = similarity + lexicalBoost;

      scored.push({
        imdbId,
        title,
        year: m?.year,
        tmdbId: m?.tmdbId,
        poster_path: m?.poster_path,
        similarity,
        score,
        lexicalBoost,
        productionCountry: m?.productionCountry,
      });
    }

    // Keep response shape stable but sort by score for better precision.
    scored.sort((a, b) => (b.score ?? b.similarity) - (a.score ?? a.similarity));
    const top = scored.slice(0, topK);
    const tScoreMs = nowMs() - tScoreStart;
    const tTotalMs = nowMs() - t0;
    return json(200, {
      query,
      queryEnglish: translated?.english && translated.english !== query ? translated.english : undefined,
      expandedQuery: hints.expandedQuery,
      timingsMs: {
        total: tTotalMs,
        translate: tTranslateMs,
        embed: tEmbedMs,
        faiss: usedFaiss ? tFaissMs : undefined,
        fetchMovies: tFetchMs,
        score: tScoreMs,
      },
      countScanned: usedFaiss ? undefined : candidateMovies.length,
      countCandidates: candidates.length,
      countScored: scored.length,
      topK,
      results: top,
    });
  } catch (e) {
    // Avoid logging/returning anything that might contain secrets.
    const msg = redactPotentialSecrets(e?.message || e);
    console.error(msg);
    return json(500, { error: msg });
  }
};

// Local testing helpers (harmless in Lambda runtime)
module.exports._test = {
  buildQueryHints,
  movieMatchesHints,
  normalizeLanguageCode,
  buildMovieSearchText,
};
