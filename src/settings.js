'use strict';
const publisher = require('./git-publisher');
const media = require('./media-publisher');
const PLATFORMS = Object.freeze({csdn:'CSDN',zhihu:'知乎'});
const DEFAULTS = Object.freeze({
  websitePath:'', websiteType:'jekyll', contentFolder:'_notes', publicPath:'/notes/', basePath:'',
  rubyExecutable:'', bundlePath:'', buildAfterSync:false, syncMode:'vault-to-web',
  protectTargetChanges:true, refreshBodyStyles:false, importFolder:'Website Imports',
  excludedFolders:'Templates\n99-模板', gitExecutable:publisher.defaultExecutable(), gitRemote:'origin',
  openPushAfterSync:false, buildBeforePush:false, commitMessage:'Update public notes',
  edgeExecutable:media.defaultEdge(), mediaPlatforms:['csdn','zhihu'], mediaAutoOpen:false,
  mediaWebsiteUrl:'', backupLimit:10
});
function loadSettings(saved={}) {
  const value={...DEFAULTS,...saved};
  value.mediaPlatforms=(Array.isArray(saved.mediaPlatforms)?saved.mediaPlatforms:DEFAULTS.mediaPlatforms).filter(id=>PLATFORMS[id]);
  if(!value.mediaPlatforms.length)value.mediaPlatforms=[...DEFAULTS.mediaPlatforms];
  value.backupLimit=Math.max(1,Math.min(100,Number(value.backupLimit)||10));
  if (!['jekyll','markdown'].includes(value.websiteType)) value.websiteType='jekyll';
  return value;
}
function excluded(file,settings){
  if(file.replace(/\\/g,'/').split('/').some(part=>part.startsWith('.')))return true;
  return String(settings.excludedFolders||'').split(/\r?\n/).map(x=>x.trim().replace(/\\/g,'/').replace(/\/+$/,'')).filter(Boolean).some(folder=>file===folder||file.startsWith(folder+'/'));
}
module.exports={DEFAULTS,PLATFORMS,loadSettings,excluded};
