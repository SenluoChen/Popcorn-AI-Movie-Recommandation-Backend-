const fs=require('fs');
const readline=require('readline');
const path='C:/Users/Louis/Visual Studio/Popcorn/Movie-data/movies/movies.ndjson';
const re=/dunkirk|evacuate|evacuat|evacuation|miracle of dunkirk|beach evacuation|evacuee/i;
const results=[];
const rl=readline.createInterface({input:fs.createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});
rl.on('line',line=>{
  try{
    const j=JSON.parse(line);
    const text=[j.plot,j.detailedPlot,j.keywords,j.tags].filter(Boolean).join(' ');
    if(re.test(text) || (j.title && /dunkirk/i.test(j.title))){
      const m=text.match(new RegExp('.{0,80}('+re.source+').{0,80}','i'));
      results.push({title:j.title,year:j.year,imdbId:j.imdbId,snippet: m? m[0].replace(/\n/g,' '):''});
    }
  }catch(e){}
});
rl.on('close',()=>{
  console.log(JSON.stringify(results,null,2));
});
