const axios = require('axios');

/**
 * Call FAISS / Vector service to get TopK candidates
 *
 * @param {number[]} queryEmbedding
 * @param {number} topK
 * @param {{ baseUrl?: string, timeoutMs?: number }} [opts]
 */
async function vectorSearchFast(queryEmbedding, topK = 50, opts = {}) {
  const baseUrl =
    opts.baseUrl ||
    process.env.VECTOR_SERVICE_URL ||
    'http://127.0.0.1:8008';
  const url = `${String(baseUrl).replace(/\/$/, '')}/search`;
  const envTimeout = Number(process.env.VECTOR_SERVICE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(envTimeout)
    ? envTimeout
    : (Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 2000);

  const res = await axios.post(
    url,
    {
      vector: queryEmbedding,
      topK,
    },
    { timeout: timeoutMs }
  );

  return res.data.results;
}

module.exports = { vectorSearchFast };
