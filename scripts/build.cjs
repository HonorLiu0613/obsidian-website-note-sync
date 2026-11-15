'use strict';
const fs=require('fs'),path=require('path');
const {build}=require('esbuild');
(async()=>{
  const root=path.resolve(__dirname,'..');
  await build({entryPoints:[path.join(root,'src/main.js')],bundle:true,platform:'node',format:'cjs',target:'node16',external:['obsidian'],outfile:path.join(root,'dist/main.js'),legalComments:'inline',minify:false});
  for(const name of ['manifest.json','versions.json','styles.css'])fs.copyFileSync(path.join(root,name),path.join(root,'dist',name));
  console.log('Built dist/main.js with Obsidian API kept external.');
})().catch(error=>{console.error(error);process.exitCode=1;});
