'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const core=require('./sync-core');
// Stage every render before modifying either root. Backups include a recovery
// manifest; runtime failures roll back already-applied writes in reverse order.
class Transaction {
  constructor(roots,backupRoot){this.roots=roots;this.backupRoot=backupRoot;this.changes=new Map();}
  add(side,relative,after){
    const key=side+':'+relative,full=core.inside(this.roots[side],relative);
    const before=fs.existsSync(full)?fs.readFileSync(full):null;
    const next=after===null?null:Buffer.from(after);
    if(before===null&&next===null||before&&next&&before.equals(next))return;
    if(this.changes.has(key))throw new Error('重复写入同一路径：'+relative);
    this.changes.set(key,{side,relative,full,before,after:next});
  }
  verify(){for(const c of this.changes.values()){
    core.inside(this.roots[c.side],c.relative);
    const now=fs.existsSync(c.full)?fs.readFileSync(c.full):null;
    if((c.before===null)!==(now===null)||c.before&&now&&!c.before.equals(now))throw new Error('准备期间文件已更改，请重新预览：'+c.relative);
  }}
  async commit(write){
    if(!this.changes.size)return;
    this.verify();fs.mkdirSync(this.backupRoot,{recursive:true});
    const changes=[...this.changes.values()];
    for(const c of changes)if(c.before!==null){const backup=core.inside(this.backupRoot,c.side+'/'+c.relative);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,c.before);}
    fs.writeFileSync(path.join(this.backupRoot,'recovery.json'),JSON.stringify({version:1,created:new Date().toISOString(),roots:this.roots,files:changes.map(c=>({side:c.side,path:c.relative,existed:c.before!==null}))},null,2));
    const applied=[];
    try{for(const c of changes){applied.push(c);await write(c,c.after);}}
    catch(error){
      const failures=[];
      for(const c of applied.reverse())try{await write(c,c.before);}catch(e){failures.push(c.relative+': '+e.message);}
      throw new Error(error.message+(failures.length?'；部分回滚失败，请从备份恢复：'+this.backupRoot+'\n'+failures.join('\n'):'；本次写入已回滚。'));
    }
  }
}
function atomicWrite(full,content){
  if(content===null){if(fs.existsSync(full))fs.unlinkSync(full);return;}
  fs.mkdirSync(path.dirname(full),{recursive:true});
  const temporary=full+'.wns-'+crypto.randomBytes(8).toString('hex')+'.tmp';
  try{fs.writeFileSync(temporary,content);fs.renameSync(temporary,full);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function prune(backupParent,limit){
  if(!fs.existsSync(backupParent))return;
  const entries=fs.readdirSync(backupParent,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^\d{4}-\d\d-\d\dT\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{1,8}$/.test(e.name)).map(e=>e.name).sort().reverse();
  for(const name of entries.slice(limit)){const full=core.inside(backupParent,name);if(fs.existsSync(path.join(full,'recovery.json')))fs.rmSync(full,{recursive:true});}
}
module.exports={Transaction,atomicWrite,prune};
