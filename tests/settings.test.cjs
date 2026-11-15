'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const settings=require('../src/settings');
const website=require('../src/website');

test('first-run defaults are private, manual, low-risk, and do not assume a site',()=>{
  const value=settings.loadSettings();
  assert.equal(value.websitePath,'');assert.equal(value.syncMode,'vault-to-web');
  assert.equal(value.buildAfterSync,false);assert.equal(value.openPushAfterSync,false);
  assert.equal(value.buildBeforePush,false);assert.deepEqual(value.mediaPlatforms,['csdn','zhihu']);
});

test('legacy settings migrate safely and retired platform values disappear',()=>{
  const value=settings.loadSettings({mediaPlatforms:['xiaohongshu','douyin'],websitePath:'E:/private/site'});
  assert.deepEqual(value.mediaPlatforms,['csdn','zhihu']);assert.equal(value.websitePath,'E:/private/site');
});

test('configured vault exclusions apply to whole directories and hidden paths',()=>{
  const value=settings.loadSettings({excludedFolders:'Templates\nArchive/Drafts'});
  assert.equal(settings.excluded('Templates/new.md',value),true);
  assert.equal(settings.excluded('Archive/Drafts/a.md',value),true);
  assert.equal(settings.excluded('Research/a.md',value),false);
  assert.equal(settings.excluded('.obsidian/plugins/a.md',value),true);
});

test('website path mapping supports Jekyll, generic Markdown, and project sites',()=>{
  const value=settings.loadSettings({websitePath:'C:/site',contentFolder:'content/notes',publicPath:'/kb/',basePath:'/portfolio'});
  assert.equal(website.relative(value,'guide'),'content/notes/guide.md');
  assert.equal(website.route(value,'guide'),'/portfolio/kb/guide/');
  assert.throws(()=>website.route({...value,publicPath:'/../../secret/'} ,'guide'),/网址路径/);
  assert.throws(()=>website.relative(value,'../../outside'),/web_slug/);
});
