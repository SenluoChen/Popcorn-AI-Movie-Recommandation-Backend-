const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

console.log('LOCAL_DATA_PATH=', process.env.LOCAL_DATA_PATH);
const root = path.resolve(String(process.env.LOCAL_DATA_PATH || ''));
const moviesPath = path.join(root, 'movies', 'movies.ndjson');
console.log('movies.ndjson=', moviesPath);
console.log('exists?', fs.existsSync(moviesPath));
const first = fs.readFileSync(moviesPath, 'utf8').split(/\r?\n/)[0];
const idx = first.indexOf('"moodTags"');
console.log('firstLineMoodTagsIndex=', idx);
console.log('firstLineMoodTagsSnippet=', idx >= 0 ? first.slice(idx, idx + 100) : '(not found)');
