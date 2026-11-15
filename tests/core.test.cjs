'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/sync-core');

const parse=source=>Object.fromEntries(source.split('\n').filter(Boolean).map(line=>{const i=line.indexOf(':');const value=line.slice(i+1).trim();return[line.slice(0,i),value==='true'?true:value==='false'?false:value.replace(/^"(.*)"$/,'$1')]}));
const stringify=value=>Object.entries(value).map(([k,v])=>`${k}: ${v}`).join('\n');

test('frontmatter preserves body and rejects malformed or non-boolean publish values',()=>{
  const doc=core.parseDocument('---\ntitle: First\npublish: true\n---\nBody\n',parse);
  assert.equal(doc.body,'Body\n');assert.equal(doc.meta.publish,true);
  assert.throws(()=>core.parseDocument('---\ntitle: Broken\nBody',parse),/缺少结束/);
  assert.throws(()=>core.parseDocument('---\npublish: "true"\n---\nBody',parse),/true 或 false/);
  assert.match(core.serialize(doc,stringify),/publish: true/);
});

test('public fingerprint ignores local-only properties and generated metadata',()=>{
  const a={meta:{title:'A',publish:true,web_slug:'a',private_token:'one',rendered_body:'a.html'},body:'same'};
  const b={meta:{title:'A',publish:true,web_slug:'a',private_token:'two',rendered_body:'b.html'},body:'same'};
  assert.equal(core.fingerprint(a),core.fingerprint(b));
  assert.equal(core.direction(null,a,b), 'equal');
});

test('three synchronization modes protect unpublished notes and target edits',()=>{
  const v={meta:{publish:true,title:'vault'},body:'a'},w={meta:{publish:true,title:'web'},body:'b'};
  assert.equal(core.direction(null,v,w,{mode:'vault-to-web'}),'conflict');
  assert.equal(core.direction(null,w,v,{mode:'web-to-vault'}),'conflict');
  assert.equal(core.direction(null,{meta:{publish:false},body:'draft'},null,{mode:'vault-to-web'}),'private');
  assert.equal(core.direction(null,null,{meta:{publish:true},body:'site'},{mode:'vault-to-web'}),'skip');
});

test('equal notes establish a baseline and rerender when routes, assets, or Jekyll output change',()=>{
  const base={routeHash:'old-route',assetSourceHash:'old-assets'};
  const current={mode:'bidirectional',routeHash:'old-route',assetSourceHash:'old-assets',websiteType:'jekyll',webDoc:{meta:{rendered_body:'rendered-notes/a.html',rendered_source_hash:'body'}},slug:'a',sourceHash:'body',includeExists:true};
  assert.equal(core.needsRenderRefresh(null,current),true);
  assert.equal(core.needsRenderRefresh(base,{...current,routeHash:'new-route'}),true);
  assert.equal(core.needsRenderRefresh(base,{...current,assetSourceHash:'new-assets'}),true);
  assert.equal(core.needsRenderRefresh(base,current),false);
  assert.equal(core.needsRenderRefresh(base,{...current,webDoc:{meta:{}},includeExists:false}),true);
  assert.equal(core.needsRenderRefresh(null,{...current,mode:'web-to-vault'}),false);
});

test('path validation prevents traversal, absolute paths, hidden import folders, and duplicate slugs',()=>{
  assert.throws(()=>core.inside('C:/site','../private'),/outside/);
  assert.throws(()=>core.inside('C:/site','/private'),/outside/);
  assert.throws(()=>core.safeFolder('../private'),/相对目录/);
  assert.throws(()=>core.safeFolder('.obsidian'),/相对目录/);
  assert.equal(core.safeSlug('good-note-1'), 'good-note-1');
  assert.throws(()=>core.safeSlug('A note'),/web_slug/);
});

test('unknown notes use the configured neutral import folder',()=>{
  assert.equal(core.classify({meta:{title:'Unsorted'}},'unsorted','Imports'),'Imports/unsorted.md');
});
