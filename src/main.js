'use strict';
const {Plugin,PluginSettingTab,Setting,Notice,Modal,MarkdownRenderer,Component,parseYaml,stringifyYaml}=require('obsidian');
const fs=require('fs');
const path=require('path');
const core=require('./sync-core');
const border=require('./border-snapshot');
const render=require('./render-utils');
const publisher=require('./git-publisher');
const media=require('./media-publisher');
const mediaContent=require('./media-content');
const {PLATFORMS:MEDIA_PLATFORMS,DEFAULTS,loadSettings,excluded}=require('./settings');
const website=require('./website');
const {Transaction,atomicWrite,prune}=require('./transaction');
const TODAY=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const readDoc=text=>core.parseDocument(text,parseYaml);
const serialize=doc=>core.serialize(doc,stringifyYaml);
const publicMeta=meta=>Object.fromEntries(Object.entries(meta).filter(([key])=>!core.MANAGED.has(key)));

module.exports=class WebsiteNoteSync extends Plugin {
  async onload() {
    this.data=await this.loadData()||{};
    this.settings=loadSettings(this.data.settings);
    // Migrate retired platform values and normalize defaults in the saved plugin data.
    if(JSON.stringify(this.data.settings||{})!==JSON.stringify(this.settings)){
      this.data={...this.data,settings:this.settings};
      await this.saveData(this.data);
    }
    this.state=this.data.state||{};
    this.scopes=this.data.scopes||{};this.currentScope=this.data.scope||null;
    this.mediaBridge=new media.MediaBridge(async result=>{
      this.data.mediaHistory=[result,...(this.data.mediaHistory||[]).filter(item=>item.sourcePath!==result.sourcePath||item.platform!==result.platform)].slice(0,100);
      await this.save();new Notice((MEDIA_PLATFORMS[result.platform]||result.platform)+' 草稿已保存；请在 Edge 编辑页确认发布。',10000);
    });
    this.addRibbonIcon('layers','打开同步中心',()=>new SyncCenter(this.app,this).open());
    this.addCommand({id:'send-current-note-to-media',name:'将当前笔记发送到媒体平台草稿',callback:()=>this.previewMedia()});
    this.addCommand({id:'draft-current-note-csdn',name:'将当前笔记发送到 CSDN 草稿',callback:()=>this.previewMedia(['csdn'])});
    this.addCommand({id:'draft-current-note-zhihu',name:'将当前笔记发送到知乎草稿',callback:()=>this.previewMedia(['zhihu'])});
    this.addCommand({id:'check-configuration',name:'检查配置与安装说明',callback:()=>this.diagnose()});
    this.addCommand({id:'push-website',name:'预览改动并推送网站到 GitHub',callback:()=>this.previewPush()});
    this.addCommand({id:'sync-public-notes',name:'预览并同步公开笔记',callback:()=>this.preview()});
    this.addCommand({id:'sync-current-note',name:'预览并同步当前笔记',callback:()=>{
      const file=this.app.workspace.getActiveFile();
      if(!file||file.extension!=='md')return new Notice('请先打开一篇 Markdown 笔记。');
      this.preview(file.path);
    }});
    this.addCommand({id:'prepare-current-note',name:'为当前笔记补充网站发布属性',callback:()=>this.prepareCurrentNote()});
    this.addCommand({id:'toggle-public',name:'切换当前笔记公开状态',callback:async()=>{
      const file=this.app.workspace.getActiveFile();
      if(!file||file.extension!=='md')return;
      await this.app.fileManager.processFrontMatter(file,meta=>{meta.publish=meta.publish!==true;});
      new Notice('公开状态已更新；点击双向同步后应用到网站。');
    }});
    this.settingTab=new SyncSettings(this.app,this);
    this.addSettingTab(this.settingTab);
  }
  onunload(){this.mediaBridge?.close();}
  previewMedia(platforms=this.settings.mediaPlatforms){
    const file=this.app.workspace.getActiveFile();
    if(!file||file.extension!=='md')return new Notice('请先打开一篇 Markdown 笔记。');
    if(excluded(file.path,this.settings))return new Notice('当前笔记位于排除目录，请打开正文笔记。');
    new MediaPreview(this.app,this,file,platforms).open();
  }
  async sendMedia(file,platforms){
    if(this.preparingMedia)throw new Error('正在准备另一篇笔记，请稍后再试。');
    if(!platforms.length||platforms.some(id=>!MEDIA_PLATFORMS[id]))throw new Error('请选择 CSDN 或知乎。');
    this.preparingMedia=true;
    try{
      const article=await this.prepareMedia(file);
      const url=await this.mediaBridge.create(article,{...this.settings,mediaPlatforms:platforms});
      await media.openEdge(this.settings.edgeExecutable,url);return url;
    }finally{this.preparingMedia=false;}
  }
  async prepareMedia(file){return mediaContent.prepareArticle(this,file);}
  async prepareCurrentNote() {
    const file=this.app.workspace.getActiveFile();
    if(!file||file.extension!=='md')return new Notice('请先打开一篇 Markdown 笔记。');
    if(excluded(file.path,this.settings))return new Notice('请在正文笔记中添加属性。');
    await this.app.fileManager.processFrontMatter(file,meta=>{
      if(!meta.title)meta.title=file.basename;
      if(!meta.date)meta.date=TODAY();
      if(!meta.updated)meta.updated=meta.date;
      if(meta.publish===undefined)meta.publish=false;
      if(!meta.domain)meta.domain=core.inferDomain({meta},file.path);
      if(!meta.tags)meta.tags=[];
      if(meta.featured===undefined)meta.featured=false;
      if(meta.excerpt===undefined)meta.excerpt='';
    });
    new Notice('发布属性已补充。写好后勾选 publish，再预览同步。');
  }
  async save() {this.data={...this.data,settings:this.settings,state:this.state,scope:this.currentScope,scopes:this.scopes};await this.saveData(this.data);}
  async pendingPublicationNotes() {
    return (await this.plan()).items.filter(item=>!['equal','skip'].includes(item.action));
  }
  async previewPush() {
    if(this.running||this.publishing)return new Notice('正在同步或发布，请完成后再试。');
    try{
      const pending=await this.pendingPublicationNotes();
      if(pending.length)return new PendingPublication(this.app,this,pending).open();
      const paths=this.data.publishPaths||[];
      if(!paths.length)throw new Error('尚无插件生成的待推送文件。先同步公开笔记，再打开推送预览。网站导航和布局请用常规 Git 流程发布。');
      const root=this.root();
      if(this.settings.buildBeforePush)await this.buildWebsite(root);
      new PushPreview(this.app,this,await publisher.plan(root,this.settings,paths)).open();
    }
    catch(error){new Notice('无法准备发布：'+error.message,12000);console.error(error);}
  }
  async pushWebsite(expectedPlan,message) {
    if(this.running||this.publishing)throw new Error('正在同步或发布。');
    this.publishing=true;
    try {
      const root=this.root();
      const pending=await this.pendingPublicationNotes();
      if(pending.length)throw new Error('有 '+pending.length+' 篇笔记尚未同步，请先预览同步并处理冲突，再推送网站。');
      const paths=this.data.publishPaths||[];
      if(!paths.length)throw new Error('上次同步没有生成可推送的网站文件。');
      const current=await publisher.plan(root,this.settings,paths);
      if(publisher.signature(current)!==publisher.signature(expectedPlan))throw new Error('预览后网站仓库有改动，请重新预览。');
      if(current.files.length===0&&current.ahead===0){
        new Notice('没有新版本可发布：网站文件没有改动，也没有待推送提交。',10000);
        return {unchanged:true,commit:current.head,committed:false,files:0,remote:current.remote,branch:current.branch};
      }
      if(current.files.length===0)throw new Error('没有插件范围内的文件可提交。为避免推送其他本地提交，请使用常规 Git 流程发布。');
      const result=await publisher.publish(root,this.settings,expectedPlan,message,paths);
      this.data.lastPush={...result,time:new Date().toISOString()};this.data.publishPaths=[];await this.save();
      new Notice('已推送到 '+result.remote+'/'+result.branch+'；GitHub Actions 正在部署，请稍后查看线上网站。',12000);
      return result;
    } finally {this.publishing=false;}
  }
  root() {
    return website.root(this.settings);
  }
  async plan({onlyPath=null}={}) {
    const root=this.root(), vault=new Map(), web=new Map();
    const scope=core.hash(root+'|'+this.settings.websiteType+'|'+website.folder(this.settings));
    if(this.currentScope!==scope){
      if(this.currentScope)this.scopes[this.currentScope]=this.state;
      this.state=this.scopes[scope]||(this.currentScope?{}:this.state);
      this.currentScope=scope;
    }
    const mode=this.settings.syncMode;
    if(!core.MODES[mode])throw new Error('请在设置中选择有效的同步模式。');
    core.safeFolder(this.settings.importFolder);
    for(const file of this.app.vault.getMarkdownFiles()) {
      if(excluded(file.path,this.settings))continue;
      const raw=await this.app.vault.read(file),doc=readDoc(raw);
      if(doc.meta.publish!==true&&!doc.meta.web_id)continue;
      const id=String(doc.meta.web_id||doc.meta.web_slug||core.slugFromFile(file.path));
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))throw new Error('web_id 只能包含英文字母、数字、下划线和连字符：'+file.path);
      if(vault.has(id))throw new Error('两篇 Obsidian 笔记使用了同一个 web_id：'+id);
      vault.set(id,{file,raw,doc});
    }
    for(const {name,full,relative} of website.files(root,this.settings)) {
      const raw=fs.readFileSync(full,'utf8'),doc=readDoc(raw);
      const id=String(doc.meta.web_id||doc.meta.web_slug||name.slice(0,-3));
      if(doc.meta.publish!==true&&!this.state[id])continue;
      if(web.has(id))throw new Error('两篇网站笔记使用了同一个 web_id：'+id);
      web.set(id,{name,full,relative,raw,doc});
    }
    const ids=new Set([...vault.keys(),...web.keys(),...Object.keys(this.state)]),items=[];
    for(const id of ids) {
      const v=vault.get(id),w=web.get(id),base=this.state[id];
      if(!v&&!w)continue;
      const action=core.direction(base,v?.doc,w?.doc,{mode,protectTargetChanges:this.settings.protectTargetChanges});
      if(action==='private'||action==='missing')continue;
      const document=v?.doc||w?.doc;
      const slug=core.safeSlug(document.meta.web_slug||base?.slug||w?.name.slice(0,-3)||core.slugFromFile(v.file.path));
      const vaultPath=v?.file.path||base?.vaultPath||core.classify(document,slug,this.settings.importFolder);
      const webPath=website.relative(this.settings,slug);
      core.inside(this.app.vault.adapter.basePath,vaultPath);core.inside(root,webPath);
      if(!v&&this.app.vault.getAbstractFileByPath(vaultPath))throw new Error('导入路径已有其他文件：'+vaultPath);
      const dependencies=v?this.assetFingerprint(v.file):'';
      const routeHash=core.hash(JSON.stringify({basePath:this.settings.basePath||'',publicPath:this.settings.publicPath||''}));
      const sourceHash=v?core.hash(v.doc.body.replace(/\r\n/g,'\n')):'';
      const includePath='_includes/rendered-notes/'+slug+'.html';
      const includeFull=core.inside(root,includePath);
      const includeExists=this.settings.websiteType==='jekyll'&&fs.existsSync(includeFull);
      const refreshOnly=action==='equal'&&!!v&&core.needsRenderRefresh(base,{mode,routeHash,assetSourceHash:dependencies,websiteType:this.settings.websiteType,webDoc:w?.doc,slug,sourceHash,includeExists});
      const actual=refreshOnly?'export':action;
      items.push({id,slug,vaultPath,webPath,action:actual,refreshOnly,routeHash,assetSourceHash:dependencies,v,w,base,title:String(document.meta.title||v?.file.basename||slug)});
    }
    const targets=new Set();
    for(const item of items){
      const target=process.platform==='win32'?item.webPath.toLowerCase():item.webPath;
      if(targets.has(target))throw new Error('多个笔记使用同一 web_slug：'+item.slug);targets.add(target);
      const full=core.inside(root,item.webPath);
      if(fs.existsSync(full)&&full!==item.w?.full)throw new Error('输出路径已有其他文件：'+item.webPath);
    }
    return {root,mode,onlyPath,settingsHash:core.hash(JSON.stringify(this.settings)),allItems:items,items:onlyPath?items.filter(item=>item.vaultPath===onlyPath):items};
  }
  async preview(onlyPath=null) {
    try {
      const plan=await this.plan({onlyPath});
      if(!plan.items.length)return new Notice(onlyPath?'当前笔记尚未公开。请先补充发布属性并勾选 publish。':'没有可同步的公开笔记。');
      new SyncPreview(this.app,this,plan).open();
    }
    catch(error){new Notice(error.message,9000);console.error(error);}
  }
  async backup(relative,content) {
    if(content===undefined)return;
    const target=core.inside(this.backupRoot,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);
  }
  async writeVault(relative,text) {
    const current=this.app.vault.getAbstractFileByPath(relative);
    if(current){await this.app.vault.modify(current,text);return current;}
    const parts=relative.split('/');parts.pop();let folder='';
    for(const part of parts){folder=folder?folder+'/'+part:part;if(!this.app.vault.getAbstractFileByPath(folder))await this.app.vault.createFolder(folder);}
    return this.app.vault.create(relative,text);
  }
  writeWeb(root,relative,text) {
    const target=core.inside(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);
  }
  async synchronize({resolutions={},build=this.settings.buildAfterSync,onlyPath=null,expectedPlan=null}={}) {
    if(this.running||this.publishing)throw new Error('正在同步或发布。');
    this.running=true;
    const temporary=fs.mkdtempSync(path.join(require('os').tmpdir(),'website-note-sync-'));
    const oldState=JSON.parse(JSON.stringify(this.state));
    let committed=false;
    try {
      const plan=await this.plan({onlyPath});
      if(expectedPlan){
        const signature=p=>JSON.stringify({root:p.root,settings:p.settingsHash,items:p.items.map(i=>[i.id,i.action,i.vaultPath,i.webPath,i.v?.raw,i.w?.raw,i.assetSourceHash])});
        if(signature(plan)!==signature(expectedPlan))throw new Error('预览后笔记、附件或同步设置发生变化，请重新预览。');
      }
      const allowed=plan.mode==='vault-to-web'?['vault','skip']:plan.mode==='web-to-vault'?['web','skip']:['vault','web','skip'];
      for(const item of plan.items)if(item.action==='conflict'){
        const choice=resolutions[item.id];
        if(!choice)throw new Error('请先处理冲突：'+item.title);
        if(!(choice==='withdraw'&&!item.v&&item.w&&item.base&&plan.mode!=='web-to-vault')&&!allowed.includes(choice))throw new Error('冲突处理方式不符合当前同步方向。');
        if(choice==='vault'&&!item.v||choice==='web'&&!item.w)throw new Error('选择的版本不存在。');
      }
      const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+Math.random().toString(16).slice(2,6);
      const backupParent=core.inside(this.app.vault.adapter.basePath,this.manifest.dir+'/backups');
      this.backupRoot=core.inside(backupParent,stamp);
      const transaction=new Transaction({vault:this.app.vault.adapter.basePath,web:plan.root},this.backupRoot);
      const nextState={...this.state},active=[],routes=new Map();
      let withdrawn=0,imported=0,skipped=0;
      for(const item of plan.allItems){
        if(item.v?.doc.meta.publish===true||item.w?.doc.meta.publish===true)routes.set(item.vaultPath,website.route(this.settings,item.slug));
      }
      for(const item of plan.items){
        let action=item.action;
        if(action==='conflict')action=({web:'import',vault:'export',withdraw:'withdraw',skip:'skip'})[resolutions[item.id]];
        if(action==='skip'){skipped++;continue;}
        if(action==='equal'&&!nextState[item.id])nextState[item.id]={slug:item.slug,vaultPath:item.vaultPath,webPath:item.webPath,vaultHash:core.fingerprint(item.v?.doc),webHash:core.fingerprint(item.w?.doc),assets:[],assetSourceHash:item.assetSourceHash};
        if(action==='equal'&&!(this.settings.websiteType==='jekyll'&&this.settings.refreshBodyStyles&&plan.mode!=='web-to-vault'))continue;
        if(action==='withdraw'||action==='import'&&item.w.doc.meta.publish!==true&&plan.mode!=='web-to-vault'){
          if(item.w)transaction.add('web',item.w.relative,null);
          if(this.settings.websiteType==='jekyll')transaction.add('web','_includes/rendered-notes/'+item.slug+'.html',null);
          for(const asset of item.base?.assets||[])if(website.ownedAsset(asset))transaction.add('web',asset,null);
          if(action==='import')transaction.add('vault',item.vaultPath,serialize({meta:{...item.v?.doc.meta,...publicMeta(item.w.doc.meta)},body:item.w.doc.body}));
          delete nextState[item.id];routes.delete(item.vaultPath);withdrawn++;continue;
        }
        const incoming=action==='import'?item.w?.doc:item.v?.doc;
        if(!incoming)throw new Error('所选版本已不存在：'+item.title);
        const doc={meta:{...publicMeta(incoming.meta)},body:incoming.body};
        doc.meta.web_id=item.id;doc.meta.web_slug=item.slug;
        doc.meta.title||=item.title;doc.meta.date||=TODAY();doc.meta.updated||=doc.meta.date;
        doc.meta.domain||=core.inferDomain(doc,item.vaultPath);
        if(!Array.isArray(doc.meta.tags))doc.meta.tags=doc.meta.tags?[String(doc.meta.tags)]:[];
        if(action!=='equal'&&item.base&&!item.refreshOnly)doc.meta.updated=TODAY();
        const vaultDoc={meta:{...item.v?.doc.meta,...doc.meta},body:doc.body};
        for(const key of core.MANAGED)vaultDoc.meta[key]===undefined||delete vaultDoc.meta[key];
        transaction.add('vault',item.vaultPath,serialize(vaultDoc));
        if(plan.mode==='web-to-vault'){
          nextState[item.id]={...item.base,slug:item.slug,vaultPath:item.vaultPath,webPath:item.w.relative,vaultHash:core.fingerprint(vaultDoc),webHash:core.fingerprint(item.w.doc),assets:item.base?.assets||[]};
          imported++;continue;
        }
        // Render before committing Markdown writes. Failed embeds, missing
        // attachments or sanitization errors leave both repositories untouched.
        const file=item.v?.file||{path:item.vaultPath,basename:item.title};
        const rendered=await this.renderNote({...item,file,doc},temporary,routes);
        let webDoc;
        if(this.settings.websiteType==='markdown'){
          const host=document.createElement('div');host.innerHTML=rendered.html;
          webDoc={meta:website.publicMeta(doc.meta),body:[...host.childNodes].map(mediaContent.markdown).join('').trim()+'\n'};
        }else{
          const include='rendered-notes/'+item.slug+'.html';
          transaction.add('web','_includes/'+include,rendered.html);
          webDoc={meta:{...website.publicMeta(doc.meta),rendered_body:include,rendered_source_hash:core.hash(doc.body.replace(/\r\n/g,'\n')),mathjax:true,render_with_liquid:false},body:doc.body};
        }
        for(const asset of new Set(rendered.assets))transaction.add('web',asset,fs.readFileSync(core.inside(temporary,asset)));
        for(const asset of item.base?.assets||[])if(!rendered.assets.includes(asset)&&website.ownedAsset(asset))transaction.add('web',asset,null);
        transaction.add('web',item.webPath,serialize(webDoc));
        if(item.w&&item.w.relative!==item.webPath)transaction.add('web',item.w.relative,null);
        nextState[item.id]={slug:item.slug,vaultPath:item.vaultPath,webPath:item.webPath,vaultHash:core.fingerprint(vaultDoc),webHash:core.fingerprint(webDoc),assets:rendered.assets,assetSourceHash:item.assetSourceHash,routeHash:item.routeHash};
        active.push(item);
      }
      if(this.settings.websiteType==='jekyll'&&this.settings.refreshBodyStyles&&plan.mode!=='web-to-vault')transaction.add('web','assets/css/border.css',border.css(border.capture()));
      for(const item of plan.items){
        if(item.v&&await this.app.vault.read(item.v.file)!==item.v.raw)throw new Error('笔记正在修改，请重新预览：'+item.title);
        if(item.w&&fs.readFileSync(item.w.full,'utf8')!==item.w.raw)throw new Error('网站正在修改，请重新预览：'+item.title);
      }
      await transaction.commit(async(change,content)=>{
        if(change.side==='web')return atomicWrite(change.full,content);
        const current=this.app.vault.getAbstractFileByPath(change.relative);
        if(content===null){if(current)await this.app.vault.delete(current);}
        else await this.writeVault(change.relative,content.toString('utf8'));
      });
      committed=true;this.state=nextState;
      const webChanges=[...transaction.changes.values()].filter(change=>change.side==='web').map(change=>change.relative);
      this.data.publishPaths=Array.from(new Set([...(this.data.publishPaths||[]),...webChanges]));
      this.data.lastSync=new Date().toISOString();await this.save();
      prune(backupParent,this.settings.backupLimit);
      const shouldBuild=build&&plan.mode!=='web-to-vault';
      if(shouldBuild)await this.buildWebsite(plan.root);
      const result={mode:plan.mode,notes:active.length+imported,withdrawn,skipped,built:shouldBuild,backup:transaction.changes.size?this.backupRoot:null};
      new Notice('同步完成：'+result.notes+' 篇，撤下 '+withdrawn+' 篇；线上发布请单独预览推送。',8000);
      return result;
    }catch(error){if(!committed)this.state=oldState;else throw new Error('网站文件已经写入并保留备份 '+this.backupRoot+'，但后续保存或构建失败：'+error.message);throw error;}
    finally{this.running=false;fs.rmSync(temporary,{recursive:true,force:true});}
  }
  async renderNote(item,root,routes) {
    if(/^(?: {0,3})(?:`{3,}|~{3,})(?:dataview|dataviewjs|tasks)\b/im.test(item.doc.body))throw new Error('动态查询可能包含未公开笔记，请先转成静态内容：'+item.title);
    const protectedMath=render.protectMath(item.doc.body);
    // Note embeds become public links; private embeds never enter exported HTML.
    const source=protectedMath.source.replace(/!\[\[([^\]]+)\]\]/g,(match,target)=>{
      const link=target.split('|')[0].split('#')[0];
      const destination=this.app.metadataCache.getFirstLinkpathDest(link,item.file.path);
      if(destination?.extension==='md')return '[['+target+']]';
      return match;
    });
    const host=document.createElement('div');host.className='markdown-preview-view markdown-rendered';
    host.style.cssText='position:fixed;left:-20000px;top:0;width:750px;visibility:hidden;';
    document.body.append(host);const component=new Component();component.load();
    const assets=[];
    try {
      await MarkdownRenderer.render(this.app,source,host,item.file.path,component);
      // Renderers may use microtasks to attach image sources and link metadata.
      await new Promise(resolve=>setTimeout(resolve,30));
      // Restore formulas only in text nodes; injecting span HTML into data-heading
      // attributes corrupts headings containing inline formulas.
      for(const element of host.querySelectorAll('*'))for(const attr of [...element.attributes]) {
        let value=attr.value;
        for(const math of protectedMath.math)value=value.split(math.token).join(math.value);
        if(value!==attr.value)element.setAttribute(attr.name,value);
      }
      const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),textNodes=[];
      while(walker.nextNode())if(protectedMath.math.some(math=>walker.currentNode.nodeValue.includes(math.token)))textNodes.push(walker.currentNode);
      for(const text of textNodes) {
        const restored=document.createElement('span');
        restored.innerHTML=render.restoreMath(render.escapeHtml(text.nodeValue),protectedMath.math);
        text.replaceWith(...restored.childNodes);
      }
      const ids=new Set();
      host.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(heading=>{
        let id=render.headingId(heading.textContent);while(ids.has(id))id+='-';ids.add(id);heading.id=id;
      });
      host.querySelectorAll('.copy-code-button,.heading-collapse-indicator,.collapse-indicator,.metadata-container').forEach(node=>node.remove());
      for(const link of host.querySelectorAll('a')) {
        const href=link.getAttribute('data-href')||link.getAttribute('href')||'';
        if(/^(https?:|mailto:|tel:|#)/i.test(href))continue;
        const [filePart,fragment]=href.split('#');
        const destination=this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(filePart),item.file.path);
        if(destination?.extension==='md') {
          const route=routes.get(destination.path);
          if(route)link.setAttribute('href',route+(fragment?'#'+encodeURIComponent(render.headingId(fragment)):''));
          else {const plain=document.createElement('span');plain.className='unpublished-link';plain.textContent=link.textContent;link.replaceWith(plain);}
        } else if(destination) {
          const url=await this.copyAsset(destination.path,item,root,assets);link.setAttribute('href',url);
        } else if(/^(obsidian:|zotero:|app:|file:)/i.test(href)||!href.includes(':')) {
          const plain=document.createElement('span');plain.textContent=link.textContent;link.replaceWith(plain);
        }
      }
      for(const node of host.querySelectorAll('img,video,audio,source')) {
        const raw=node.getAttribute('src')||'';
        if(/^(https?:|data:)/i.test(raw))continue;
        const embed=node.closest('.internal-embed');
        let relative=embed?.getAttribute('src')?.split('|')[0]||raw;
        let destination=this.app.metadataCache.getFirstLinkpathDest(relative,item.file.path);
        if(!destination) {
          let decoded=decodeURIComponent(raw.split('?')[0]).replace(/^app:\/\/local\//,'').replace(/^file:\/\/\//,'');
          const vaultRoot=this.app.vault.adapter.basePath;
          if(path.isAbsolute(decoded)) {
            const local=path.relative(vaultRoot,decoded).replace(/\\/g,'/');
            if(!local.startsWith('../'))destination=this.app.vault.getAbstractFileByPath(local);
          }
        }
        if(destination&&destination.extension!=='md')node.setAttribute('src',await this.copyAsset(destination.path,item,root,assets));
        else if(raw.startsWith('/images/')&&fs.existsSync(core.inside(root,raw.slice(1))))continue;
        else throw new Error('图片或附件无法定位：'+relative+'（'+item.title+'）');
      }
      host.querySelectorAll('[data-href]').forEach(node=>node.removeAttribute('data-href'));
      host.querySelectorAll('.internal-embed').forEach(node=>{node.removeAttribute('src');node.removeAttribute('alt');});
      host.querySelectorAll('.markdown-embed,script,style,iframe,object,embed,form,input,button,textarea,select,link,meta').forEach(node=>node.remove());
      for(const node of host.querySelectorAll('*'))for(const attr of [...node.attributes]){
        if(/^on/i.test(attr.name)||['srcset','formaction','xlink:href'].includes(attr.name))node.removeAttribute(attr.name);
        else if(['href','src'].includes(attr.name)&&/^\s*(javascript|vbscript|file):/i.test(attr.value))node.removeAttribute(attr.name);
      }
      let html=host.innerHTML.replace(/\{\{/g,'&#123;{').replace(/\{%/g,'&#123;%');
      return {html,assets};
    } finally {component.unload();host.remove();}
  }
  async copyAsset(relative,item,root,assets) {
    if(relative.startsWith('.'))throw new Error('不会导出隐藏配置文件。');
    const absolute=core.inside(this.app.vault.adapter.basePath,relative);
    const bytes=fs.readFileSync(absolute),ext=path.extname(relative).toLowerCase();
    if(!['.png','.jpg','.jpeg','.gif','.svg','.webp','.avif','.pdf','.mp4','.webm','.mp3','.wav','.ogg'].includes(ext))throw new Error('暂不支持导出此附件类型：'+relative);
    const base=path.basename(relative,ext).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'attachment';
    const output='assets/notes/'+item.slug+'/'+core.hash(bytes).slice(0,10)+'-'+base+ext;
    const target=core.inside(root,output);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    assets.push(output);return (this.settings.basePath||'').replace(/\/$/,'')+'/'+output;
  }
  assetFingerprint(file){
    const cache=this.app.metadataCache.getFileCache(file)||{},entries=[];
    for(const reference of [...(cache.embeds||[]),...(cache.links||[])]){
      const destination=this.app.metadataCache.getFirstLinkpathDest(reference.link?.split('#')[0]||'',file.path);
      if(destination&&destination.extension!=='md'){
        const full=core.inside(this.app.vault.adapter.basePath,destination.path);
        if(fs.existsSync(full))entries.push([destination.path,core.hash(fs.readFileSync(full))]);
      }
    }
    return core.hash(JSON.stringify(entries.sort()));
  }
  async diagnose(){
    const modal=new Modal(this.app);modal.contentEl.createEl('h2',{text:'配置检查'});
    const report=[];
    try{report.push('网站：'+this.root());website.route(this.settings,'example');report.push('输出：'+website.folder(this.settings)+'；模式：'+this.settings.websiteType);}
    catch(error){report.push('网站未就绪：'+error.message);}
    report.push('同步：'+core.MODES[this.settings.syncMode]+'；默认只处理 publish: true。');
    report.push('Edge：'+(this.settings.edgeExecutable&&fs.existsSync(this.settings.edgeExecutable)?'已找到':'请在设置中选择 Edge 程序；仅媒体草稿需要'));
    if(this.settings.websitePath&&this.data.publishPaths?.length)try{const plan=await publisher.plan(this.root(),this.settings,this.data.publishPaths);report.push('Git：'+plan.branch+'；插件待发布 '+plan.files.length+' 个文件，其他 '+plan.excludedFiles.length+' 个改动保留在工作区。');}catch(error){report.push('Git 尚未就绪：'+error.message);}
    report.push('备份最多保留 '+this.settings.backupLimit+' 次；仅在手动同步成功后轮换。');
    for(const line of report)modal.contentEl.createEl('p',{text:line});
    modal.contentEl.createEl('a',{text:'打开安装与兼容性文档',href:'https://github.com/HonorLiu0613/obsidian-website-note-sync#readme'});
    modal.open();
  }
  async buildWebsite(root) {
    if(this.settings.websiteType!=='jekyll')throw new Error('Markdown 模式请使用网站自己的构建流程；关闭同步后构建和推送前构建。');
    const {spawn}=require('child_process');
    const ruby=this.settings.rubyExecutable;
    if(!ruby||!fs.existsSync(ruby))throw new Error('笔记已同步；请在插件设置中配置 Ruby，或在网站仓库手动构建。');
    const bundle=path.join(path.dirname(ruby),'bundle');
    const env={...process.env,BUNDLE_GEMFILE:path.join(root,'Gemfile'),BUNDLE_PATH:this.settings.bundlePath||path.join(root,'vendor/bundle'),
      BUNDLE_USER_HOME:path.join(this.app.vault.adapter.basePath,this.manifest.dir,'bundle-cache'),JEKYLL_ENV:'production',
      PATH:path.dirname(ruby)+path.delimiter+process.env.PATH};
    await new Promise((resolve,reject)=>{
      const child=spawn(ruby,[bundle,'exec','jekyll','build','--trace'],{cwd:root,env,windowsHide:true});let log='';
      child.stdout.on('data',data=>{log+=data;});child.stderr.on('data',data=>{log+=data;});
      child.on('error',reject);child.on('close',code=>{if(code===0)resolve();else{console.error(log);reject(new Error('笔记已同步，但网站构建失败；请查看开发者控制台。'));}});
    });
  }
};

class SyncCenter extends Modal {
  constructor(app,plugin){super(app);this.plugin=plugin;}
  onOpen(){
    const el=this.contentEl;el.createEl('h2',{text:'同步中心'});
    el.createEl('p',{text:'选择当前要执行的操作。所有动作都需要你在预览窗口确认；媒体平台只生成草稿，不会自动公开发布。'});
    new Setting(el).setName('同步公开笔记').setDesc('按当前同步模式预览并同步 Obsidian 与网站。').addButton(button=>button.setButtonText('打开').setCta().onClick(()=>{this.close();this.plugin.preview();}));
    new Setting(el).setName('推送网站').setDesc('预览网站仓库改动，提交并推送到 GitHub。').addButton(button=>button.setButtonText('打开').onClick(()=>{this.close();this.plugin.previewPush();}));
    new Setting(el).setName('生成媒体草稿').setDesc('将当前笔记发送到 CSDN 或知乎。').addButton(button=>button.setButtonText('选择平台').onClick(()=>{this.close();this.plugin.previewMedia();}));
    new Setting(el).setName('补充笔记属性').setDesc('为当前笔记补充 title、date、domain、tags 等发布字段。').addButton(button=>button.setButtonText('执行').onClick(()=>{this.close();this.plugin.prepareCurrentNote();}));
  }
  onClose(){this.contentEl.empty();}
}

class MediaPreview extends Modal {
  constructor(app,plugin,file,platforms){super(app);this.plugin=plugin;this.file=file;this.platforms=new Set(platforms||[]);}
  onOpen(){
    const el=this.contentEl;el.createEl('h2',{text:'发送到媒体草稿'});
    el.createEl('p',{text:this.file.basename});
    el.createEl('p',{text:'发送当前笔记的标题、正文和图片，无需 publish 属性，也不带网站分类。下一步在 Edge 检查登录和正文，再生成草稿；最终发布由你确认。'});
    for(const [type,name]of [['csdn','CSDN'],['zhihu','知乎']])new Setting(el).setName(name).addToggle(toggle=>toggle.setValue(this.platforms.has(type)).onChange(value=>{if(value)this.platforms.add(type);else this.platforms.delete(type);}));
    const history=(this.plugin.data.mediaHistory||[]).filter(item=>item.sourcePath===this.file.path);
    if(history.length){
      el.createEl('p',{text:'这篇笔记已有草稿记录。再次发送会新建草稿；修改已有草稿请打开下方编辑页。'});
      for(const item of history)new Setting(el).setName(({csdn:'CSDN',zhihu:'知乎'}[item.platform]||item.platform)+' · '+new Date(item.time).toLocaleString()).addButton(button=>button.setButtonText('打开已有草稿').onClick(async()=>{try{await media.openEdge(this.plugin.settings.edgeExecutable,item.url);}catch(error){new Notice(error.message);}}));
    }
    el.createEl('p',{text:'首次使用请在常用 Edge 中安装“文章同步助手”，并登录所选平台。CSDN 保留 LaTeX；知乎公式使用 Obsidian MathJax 渲染为图片。平台排版以草稿为准。'});
    const status=el.createEl('p');
    new Setting(el).addButton(button=>button.setButtonText('在 Edge 检查并发送').setCta().onClick(async()=>{
      button.setDisabled(true);status.textContent='正在准备正文和图片…';
      try{await this.plugin.sendMedia(this.file,[...this.platforms]);this.close();new Notice('已在 Edge 打开发送页面，请检查内容后生成草稿。',10000);}
      catch(error){status.textContent=error.message;button.setDisabled(false);console.error(error);}
    }));
  }
  onClose(){this.contentEl.empty();}
}

class SyncPreview extends Modal {
  constructor(app,plugin,plan){super(app);this.plugin=plugin;this.plan=plan;this.resolutions={};}
  onOpen(){
    this.contentEl.createEl('h2',{text:core.MODES[this.plan.mode]+(this.plan.onlyPath?' · 当前笔记':' · 公开笔记')});
    this.contentEl.createEl('p',{text:this.plan.mode==='web-to-vault'?'只导入到 Obsidian，不改写或构建网站。同步前会备份笔记。':'同步前会备份笔记；本地构建后仍需通过 Git 发布到线上。'});
    if(this.plan.mode!=='bidirectional'&&!this.plugin.settings.protectTargetChanges)this.contentEl.createEl('p',{text:'接收方修改保护已关闭：不同内容会以同步来源版本覆盖，覆盖前会备份。'});
    const labels={equal:'两边一致',import:'网站 → Obsidian',export:'Obsidian → 网站',withdraw:'从网站撤下',conflict:'存在不同版本，需要确认',skip:'本次方向不处理这一侧独有的笔记'};
    for(const item of this.plan.items){
      const setting=new Setting(this.contentEl).setName(item.title).setDesc(labels[item.action]+' · '+item.vaultPath+' ↔ '+item.webPath);
      const showBody=(label,doc)=>{
        if(!doc)return;
        const details=this.contentEl.createEl('details');details.createEl('summary',{text:label});
        const body=details.createEl('pre',{text:doc.body});body.style.cssText='max-height:18rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;';
      };
      if(item.action==='export')showBody('Obsidian 正文预览',item.v?.doc);
      if(item.action==='import')showBody('网站正文预览',item.w?.doc);
      if(item.action==='conflict'){
        showBody('Obsidian 版本',item.v?.doc);
        showBody('网站版本',item.w?.doc);
      }
      if(item.action==='conflict')setting.addDropdown(drop=>{
        const options={'':'请选择处理方式'};
        if(this.plan.mode!=='web-to-vault'&&item.v)options.vault='以 Obsidian 版本更新网站';
        if(this.plan.mode!=='vault-to-web'&&item.w)options.web=item.v?'以网站版本更新 Obsidian':'将网站版本恢复到 Obsidian';
        if(!item.v&&item.w&&item.base&&this.plan.mode!=='web-to-vault')options.withdraw='从网站撤下这篇已删除的笔记';
        options.skip='暂时跳过';
        drop.addOptions(options).onChange(value=>{this.resolutions[item.id]=value;});
      });
    }
    const buttonText=this.plan.mode==='web-to-vault'?'导入到 Obsidian':this.plugin.settings.buildAfterSync?'同步并构建本地网站':'同步笔记';
    new Setting(this.contentEl).addButton(button=>button.setButtonText(buttonText).setCta().onClick(async()=>{
      button.setDisabled(true);
      try{
        await this.plugin.synchronize({resolutions:this.resolutions,onlyPath:this.plan.onlyPath,expectedPlan:this.plan});this.close();
        if(this.plan.mode!=='web-to-vault'&&this.plugin.settings.openPushAfterSync)await this.plugin.previewPush();
      }
      catch(error){new Notice(error.message,10000);console.error(error);button.setDisabled(false);}
    }));
  }
  onClose(){this.contentEl.empty();}
}
class PushPreview extends Modal {
  constructor(app,plugin,plan){super(app);this.plugin=plugin;this.plan=plan;this.message=plugin.settings.commitMessage;}
  onOpen(){
    this.contentEl.createEl('h2',{text:'发布网站到 GitHub'});
    this.contentEl.createEl('p',{text:'目标：'+this.plan.remote+' / '+this.plan.branch+' · '+publisher.redact(this.plan.remoteURL)});
    this.contentEl.createEl('p',{text:'只提交本插件生成的笔记、附件和正文样式。范围外文件会保留在工作区；已有暂存改动、未推送提交或远程领先提交会阻止发布。'});
    if(this.plan.ahead!==null)this.contentEl.createEl('p',{text:'待推送本地提交：'+this.plan.ahead+'；本地记录的远程领先提交：'+this.plan.behind+'。'});
    const blocked=this.plan.indexStatus.length>0||this.plan.ahead>0||this.plan.behind>0||this.plan.files.length===0;
    if(this.plan.indexStatus.length)this.contentEl.createEl('p',{text:'暂存区已有改动。请先通过常规 Git 流程处理，再重新预览。'});
    if(this.plan.ahead>0)this.contentEl.createEl('p',{text:'当前分支有未推送提交。为避免意外发布其他工作，插件不会推送它们。'});
    if(this.plan.behind>0)this.contentEl.createEl('p',{text:'远程分支有尚未合入的提交。请先拉取并解决差异，再重新预览。'});
    if(this.plan.files.length){
      const list=this.contentEl.createEl('pre');list.style.cssText='max-height:280px;overflow:auto;white-space:pre-wrap;font-size:12px;';
      list.textContent=this.plan.files.map(file=>file.status+'  '+file.path).join('\n');
      new Setting(this.contentEl).setName('提交说明').addText(text=>text.setValue(this.message).onChange(value=>{this.message=value;}));
    }else this.contentEl.createEl('p',{text:'没有插件范围内的新文件可提交。'});
    if(this.plan.excludedFiles?.length)this.contentEl.createEl('p',{text:'范围外 '+this.plan.excludedFiles.length+' 个文件将保留在工作区。网站导航、布局等修改请使用常规 Git 流程发布。'});
    const progress=this.contentEl.createEl('p');
    new Setting(this.contentEl).addButton(button=>button.setButtonText(this.plan.files.length?'提交并推送':'无可发布改动').setDisabled(blocked).setCta().onClick(async()=>{
      button.setDisabled(true);progress.textContent=this.plugin.settings.buildBeforePush?'正在构建、提交并推送…':'正在提交并推送…';
      try{
        const result=await this.plugin.pushWebsite(this.plan,this.message);
        if(result.unchanged){progress.textContent='没有新版本可发布。';button.setButtonText('没有新版本');return;}
        progress.textContent='推送成功：'+result.commit.slice(0,7)+'。线上更新还需等待 GitHub Actions 部署完成。';
        button.setButtonText('已推送');
      }catch(error){progress.textContent=error.message;new Notice(error.message,15000);console.error(error);button.setButtonText('关闭后重新预览');}
    })).addButton(button=>button.setButtonText('关闭').onClick(()=>this.close()));
  }
  onClose(){this.contentEl.empty();}
}
class PendingPublication extends Modal {
  constructor(app,plugin,items){super(app);this.plugin=plugin;this.items=items;}
  onOpen(){
    this.contentEl.createEl('h2',{text:'先同步笔记，再发布网站'});
    this.contentEl.createEl('p',{text:'检测到 '+this.items.length+' 篇笔记尚未同步。直接推送网站仓库不会包含这些 Obsidian 修改。'});
    const labels={export:'待导出',import:'待导入',withdraw:'待从网站撤下',conflict:'需要处理版本冲突'};
    for(const item of this.items)new Setting(this.contentEl).setName(item.title).setDesc((labels[item.action]||item.action)+' · '+item.vaultPath);
    new Setting(this.contentEl).addButton(button=>button.setButtonText('先预览同步').setCta().onClick(()=>{this.close();this.plugin.preview();}))
      .addButton(button=>button.setButtonText('关闭').onClick(()=>this.close()));
  }
  onClose(){this.contentEl.empty();}
}
class SyncSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    this.containerEl.empty();this.containerEl.createEl('h2',{text:'个人网站笔记同步'});
    this.containerEl.createEl('p',{text:'先选择网站模式和输出目录，再运行配置检查。CSDN/知乎草稿不需要配置网站。当前界面为中文，安装文档提供中英文。'});
    new Setting(this.containerEl).setName('网站模式').setDesc('Jekyll 可导出正文 HTML 和当前主题样式；Markdown 模式只导出可移植内容，由你的网站负责排版。').addDropdown(drop=>drop.addOptions({jekyll:'Jekyll 正文导出',markdown:'通用 Markdown 同步'}).setValue(this.plugin.settings.websiteType).onChange(async value=>{this.plugin.settings.websiteType=value;await this.plugin.save();this.display();}));
    for(const [key,label,desc] of [['contentFolder','网站笔记目录','相对于网站根目录，例如 _notes、content/notes 或 src/content/notes；先手动创建。'],['publicPath','笔记网址路径','例如 /notes/；链接格式为该路径 + web_slug + /。'],['basePath','网站子路径','GitHub 项目站点例如 /my-site；独立域名和用户站点留空。']])new Setting(this.containerEl).setName(label).setDesc(desc).addText(text=>text.setValue(this.plugin.settings[key]).onChange(async value=>{this.plugin.settings[key]=value.trim();await this.plugin.save();}));
    new Setting(this.containerEl).setName('排除的笔记目录').setDesc('每行一个相对目录。隐藏配置目录始终排除。').addTextArea(text=>text.setValue(this.plugin.settings.excludedFolders).onChange(async value=>{this.plugin.settings.excludedFolders=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('保留同步备份次数').setDesc('默认 10 次；保存成功后轮换旧备份。同步失败时保留恢复清单。').addDropdown(drop=>drop.addOptions({'5':'5','10':'10','20':'20','50':'50','100':'100'}).setValue(String(this.plugin.settings.backupLimit)).onChange(async value=>{this.plugin.settings.backupLimit=Number(value);await this.plugin.save();}));
    new Setting(this.containerEl).setName('检查配置').setDesc('检查路径、模式、Git 和 Edge，不同步或上传文章。').addButton(button=>button.setButtonText('运行检查').onClick(()=>this.plugin.diagnose()));
    new Setting(this.containerEl).setName('同步模式').setDesc('Obsidian 是主要写作入口时，推荐 Obsidian → 网站。模式只在手动点击同步时生效。').addDropdown(drop=>drop.addOptions(core.MODES).setValue(this.plugin.settings.syncMode).onChange(async value=>{this.plugin.settings.syncMode=value;await this.plugin.save();this.display();}));
    const descriptions={bidirectional:'比较上次同步记录：单边修改传到另一边，两边不同修改需选择版本。','vault-to-web':'仅将公开笔记及撤下状态传到网站；网站独有笔记会跳过。','web-to-vault':'仅将本地网站笔记导入 Obsidian；不会改写、渲染或构建网站，也不按网站文件的缺失删除笔记。'};
    this.containerEl.createEl('p',{text:descriptions[this.plugin.settings.syncMode]});
    if(this.plugin.settings.syncMode!=='bidirectional')new Setting(this.containerEl).setName('保护接收方的独立修改').setDesc('开启：接收方有不同修改时先确认。关闭：按来源版本覆盖，仍保留 Markdown 备份。').addToggle(toggle=>toggle.setValue(this.plugin.settings.protectTargetChanges).onChange(async value=>{this.plugin.settings.protectTargetChanges=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('网站仓库目录').setDesc('网站源文件所在的本地根目录；Jekyll 模式另需 _config.yml。').addText(text=>text.setValue(this.plugin.settings.websitePath).onChange(async value=>{this.plugin.settings.websitePath=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('未匹配分类的导入目录').setDesc('仅用于网站新笔记首次导入；不会移动已有笔记。默认 Website Imports；不再按关键词移动到作者的个人目录。离开输入框时保存。').addText(text=>{
      text.setValue(this.plugin.settings.importFolder);
      text.inputEl.addEventListener('change',async()=>{
        try{this.plugin.settings.importFolder=core.safeFolder(text.getValue());await this.plugin.save();}
        catch(error){text.setValue(this.plugin.settings.importFolder);new Notice(error.message);}
      });
    });
    if(this.plugin.settings.syncMode!=='web-to-vault')new Setting(this.containerEl).setName('同步时刷新正文样式').setDesc('从当前 Obsidian 主题和 Style Settings 更新网站正文 CSS。关闭时保留网站已有正文 CSS。').addToggle(toggle=>toggle.setValue(this.plugin.settings.refreshBodyStyles).onChange(async value=>{this.plugin.settings.refreshBodyStyles=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('Ruby 程序路径').setDesc('用于同步后构建网站；不会自动安装软件。').addText(text=>text.setValue(this.plugin.settings.rubyExecutable).onChange(async value=>{this.plugin.settings.rubyExecutable=value;await this.plugin.save();}));
    if(this.plugin.settings.syncMode!=='web-to-vault')new Setting(this.containerEl).setName('同步后构建本地网站').setDesc('只生成本地预览，不会执行 Git 提交或推送。').addToggle(toggle=>toggle.setValue(this.plugin.settings.buildAfterSync).onChange(async value=>{this.plugin.settings.buildAfterSync=value;await this.plugin.save();}));
    this.containerEl.createEl('h3',{text:'GitHub 发布'});
    new Setting(this.containerEl).setName('同步后打开推送预览').setDesc('同步成功后展示网站文件改动，点击“提交并推送”才发布。仅导入模式不会打开。').addToggle(toggle=>toggle.setValue(this.plugin.settings.openPushAfterSync).onChange(async value=>{this.plugin.settings.openPushAfterSync=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('推送前构建检查').setDesc('先构建网站；正文过期或构建失败时停止发布。').addToggle(toggle=>toggle.setValue(this.plugin.settings.buildBeforePush).onChange(async value=>{this.plugin.settings.buildBeforePush=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('Git 程序路径').setDesc('使用本机 Git 已有的 SSH 密钥或凭据管理器，不在插件中保存令牌。').addText(text=>text.setValue(this.plugin.settings.gitExecutable).onChange(async value=>{this.plugin.settings.gitExecutable=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('Git 远程名称').setDesc('默认 origin，推送当前所在分支。').addText(text=>text.setValue(this.plugin.settings.gitRemote).onChange(async value=>{this.plugin.settings.gitRemote=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('默认提交说明').addText(text=>text.setValue(this.plugin.settings.commitMessage).onChange(async value=>{this.plugin.settings.commitMessage=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('手动发布网站').setDesc('点击左侧同步中心选择推送；使用本机 Git 登录。').addButton(button=>button.setButtonText('预览改动并推送').onClick(()=>this.plugin.previewPush()));
    this.containerEl.createEl('h3',{text:'媒体平台草稿'});
    this.containerEl.createEl('p',{text:'通过 Edge 的“文章同步助手”扩展保存草稿；只发送当前笔记，不依赖网站同步方向或公开属性。登录状态保存在 Edge，不会写入 Obsidian 配置。公开发布请在平台编辑页确认。'});
    const install=this.containerEl.createEl('a',{text:'安装 / 更新文章同步助手',href:'https://wechatsync.com/#install'});install.target='_blank';install.rel='noopener noreferrer';
    new Setting(this.containerEl).setName('Microsoft Edge 程序路径').setDesc('使用平时登录平台的 Edge 个人资料。插件不读取或保存密码、Cookie。').addText(text=>text.setValue(this.plugin.settings.edgeExecutable).onChange(async value=>{this.plugin.settings.edgeExecutable=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('个人网站公开网址').setDesc('可留空；留空时媒体正文的站内链接转为纯文字。填写 https://example.com 可保留公开笔记链接。').addText(text=>text.setValue(this.plugin.settings.mediaWebsiteUrl).onChange(async value=>{this.plugin.settings.mediaWebsiteUrl=value;await this.plugin.save();}));
    for(const [type,name]of Object.entries(MEDIA_PLATFORMS))new Setting(this.containerEl).setName('默认选择 '+name).addToggle(toggle=>toggle.setValue(this.plugin.settings.mediaPlatforms.includes(type)).onChange(async value=>{const selected=new Set(this.plugin.settings.mediaPlatforms);if(value)selected.add(type);else selected.delete(type);if(!selected.size){new Notice('至少保留一个媒体平台。');toggle.setValue(true);return;}this.plugin.settings.mediaPlatforms=[...selected];await this.plugin.save();}));
    new Setting(this.containerEl).setName('保存草稿后打开编辑页').setDesc('Edge 拦截弹出窗口时，点击结果中的“打开编辑页并确认发布”。').addToggle(toggle=>toggle.setValue(this.plugin.settings.mediaAutoOpen).onChange(async value=>{this.plugin.settings.mediaAutoOpen=value;await this.plugin.save();}));
    new Setting(this.containerEl).setName('发送当前笔记').setDesc('点击左侧同步中心，选择生成媒体草稿；与网站同步独立。').addButton(button=>button.setButtonText('选择平台并预览').onClick(()=>this.plugin.previewMedia()));
    this.containerEl.createEl('h3',{text:'新文章与笔记属性'});
    this.containerEl.createEl('p',{text:'在新笔记运行 Templater: Open Insert Template modal，选择 website-note；或使用下方按钮给当前笔记补充属性。写好后勾选 publish，设置 domain 和 tags，再预览同步。'});
    new Setting(this.containerEl).setName('当前笔记发布属性').setDesc('只补充缺失字段，不会将草稿自动公开。').addButton(button=>button.setButtonText('补充属性').onClick(()=>this.plugin.prepareCurrentNote()));
    this.containerEl.createEl('p',{text:'最近同步：'+(this.plugin.data.lastSync?new Date(this.plugin.data.lastSync).toLocaleString():'尚未同步')+'。备份位于插件 backups 文件夹。'});
    if(this.plugin.data.lastPush)this.containerEl.createEl('p',{text:'最近推送：'+new Date(this.plugin.data.lastPush.time).toLocaleString()+' · '+this.plugin.data.lastPush.commit.slice(0,7)});
  }
}
