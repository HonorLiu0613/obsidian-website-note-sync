'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Transaction,atomicWrite,prune}=require('../src/transaction');

test('transaction backs up writes and deletions, then prunes only recognized snapshots',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wns-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const vault=path.join(temp,'vault'),web=path.join(temp,'web'),backups=path.join(vault,'backups');
  fs.mkdirSync(path.join(web,'notes'),{recursive:true});fs.writeFileSync(path.join(web,'notes','old.md'),'old');
  const tx=new Transaction({vault,web},path.join(backups,'2026-11-15T12-00-00-000Z-a1b2'));
  tx.add('web','notes/new.md','new');tx.add('web','notes/old.md',null);
  await tx.commit(async(change,content)=>atomicWrite(change.full,content));
  assert.equal(fs.readFileSync(path.join(web,'notes','new.md'),'utf8'),'new');
  assert.equal(fs.existsSync(path.join(web,'notes','old.md')),false);
  assert.equal(fs.readFileSync(path.join(backups,'2026-11-15T12-00-00-000Z-a1b2','web','notes','old.md'),'utf8'),'old');
  fs.mkdirSync(path.join(backups,'important'));fs.writeFileSync(path.join(backups,'important','keep.txt'),'keep');
  for(let i=0;i<4;i++){const dir=path.join(backups,`2026-11-15T12-00-0${i}-000Z-a${i}b2`);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'recovery.json'),'{}');}
  prune(backups,2);
  assert.equal(fs.existsSync(path.join(backups,'important','keep.txt')),true);
  assert.equal(fs.readdirSync(backups).filter(name=>/^\d{4}-\d\d-\d\dT\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{1,8}$/.test(name)).length,2);
});

test('a failed staged apply rolls already-written files back from the manifest backup',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wns-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const web=path.join(temp,'web'),vault=path.join(temp,'vault');fs.mkdirSync(web);fs.writeFileSync(path.join(web,'a.md'),'before');
  const tx=new Transaction({web,vault},path.join(vault,'backups','test'));
  tx.add('web','a.md','after');tx.add('web','b.md','new');let writes=0;
  await assert.rejects(tx.commit(async(change,content)=>{writes++;if(writes===2)throw new Error('disk full');atomicWrite(change.full,content);}),/本次写入已回滚/);
  assert.equal(fs.readFileSync(path.join(web,'a.md'),'utf8'),'before');
  assert.equal(fs.existsSync(path.join(web,'b.md')),false);
  assert.ok(fs.existsSync(path.join(vault,'backups','test','recovery.json')));
});

test('transaction rejects a target changed since preview',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wns-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const web=path.join(temp,'web');fs.mkdirSync(web);fs.writeFileSync(path.join(web,'note.md'),'preview');
  const tx=new Transaction({web},path.join(temp,'backup'));tx.add('web','note.md','next');fs.writeFileSync(path.join(web,'note.md'),'user edit');
  await assert.rejects(tx.commit(async(change,content)=>atomicWrite(change.full,content)),/重新预览/);
});
