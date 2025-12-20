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
const found=Object.fromEntries(want.map(t=>[t,false]));
const rl=readline.createInterface({input:fs.createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});
rl.on('line',(line)=>{
  try{
    const j=JSON.parse(line);
    if(j && j.title){
      const t=j.title.trim();
      if(want.includes(t)) found[t]=true;
    }
  }catch(e){}
});
rl.on('close',()=>{
  want.forEach(t=>console.log((found[t]? 'FOUND':'MISSING') + ' : ' + t));
});
