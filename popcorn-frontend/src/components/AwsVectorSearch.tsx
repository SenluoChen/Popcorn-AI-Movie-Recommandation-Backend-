import { useEffect, useMemo, useRef, useState } from 'react';
import { tmdbFindByImdbId, tmdbGetMovieDetails } from '../utils/tmdb';

type SearchResult = {
  imdbId: string;
  title: string;
  year?: string;
  similarity: number;
  productionCountry?: string;
  overview?: string;
};

function getApiBaseUrl(): string {
  const raw =
    process.env.REACT_APP_RELIVRE_API_URL
    || process.env.REACT_APP_API_URL
    || '';

  const base = String(raw).trim();
  if (!base) return '';
  return base.endsWith('/') ? base : `${base}/`;
}

export default function AwsVectorSearch() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [results, setResults] = useState<SearchResult[]>([]);

  const requestedImdbIdsRef = useRef<Set<string>>(new Set());

  const canSearch = Boolean(apiBaseUrl);

  async function onSearch() {
    const q = query.trim();
    if (!q) {
      setError('Please enter a query before searching.');
      return;
    }

    if (!canSearch) {
      setError('API URL is not configured (REACT_APP_RELIVRE_API_URL).');
      return;
    }

    setLoading(true);
    setError('');
    setResults([]);

    try {
      const resp = await fetch(`${apiBaseUrl}search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: q, topK: 5 }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(String(data?.error || `HTTP ${resp.status}`));
      }

      const list = Array.isArray(data?.results) ? data.results : [];
      setResults(list);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function enrichOverviews() {
      const need = results
        .map((r) => ({ ...r, imdbId: String(r?.imdbId || '').trim() }))
        .filter((r) => /^tt\d+$/i.test(r.imdbId))
        .filter((r) => !String(r.overview || '').trim())
        .filter((r) => !requestedImdbIdsRef.current.has(r.imdbId));

      if (!need.length) return;

      need.forEach((r) => requestedImdbIdsRef.current.add(r.imdbId));

      const runWithConcurrency = async <T, R>(arr: T[], limit: number, worker: (v: T) => Promise<R>) => {
        const out: R[] = new Array(arr.length);
        let next = 0;
        const runners = new Array(Math.max(1, limit)).fill(0).map(async () => {
          while (next < arr.length) {
            const i = next++;
            out[i] = await worker(arr[i]);
          }
        });
        await Promise.all(runners);
        return out;
      };

      const fetched = await runWithConcurrency(
        need,
        4,
        async (r) => {
          try {
            const found = await tmdbFindByImdbId(r.imdbId, { language: 'en-US' });
            const tmdbId = found?.movie_results?.[0]?.id;
            if (!tmdbId) return { imdbId: r.imdbId, overview: '' };
            const d = await tmdbGetMovieDetails(tmdbId, { language: 'en-US' });
            return { imdbId: r.imdbId, overview: String(d?.overview || '').trim() };
          } catch {
            return { imdbId: r.imdbId, overview: '' };
          }
        }
      );

      if (cancelled) return;

      const byImdbId = new Map<string, string>();
      fetched.forEach((x) => {
        if (x?.imdbId) byImdbId.set(x.imdbId, x.overview || '');
      });

      setResults((prev) =>
        prev.map((r) => {
          const imdbId = String(r?.imdbId || '').trim();
          const nextOverview = byImdbId.get(imdbId);
          if (nextOverview === undefined) return r;
          if (String(r.overview || '').trim()) return r;
          return { ...r, overview: nextOverview };
        })
      );
    }

    enrichOverviews();
    return () => {
      cancelled = true;
    };
  }, [results]);

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 6px 18px rgba(0,0,0,0.06)',
        padding: 16,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16 }}>AI Vector Search (Cloud)</div>
      <div style={{ color: '#6e6e73', marginTop: 6, fontSize: 13 }}>
        Calls the AWS API (OpenAI embeddings + DynamoDB vector data)
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSearch();
            }
          }}
          placeholder='e.g. non-violent detective thriller, baseball movie, alien adventure…'
          style={{
            flex: '1 1 420px',
            minWidth: 260,
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.12)',
            padding: '10px 12px',
            outline: 'none',
          }}
        />
        <button
          onClick={onSearch}
          disabled={loading}
          style={{
            borderRadius: 10,
            border: 'none',
            padding: '10px 14px',
            background: '#111',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {!canSearch ? (
        <div style={{ marginTop: 10, color: '#b42318', fontSize: 13 }}>
          API URL is not configured. Set REACT_APP_RELIVRE_API_URL at build time.
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 10, color: '#b42318', fontSize: 13 }}>{error}</div>
      ) : null}

      {results.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Top 5</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {results.map((r) => (
              <div
                key={r.imdbId}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.08)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.title}{r.year ? ` (${r.year})` : ''}
                  </div>
                  <div style={{ color: '#6e6e73', marginTop: 4, fontSize: 12 }}>
                    {r.productionCountry ? `Country: ${r.productionCountry} · ` : ''}
                    <a href={`https://www.imdb.com/title/${r.imdbId}/`} target='_blank' rel='noreferrer' style={{ color: '#6e6e73' }}>...
                      {r.imdbId}
                    </a>
                  </div>

                  <div className="pc-movie-overview" style={{ marginTop: 8, color: '#111' }}>
                    {String(r.overview || '').trim()
                      ? String(r.overview || '').trim()
                      : /^tt\d+$/i.test(String(r.imdbId || '').trim())
                        ? 'Loading plot…'
                        : 'Plot unavailable.'}
                  </div>
                </div>
                <div style={{ fontVariantNumeric: 'tabular-nums', color: '#111', fontWeight: 700 }}>
                  {Number(r.similarity).toFixed(3)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
