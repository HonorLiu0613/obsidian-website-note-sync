'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const publisher=require('../src/git-publisher');

function git(cwd,args){
  const result=spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error(result.stderr||result.stdout||'Git test command failed.');
  return result.stdout.trim();
}

test('publishing commits exact plugin-owned files and leaves sibling edits untouched',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wns-git-'));
  const remote=path.join(root,'remote.git'),repo=path.join(root,'site');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(repo);
  git(root,['init','--bare','--initial-branch=main',remote]);
  git(repo,['init','--initial-branch=main']);
  git(repo,['config','user.name','Website Note Sync Test']);
  git(repo,['config','user.email','test@example.invalid']);
  fs.mkdirSync(path.join(repo,'content','notes'),{recursive:true});
  fs.writeFileSync(path.join(repo,'content','notes','a.md'),'before\n');
  git(repo,['add','content/notes/a.md']);git(repo,['commit','-m','initial']);
  git(repo,['remote','add','origin',remote]);git(repo,['push','-u','origin','main']);

  fs.writeFileSync(path.join(repo,'content','notes','a.md'),'plugin update\n');
  fs.writeFileSync(path.join(repo,'content','notes','other.md'),'user draft\n');
  const settings={gitExecutable:'git',gitRemote:'origin'},scope=['content/notes/a.md'];
  const preview=await publisher.plan(repo,settings,scope);
  assert.deepEqual(preview.files.map(file=>file.path),scope);
  assert.deepEqual(preview.excludedFiles.map(file=>file.path),['content/notes/other.md']);
  const result=await publisher.publish(repo,settings,preview,'Update published note',scope);
  assert.equal(result.committed,true);
  assert.equal(fs.readFileSync(path.join(repo,'content','notes','other.md'),'utf8'),'user draft\n');
  assert.match(git(repo,['status','--porcelain']),/\?\? content\/notes\/other\.md/);
  assert.equal(git(remote,['--git-dir',remote,'show','refs/heads/main:content/notes/a.md']),'plugin update');

  fs.writeFileSync(path.join(repo,'content','notes','a.md'),'second update\n');
  fs.writeFileSync(path.join(repo,'outside.txt'),'staged user work\n');
  git(repo,['add','outside.txt']);
  const staged=await publisher.plan(repo,settings,scope);
  await assert.rejects(publisher.publish(repo,settings,staged,'Second update',scope),/暂存区已有改动/);
  assert.equal(git(repo,['log','-1','--format=%s']),'Update published note');
});

test('scope matching includes only exact generated file paths',()=>{
  assert.equal(publisher.matchesScope('content/notes/a.md',['content/notes/a.md']),true);
  assert.equal(publisher.matchesScope('content/notes/other.md',['content/notes/a.md']),false);
  assert.equal(publisher.normalizeAbsolute('C:/site/notes'),'c:\\site\\notes');
  assert.equal(publisher.normalizeAbsolute('/c/site/notes'),'c:\\site\\notes');
});
