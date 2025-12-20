const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const root = path.resolve(String(process.env.LOCAL_DATA_PATH || ''));
const moviesPath = path.join(root, 'movies', 'movies.ndjson');

const targetTitle = "Behind the Scenes of 'Hotel Mumbai'";
const lines = fs.readFileSync(moviesPath, 'utf8').split(/\r?\n/).filter(Boolean);

const VIOLENCE_RE = /(terroris|terrorism|attack|massacre|hostage|shooting|gunman|bomb|explos|assault|kidnap|abduct|murder|serial\s+killer|war\s+crime|genocide|holocaust|torture|slaughter|siege|hatred|spread\s+death|atrocity|punitive\s+action|nazi|hitler|insurg|extremis|mass\s+shooting|school\s+shooting|home\s+invasion|stalker)/i;

for (const line of lines) {
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  if (obj.title !== targetTitle) continue;

  const text = [obj.title, obj.genre, obj.keywords, obj.plot, obj.detailedPlot].filter(Boolean).join(' ').toLowerCase();
  console.log('title=', obj.title);
  console.log('genre=', obj.genre);
  console.log('plot=', obj.plot);
  console.log('moodTags=', obj.moodTags);
  console.log('VIOLENCE_RE=', VIOLENCE_RE.test(text));
  console.log('contains terrorists?', text.includes('terrorist'));
  console.log('contains hatred?', text.includes('hatred'));
  console.log('contains attack?', text.includes('attack'));
  console.log('contains death?', text.includes('death'));
  break;
}
