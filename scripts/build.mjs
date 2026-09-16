import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
await rm('dist',{recursive:true,force:true}); await mkdir('dist/assets',{recursive:true});
// Retain the auxiliary SOA/signature and migration pages and unbundled compatibility modules.
for (const entry of await readdir('.',{withFileTypes:true})) {
  if (entry.isFile() && /\.(html|css|js|webmanifest|png)$/.test(entry.name)) await cp(entry.name,`dist/${entry.name}`);
}
await cp('assets','dist/assets',{recursive:true});
// Unbundled auxiliary pages need the same locally served SDK.
await build({stdin:{contents:"export { createClient } from '@supabase/supabase-js';",resolveDir:process.cwd(),sourcefile:'supabase-vendor.js'},bundle:true,format:'esm',minify:true,target:'es2022',outfile:'dist/vendor/supabase.js'});
const sourceClient = await readFile('supabase-client.js','utf8');
await writeFile('dist/supabase-client.js',sourceClient.replace("'@supabase/supabase-js'","'/vendor/supabase.js'"));
const result=await build({entryPoints:{app:'app.js'},outdir:'dist/assets',bundle:true,splitting:true,format:'esm',target:['chrome109','safari16','firefox115'],minify:true,entryNames:'[name]-[hash]',chunkNames:'[name]-[hash]',metafile:true,plugins:[{name:'canonical-local-modules',setup(b){b.onResolve({filter:/^\.\.?\/.*\?v=/},args=>({path:path.resolve(args.resolveDir,args.path.split('?')[0])}));}}]});
await build({entryPoints:['auth-base.css','workspace-styles.css'],outdir:'dist',bundle:true,minify:true});
const entry=Object.entries(result.metafile.outputs).find(([,value])=>value.entryPoint==='app.js')?.[0];
if(!entry)throw new Error('Missing public app entry');
let html=await readFile('index.html','utf8'); html=html.replace('src="/app.js"',`src="/${entry.replace(/^dist\//,'')}"`);
await writeFile('dist/index.html',html);
await writeFile('dist/build-info.json',JSON.stringify({commit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||'local',builtAt:new Date().toISOString(),entry}));
await writeFile('build-metafile.json',JSON.stringify(result.metafile,null,2));
