import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(dir='.') {
 const results=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(['.git','node_modules','dist','test-results'].includes(entry.name))continue;
  const name=`${dir}/${entry.name}`;
  if(entry.isDirectory())results.push(...await walk(name));
  else if(/\.(js|mjs|cjs)$/.test(name))results.push(name);
 }
 return results;
}
const files=await walk();for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){console.error(result.stderr||result.error);process.exit(1);}}
console.log(`${files.length} JavaScript files passed syntax checks.`);
