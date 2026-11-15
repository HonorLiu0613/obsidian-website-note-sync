'use strict';
const fs=require('fs'),path=require('path');
const core=require('./sync-core');
function folder(settings){return core.safeFolder(settings.contentFolder||'_notes');}
function route(settings,slug){
  const prefix=String(settings.publicPath||'/notes/');
  const base=String(settings.basePath||'').replace(/\/$/,'');
  if(!/^\/(?:[\w\-./]*\/)?$/.test(prefix)||prefix.includes('..')||!/^$|^\/[\w\-/]+$/.test(base)||base.includes('..'))throw new Error('网址路径须形如 /notes/，子路径须形如 /my-site。');
  return base+prefix+core.safeSlug(slug)+'/';
}
function relative(settings,slug){return folder(settings)+'/'+core.safeSlug(slug)+'.md';}
function root(settings){
  if(!settings.websitePath)throw new Error('请先在插件设置中填写网站仓库目录；媒体草稿可独立使用。');
  const result=path.resolve(settings.websitePath);
  if(!fs.existsSync(result)||!fs.statSync(result).isDirectory())throw new Error('网站目录不存在。');
  if(settings.websiteType==='jekyll'&&!fs.existsSync(path.join(result,'_config.yml')))throw new Error('Jekyll 模式需要 _config.yml。其他网站请选择 Markdown 模式。');
  const content=core.inside(result,folder(settings));
  if(!fs.existsSync(content)||!fs.statSync(content).isDirectory())throw new Error('笔记输出目录不存在：'+folder(settings)+'。请先创建目录，或使用仓库中的 examples/jekyll-site 模板。');
  return result;
}
function files(root,settings){
  const result=[];
  const walk=relative=>{
    for(const entry of fs.readdirSync(core.inside(root,relative),{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const child=relative+'/'+entry.name;
      const full=core.inside(root,child);
      if(entry.isDirectory())walk(child);
      else if(entry.isFile()&&/\.md$/i.test(entry.name))result.push({relative:child,full,name:entry.name});
    }
  };
  walk(folder(settings));return result;
}
function publicMeta(meta){return Object.fromEntries(Object.entries(meta).filter(([key])=>core.PUBLIC_KEYS.has(key)));}
function ownedAsset(relative){return /^assets\/notes\/[a-z0-9-]+\/[a-f0-9]{10}-[a-z0-9-]+\.(png|jpe?g|gif|svg|webp|avif|pdf|mp4|webm|mp3|wav|ogg)$/.test(relative);}
module.exports={folder,route,relative,root,files,publicMeta,ownedAsset};
