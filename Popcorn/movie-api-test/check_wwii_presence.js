const fs=require('fs');
const readline=require('readline');
const path='C:/Users/Louis/Visual Studio/Popcorn/Movie-data/movies/movies.ndjson';
const want=[
  'Hacksaw Ridge',
  'Come and See',
  'The Great Dictator',
  'Army of Shadows',
  'Dunkirk',
  'Land of Mine',
  'The Cranes Are Flying',
  'The Guns of Navarone',
  'The Round Up',
  'At War for Love'
];
const keywords=[/world war/i,/wwii/i,/second world/i,/nazi/i,/resistance/i,/dunkirk/i,/soldier/i,/occupation/i,/mines?/i,/round up/i,/vel/];
const results=Object.fromEntries(want.map(t=>[t,{found:false,snippet:''}]));
const rl=readline.createInterface({input:fs.createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});
rl.on('line',line=>{
  try{
    const j=JSON.parse(line);
    if(j && j.title && want.includes(j.title)){
      const text=[j.plot,j.unifiedPlot,j.expandedOverview,j.keywords,j.tags].filter(Boolean).join(' ');
      for(const re of keywords){
        if(re.test(text)){
          results[j.title].found=true;
          const m=text.match(new RegExp('.{0,60}('+re.source+').{0,60}','i'));
          results[j.title].snippet = m ? m[0].replace(/\n/g,' ') : '';
          break;
        }
      }
    }
  }catch(e){}
});
rl.on('close',()=>{
  want.forEach(t=>{
    console.log((results[t].found? 'YES':'NO') + ' : ' + t + (results[t].found? ' -> '+results[t].snippet : ''));
  });
});
