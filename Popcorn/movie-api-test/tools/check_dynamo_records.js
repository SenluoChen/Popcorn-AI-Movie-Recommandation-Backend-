require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

function getDynamoDocClient() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION;
  const ddb = new DynamoDBClient(region ? { region } : {});
  return DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });
}

function readLocalNdjson(ndjsonPath) {
  if (!fs.existsSync(ndjsonPath)) return new Map();
  const text = fs.readFileSync(ndjsonPath, 'utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//')) continue;
    try {
      const obj = JSON.parse(line);
      const imdb = String(obj?.imdbId || obj?.key || '').trim();
      if (imdb) map.set(imdb, obj);
    } catch (e) {
      // ignore
    }
  }
  return map;
}

async function fetchItem(docClient, tableName, imdbId) {
  try {
    const res = await docClient.send(new GetCommand({ TableName: tableName, Key: { imdbId } }));
    return res?.Item || null;
  } catch (e) {
    return { __error: String(e?.message || e) };
  }
}

async function main() {
  const localRoot = path.resolve(process.env.LOCAL_DATA_PATH || path.join(__dirname, '..', '..', 'Movie-data'));
  const moviesPath = path.join(localRoot, 'movies', 'movies.ndjson');
  const outPath = path.join(__dirname, 'check_dynamo_records_result.json');

  const localMap = readLocalNdjson(moviesPath);

  // Ten sample imdbIds (picked from local sample). Adjust if you want different ones.
  const sampleIds = [
    'tt0040525','tt0088846','tt19770238','tt5776858','tt1964624',
    'tt0072271','tt0190590','tt0057427','tt0338564','tt0034240'
  ];

  const tableName = (process.env.DDB_TABLE_NAME || process.env.MOVIES_TABLE_NAME || 'reLivre-movies').trim();
  const docClient = getDynamoDocClient();

  const results = [];
  for (const id of sampleIds) {
    const local = localMap.get(id) || null;
    const remote = await fetchItem(docClient, tableName, id);
    results.push({ imdbId: id, local: local ? { title: local.title, moodTags: local.moodTags || [], key: local.key } : null, remote: remote ? { title: remote.title, moodTags: remote.moodTags || [], key: remote.key } : null });
    console.log(`Checked: ${id} -> local=${local ? 'yes' : 'no'} remote=${remote ? 'yes' : 'no'}`);
  }

  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), table: tableName, results }, null, 2), 'utf8');
  console.log(`Wrote report: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
