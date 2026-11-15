'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {draftUrl,MediaBridge}=require('../src/media-publisher');

test('draft links accept only the selected platform editor origin',()=>{
  assert.equal(draftUrl('csdn','https://editor.csdn.net/md?articleId=1'),'https://editor.csdn.net/md?articleId=1');
  assert.equal(draftUrl('zhihu','https://zhuanlan.zhihu.com/write'),'https://zhuanlan.zhihu.com/write');
  assert.equal(draftUrl('csdn','https://example.com/'),null);
});

test('local media handoff rejects unselected platforms and stores only validated draft links',async t=>{
  const results=[],bridge=new MediaBridge(async result=>results.push(result));t.after(()=>bridge.close());
  const url=await bridge.create({sourcePath:'Notes/a.md',title:'A',fingerprint:'x',posts:{}},{mediaPlatforms:['csdn'],mediaAutoOpen:false});
  const parsed=new URL(url),token=parsed.pathname.split('/')[1];
  const foreign=await fetch(url+'result',{method:'POST',headers:{Origin:'http://example.com','Content-Type':'application/json'},body:JSON.stringify({platform:'csdn',url:'https://editor.csdn.net/md?articleId=0'})});
  assert.equal(foreign.status,403);
  const bad=await fetch(url+'result',{method:'POST',headers:{Origin:parsed.origin,'Content-Type':'application/json'},body:JSON.stringify({platform:'zhihu',url:'https://zhuanlan.zhihu.com/write'})});
  assert.equal(bad.status,400);assert.equal(results.length,0);
  const good=await fetch(url+'result',{method:'POST',headers:{Origin:parsed.origin,'Content-Type':'application/json'},body:JSON.stringify({platform:'csdn',url:'https://editor.csdn.net/md?articleId=1'})});
  assert.equal(good.status,200);assert.equal(results.length,1);assert.equal(results[0].platform,'csdn');
  const repeated=await fetch(url+'result',{method:'POST',headers:{Origin:parsed.origin,'Content-Type':'application/json'},body:JSON.stringify({platform:'csdn',url:'https://editor.csdn.net/md?articleId=2'})});
  assert.equal(repeated.status,200);assert.equal(results.length,1);assert.equal(token.length,48);
});
