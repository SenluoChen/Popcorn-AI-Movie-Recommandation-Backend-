const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    inPath: path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson'),
    inplace: true,
    backup: true,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' && argv[i + 1]) {
      args.inPath = path.resolve(process.cwd(), argv[++i]);
      continue;
    }
    if (a === '--no-inplace') {
      args.inplace = false;
      continue;
    }
    if (a === '--out' && argv[i + 1]) {
      args.outPath = path.resolve(process.cwd(), argv[++i]);
      continue;
    }
    if (a === '--no-backup') {
      args.backup = false;
      continue;
    }
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
  }

  if (!args.inplace && !args.outPath) {
    args.outPath = args.inPath + '.normalized';
  }

  return args;
}

function normalizeText(v) {
  if (v === undefined || v === null) return '';
  const s = String(v)
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!s || s.toLowerCase() === 'n/a') return '';
  return s;
}

function looksLikeDisambiguation(text) {
  const t = text.toLowerCase();
  return (
    t.includes(' may refer to') ||
    t.startsWith('may refer to') ||
    t.includes("it is also the world's") ||
    t.includes("world's")
  );
}

function pickBestPlot(candidates) {
  // candidates: array of non-empty strings
  let best = '';
  let bestScore = -Infinity;

  for (const c of candidates) {
    const len = c.length;
    const disambig = looksLikeDisambiguation(c);

    // Prefer substantial but not crazy-long text.
    // Penalize disambiguation-style text hard.
    let score = len;
    if (len > 4000) score -= (len - 4000) * 0.5;
    if (disambig) score -= 2500;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('Usage: node tools/normalize_movie_plots_ndjson.js [--in <path>] [--no-inplace --out <path>] [--no-backup]');
    console.log('Default input: Movie-data/movies/movies.ndjson (in-place)');
    process.exit(0);
  }

  const inText = fs.readFileSync(args.inPath, 'utf8');
  const lines = inText.split(/\r?\n/).filter(Boolean);

  let total = 0;
  let badJson = 0;
  let changed = 0;
  let removedFields = 0;
  let filledPlot = 0;

  const outLines = [];

  for (const line of lines) {
    total++;

    let o;
    try {
      o = JSON.parse(line);
    } catch {
      badJson++;
      outLines.push(line);
      continue;
    }

    const beforePlot = o.plot;
    const beforeDetailedPlot = o.detailedPlot;
    const beforeUnifiedPlot = o.unifiedPlot;
    const beforeExpandedOverview = o.expandedOverview;

    const plot = normalizeText(beforePlot || o.Plot);
    const detailedPlot = normalizeText(beforeDetailedPlot || o['Detailed Plot'] || o.detailed_plot);
    const unifiedPlot = normalizeText(beforeUnifiedPlot || o['Unified Plot']);
    const expandedOverview = normalizeText(beforeExpandedOverview || o['Expanded Overview']);

    const candidates = [detailedPlot, unifiedPlot, expandedOverview, plot].filter(Boolean);
    const best = pickBestPlot(candidates);

    if (best && (!plot || normalizeText(plot) !== best)) {
      o.plot = best;
      filledPlot++;
    }

    // Remove redundant fields so payload has a single plot field.
    const hadAny = o.detailedPlot !== undefined || o.unifiedPlot !== undefined || o.expandedOverview !== undefined || o.Plot !== undefined || o['Detailed Plot'] !== undefined || o['Unified Plot'] !== undefined || o['Expanded Overview'] !== undefined;

    delete o.detailedPlot;
    delete o.unifiedPlot;
    delete o.expandedOverview;
    delete o.Plot;
    delete o['Detailed Plot'];
    delete o['Unified Plot'];
    delete o['Expanded Overview'];
    delete o.detailed_plot;

    if (hadAny) removedFields++;

    const afterLine = JSON.stringify(o);
    outLines.push(afterLine);

    const changedThis =
      normalizeText(beforePlot) !== normalizeText(o.plot) ||
      beforeDetailedPlot !== undefined ||
      beforeUnifiedPlot !== undefined ||
      beforeExpandedOverview !== undefined ||
      o.Plot !== undefined;

    if (changedThis) changed++;
  }

  if (args.inplace) {
    if (args.backup) {
      const backupPath = args.inPath + '.bak';
      if (!fs.existsSync(backupPath)) {
        fs.writeFileSync(backupPath, inText, 'utf8');
      }
    }
    fs.writeFileSync(args.inPath, outLines.join('\n') + '\n', 'utf8');
  } else {
    fs.writeFileSync(args.outPath, outLines.join('\n') + '\n', 'utf8');
  }

  console.log(JSON.stringify({
    file: args.inPath,
    total,
    badJson,
    changed,
    removedFields,
    filledPlot,
    inplace: args.inplace,
    out: args.inplace ? args.inPath : args.outPath,
  }, null, 2));
}

main();
