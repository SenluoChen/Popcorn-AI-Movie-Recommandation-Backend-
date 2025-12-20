const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const root = path.resolve(String(process.env.LOCAL_DATA_PATH || ''));
const moviesPath = path.join(root, 'movies', 'movies.ndjson');
const lines = fs.readFileSync(moviesPath, 'utf8').split(/\r?\n/).filter(Boolean);

const titles = new Set(['Now Is Good', 'Whiplash', "Behind the Scenes of 'Hotel Mumbai'"]);
for (const line of lines) {
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  if (titles.has(obj.title)) {
    console.log(JSON.stringify({ title: obj.title, moodTags: obj.moodTags, genre: obj.genre }, null, 2));
  }
}
