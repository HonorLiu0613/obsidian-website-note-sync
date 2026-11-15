'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),run=(command,args)=>{const result=cp.spawnSync(command,args,{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);};
run(process.execPath,[path.join(__dirname,'check.cjs')]);
run(process.execPath,[path.join(__dirname,'build.cjs')]);
const {zipSync,strToU8}=require('fflate');
const out={};for(const name of ['main.js','manifest.json','versions.json','styles.css'])out[name]=new Uint8Array(fs.readFileSync(path.join(root,'dist',name)));
fs.writeFileSync(path.join(root,'dist',`website-note-sync-${require('../manifest.json').version}.zip`),zipSync(out,{level:9}));
console.log('Created an Obsidian-ready release archive in dist/.');
