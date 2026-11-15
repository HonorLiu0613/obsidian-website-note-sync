'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const versions=JSON.parse(fs.readFileSync(path.join(root,'versions.json'),'utf8'));
for(const key of ['id','name','version','minAppVersion','description','author','isDesktopOnly'])if(manifest[key]===undefined)throw new Error('manifest.json missing '+key);
if(manifest.id!=='website-note-sync'||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw new Error('Invalid plugin id or version.');
if(!fs.existsSync(path.join(root,'versions.json')))throw new Error('versions.json is required for Obsidian updates.');
if(pkg.version!==manifest.version||versions[manifest.version]!==manifest.minAppVersion)throw new Error('package.json, manifest.json, and versions.json versions must agree.');
for(const name of fs.readdirSync(path.join(root,'src')).filter(name=>name.endsWith('.js'))){
  const file=path.join(root,'src',name);const result=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0)throw new Error(name+': '+result.stderr);
}
const forbidden=/(?:[a-zA-Z]:[\\/](?:Users|Documents|My-Personal-Website)|\/Users\/)[^\s"']*|(?:https?:\/\/)?(?:www\.)?honorliu\.top[^\s"']*/i;
for(const name of fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>entry.name)){
  if(!/\.(?:json|md|yml|yaml|js|cjs|css|html|txt)$/.test(name))continue;
  if(forbidden.test(fs.readFileSync(path.join(root,name),'utf8')))throw new Error('Machine-specific path or private site marker found in '+name);
}
for(const directory of ['src','tests','scripts','docs','examples','.github'])for(const name of (function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);})(path.join(root,directory))){
  if(!/\.(?:json|md|yml|yaml|js|cjs|css|html|txt)$/.test(name))continue;
  if(forbidden.test(fs.readFileSync(name,'utf8')))throw new Error('Machine-specific path or private site marker found in '+path.relative(root,name));
}
console.log('Manifest and JavaScript syntax checks passed.');
