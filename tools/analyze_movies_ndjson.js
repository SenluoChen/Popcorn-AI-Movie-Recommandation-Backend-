const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const filePath = path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson');

function isEmptyString(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function main() {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);

  let total = 0;
  let badJson = 0;

  const counts = {
    missingTags: 0,
    emptyTags: 0,
    missingGenre: 0,
    emptyGenre: 0,
    missingKeywords: 0,
    emptyKeywords: 0,
    missingLanguage: 0,
    emptyLanguage: 0,
    missingMoodTags: 0,
    nonArrayMoodTags: 0,
    emptyMoodTags: 0,
  };

  const examples = {
    missingOrEmptyTags: [],
    missingOrEmptyGenre: [],
    missingOrEmptyKeywords: [],
    suspiciousDetailedPlot: [],
  };

  for (const line of lines) {
    total++;

    let o;
    try {
      o = JSON.parse(line);
    } catch {
      badJson++;
      continue;
    }

    if (o.tags === undefined) counts.missingTags++;
    else if (String(o.tags).trim() === '') counts.emptyTags++;

    if (o.genre === undefined) counts.missingGenre++;
    else if (String(o.genre).trim() === '') counts.emptyGenre++;

    if (o.keywords === undefined) counts.missingKeywords++;
    else if (String(o.keywords).trim() === '') counts.emptyKeywords++;

    if (o.language === undefined) counts.missingLanguage++;
    else if (String(o.language).trim() === '') counts.emptyLanguage++;

    if (o.moodTags === undefined) counts.missingMoodTags++;
    else if (!Array.isArray(o.moodTags)) counts.nonArrayMoodTags++;
    else if (o.moodTags.length === 0) counts.emptyMoodTags++;

    // Capture a few examples
    const id = String(o.imdbId || o.key || '').trim();
    const title = String(o.title || '').trim();
    const year = String(o.year || '').trim();
    const mini = { imdbId: id, title, year, tags: o.tags, genre: o.genre, keywords: o.keywords };

    if (examples.missingOrEmptyTags.length < 8 && isEmptyString(o.tags)) {
      examples.missingOrEmptyTags.push(mini);
    }
    if (examples.missingOrEmptyGenre.length < 8 && isEmptyString(o.genre)) {
      examples.missingOrEmptyGenre.push(mini);
    }
    if (examples.missingOrEmptyKeywords.length < 8 && isEmptyString(o.keywords)) {
      examples.missingOrEmptyKeywords.push(mini);
    }

    // Heuristic: some detailedPlot/expandedOverview look like Wikipedia disambiguation or country description.
    // Flag if it starts with "It is also the world's" or contains "may refer to".
    const detailedPlot = String(o.detailedPlot || '');
    const unifiedPlot = String(o.unifiedPlot || '');
    const expandedOverview = String(o.expandedOverview || '');
    const combinedPlot = (detailedPlot + ' ' + unifiedPlot + ' ' + expandedOverview).trim();
    if (
      examples.suspiciousDetailedPlot.length < 8 &&
      (combinedPlot.includes("may refer to") || combinedPlot.includes("world's"))
    ) {
      examples.suspiciousDetailedPlot.push({ imdbId: id, title, year, snippet: (detailedPlot || unifiedPlot || expandedOverview).slice(0, 160) });
    }
  }

  const pct = (x) => (total ? `${((100 * x) / total).toFixed(1)}%` : '0.0%');

  console.log(`File: ${filePath}`);
  console.log(`Total movies: ${total}`);
  console.log(`Bad JSON lines: ${badJson}`);
  console.log('--- Completeness ---');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`${k}: ${v} (${pct(v)})`);
  }

  console.log('\n--- Examples: missing/empty tags ---');
  console.log(JSON.stringify(examples.missingOrEmptyTags, null, 2));

  console.log('\n--- Examples: missing/empty genre ---');
  console.log(JSON.stringify(examples.missingOrEmptyGenre, null, 2));

  console.log('\n--- Examples: missing/empty keywords ---');
  console.log(JSON.stringify(examples.missingOrEmptyKeywords, null, 2));

  console.log('\n--- Examples: suspicious plot/overview (may hurt semantic search) ---');
  console.log(JSON.stringify(examples.suspiciousDetailedPlot, null, 2));
}

main();
