const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp' };
let ytPromise = null;

function sendJson(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function clean(v){return String(v||'').trim();}
function text(v){
  if(v==null)return null;
  if(typeof v==='string'||typeof v==='number')return String(v);
  if(typeof v?.toString==='function'){
    try{const s=v.toString();if(s&&s!=='[object Object]')return s;}catch{}
  }
  if(v.text)return String(v.text);
  if(v.content)return String(v.content);
  if(v.simpleText)return String(v.simpleText);
  if(Array.isArray(v.runs))return v.runs.map(x=>x.text||'').join('');
  return null;
}
function imageUrl(v){
  if(!v)return null;
  if(typeof v==='string')return v;
  if(typeof v.url==='string')return v.url;
  if(typeof v.image?.url==='string')return v.image.url;
  if(Array.isArray(v.sources)&&v.sources.length)return v.sources[v.sources.length-1]?.url||null;
  if(Array.isArray(v.image?.sources)&&v.image.sources.length)return v.image.sources[v.image.sources.length-1]?.url||null;
  if(Array.isArray(v.thumbnails)&&v.thumbnails.length)return imageUrl(v.thumbnails[v.thumbnails.length-1]);
  if(Array.isArray(v)&&v.length)return imageUrl(v[v.length-1]);
  return null;
}
function num(v){
  if(v==null)return null;
  if(typeof v==='number'&&Number.isFinite(v))return Math.round(v);
  const s=String(v).replace(/,/g,'');
  const m=s.match(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/i);
  if(!m)return null;
  const n=parseFloat(m[1]);const u=(m[2]||'').toUpperCase();
  return Math.round(n*(u==='B'?1e9:u==='M'?1e6:u==='K'?1e3:1));
}
function findByKey(obj,pattern,maxDepth=10){
  const seen=new WeakSet();let found=null;
  function walk(x,d){
    if(found!==null||x==null||d>maxDepth||typeof x!=='object')return;
    if(seen.has(x))return;seen.add(x);
    for(const [k,v] of Object.entries(x)){
      if(pattern.test(k)&&v!=null){found=v;return;}
      walk(v,d+1);if(found!==null)return;
    }
  }
  walk(obj,0);return found;
}
function normaliseInput(raw){
  const value=clean(raw);
  if(/^UC[A-Za-z0-9_-]{20,}$/.test(value))return {channelId:value,query:value};
  try{
    const u=new URL(value.match(/^https?:\/\//)?value:`https://${value}`);
    if(/(^|\.)youtube\.com$/i.test(u.hostname)){
      const p=u.pathname.split('/').filter(Boolean);
      if(p[0]==='channel'&&p[1])return {channelId:p[1],query:p[1]};
      if(p[0]?.startsWith('@'))return {query:p[0]};
      if((p[0]==='user'||p[0]==='c')&&p[1])return {query:p[1]};
    }
  }catch{}
  return {query:value};
}

async function getYT(){
  if(!ytPromise){
    ytPromise=import('youtubei.js').then(({Innertube,UniversalCache})=>Innertube.create({cache:new UniversalCache(true),generate_session_locally:true})).catch(e=>{ytPromise=null;throw e;});
  }
  return ytPromise;
}
function scoreNode(node,q){
  const vals=[text(node?.author?.name),text(node?.author),text(node?.title),node?.id,node?.author?.id].filter(Boolean).map(x=>x.toLowerCase().replace(/^@/,''));
  let s=0;for(const v of vals){if(v===q)s+=20;else if(v.startsWith(q))s+=8;else if(v.includes(q))s+=3;}return s;
}
async function resolveChannel(yt,input){
  const parsed=normaliseInput(input);
  if(parsed.channelId)return {channel:await yt.getChannel(parsed.channelId),searchNode:null};
  const search=await yt.search(parsed.query,{type:'channel'});
  const channels=Array.from(search.channels||[]);
  if(!channels.length)throw Object.assign(new Error('YouTube channel not found.'),{status:404});
  const q=parsed.query.toLowerCase().replace(/^@/,'');
  const node=[...channels].sort((a,b)=>scoreNode(b,q)-scoreNode(a,q))[0];
  const id=node?.id||node?.author?.id||findByKey(node,/^browse_id$|^browseId$|^channel_id$/i);
  if(!id)throw Object.assign(new Error('Channel found, but its YouTube channel ID was not returned.'),{status:502});
  return {channel:await yt.getChannel(String(id)),searchNode:node};
}

function parseAbout(about){
  if(!about)return {};
  const m=about.metadata||about;
  const viewText=text(m.view_count);
  const subText=text(m.subscriber_count);
  const videoText=text(m.video_count);
  const joined=text(m.joined_date);
  const avatar=imageUrl(m.avatar);
  return {
    channelId:m.channel_id||m.id||null,
    name:text(m.name)||null,
    avatar,
    canonicalUrl:m.canonical_channel_url||null,
    description:typeof m.description==='string'?m.description:text(m.description),
    subscribers:num(subText),
    subscriberText:subText,
    totalViews:num(viewText),
    totalViewsText:viewText,
    videoCount:num(videoText),
    videoCountText:videoText,
    createdAt:joined?joined.replace(/^Joined\s+/i,''):null,
    country:typeof m.country==='string'?m.country:text(m.country)
  };
}
function parseVideoNode(v){
  const id=v?.id||v?.video_id||findByKey(v,/^video_id$|^videoId$/i);
  const title=text(v?.title)||text(v?.headline)||'Untitled';
  const viewsText=text(v?.view_count)||text(v?.short_view_count)||text(findByKey(v,/view.*count/i));
  const published=text(v?.published)||text(v?.published_time)||text(findByKey(v,/published.*time|published/i));
  const duration=text(v?.duration)||text(v?.length_text)||text(findByKey(v,/duration|length.*text/i));
  const thumbnail=imageUrl(v?.thumbnails)||imageUrl(v?.thumbnail)||imageUrl(findByKey(v,/thumbnail/i));
  const liveNow=Boolean(v?.is_live||v?.is_live_content||v?.badges?.some?.(b=>/live/i.test(text(b))));
  return {videoId:id||null,title,views:num(viewsText),viewsText:viewsText||null,published:published||null,duration:duration||null,thumbnail,liveNow,url:id?`https://www.youtube.com/watch?v=${id}`:'#'};
}
async function getRecentVideos(channel){
  try{
    if(!channel.has_videos)return[];
    const feed=await channel.getVideos();
    return Array.from(feed.videos||[]).slice(0,12).map(parseVideoNode).filter(v=>v.videoId);
  }catch(e){console.log('[BiisViews] recent videos warning:',e.message);return[];}
}
async function getLive(channel){
  try{
    if(!channel.has_live_streams)return null;
    const feed=await channel.getLiveStreams();
    const nodes=Array.from(feed.videos||[]).slice(0,20);
    for(const node of nodes){
      const parsed=parseVideoNode(node);
      const rawStrings=[text(node?.view_count),text(node?.short_view_count),text(node?.published),text(node?.badges),text(findByKey(node,/view.*count/i))].filter(Boolean).join(' ');
      const liveNow=parsed.liveNow||/watching|live now/i.test(rawStrings);
      if(liveNow){
        return {isLive:true,viewers:parsed.views,title:parsed.title,category:null,language:null,startedAt:null,streamId:parsed.videoId,thumbnail:parsed.thumbnail,liveLikes:null,liveUrl:parsed.url};
      }
    }
  }catch(e){console.log('[BiisViews] live warning:',e.message);}
  return null;
}
function headerStats(channel,searchNode){
  const header=channel.header||{};
  const content=header?.content||{};
  const headerBlob={header,content,searchNode};
  const subscriberText=text(searchNode?.subscriber_count)||text(findByKey(headerBlob,/subscriber.*count/i));
  const videoCountText=text(searchNode?.video_count)||text(findByKey(headerBlob,/video.*count/i));
  return {
    subscriberText,
    subscribers:num(subscriberText),
    videoCountText,
    videoCount:num(videoCountText),
    avatar:imageUrl(content?.image)||imageUrl(findByKey(headerBlob,/avatar|image/i)),
    banner:imageUrl(content?.banner)||imageUrl(content?.hero_image)||imageUrl(findByKey(headerBlob,/banner|hero.*image/i))
  };
}
async function buildChannel(query){
  const yt=await getYT();
  const {channel,searchNode}=await resolveChannel(yt,query);
  const md=channel.metadata||{};
  const hs=headerStats(channel,searchNode);
  let about={};
  try{about=parseAbout(await channel.getAbout());}catch(e){console.log('[BiisViews] about warning:',e.message);}
  const recentVideos=await getRecentVideos(channel);
  const live=await getLive(channel);
  const customUrl=md.vanity_channel_url?String(md.vanity_channel_url).replace(/^https?:\/\/(www\.)?youtube\.com\//i,''):null;
  const channelId=about.channelId||md.external_id||searchNode?.id||searchNode?.author?.id||null;
  const views=recentVideos.map(v=>v.views).filter(Number.isFinite);
  const recentViewsTotal=views.length?views.reduce((a,b)=>a+b,0):null;
  const topRecentVideo=views.length?[...recentVideos].filter(v=>Number.isFinite(v.views)).sort((a,b)=>b.views-a.views)[0]:null;
  const subscribers=about.subscribers??hs.subscribers;
  const fallbackVideoCount=recentVideos.length||null;
  const result={
    platform:'YouTube',
    channelId,
    username:customUrl||md.title||about.name||query,
    displayName:md.title||about.name||text(searchNode?.author?.name)||text(searchNode?.title)||query,
    customUrl,
    profilePicture:about.avatar||imageUrl(md.avatar)||hs.avatar||imageUrl(searchNode?.author?.thumbnails)||imageUrl(searchNode?.thumbnail),
    banner:hs.banner||null,
    bio:md.description||about.description||null,
    subscribers,
    subscriberText:about.subscriberText||hs.subscriberText||null,
    hiddenSubscribers:subscribers==null,
    totalViews:about.totalViews??null,
    totalViewsText:about.totalViewsText||null,
    videoCount:(about.videoCount??hs.videoCount??fallbackVideoCount),
    videoCountText:about.videoCountText||hs.videoCountText||null,
    country:about.country??null,
    createdAt:about.createdAt??null,
    privacyStatus:md.is_unlisted?'unlisted':'public',
    url:about.canonicalUrl||md.url||md.vanity_channel_url||(channelId?`https://www.youtube.com/channel/${channelId}`:null),
    isLive:Boolean(live),
    viewers:live?.viewers??null,
    title:live?.title??null,
    category:live?.category??null,
    language:live?.language??null,
    startedAt:live?.startedAt??null,
    streamId:live?.streamId??null,
    thumbnail:live?.thumbnail??null,
    liveLikes:live?.liveLikes??null,
    liveUrl:live?.liveUrl??null,
    recentVideos,
    recentVideoCount:recentVideos.length,
    recentViewsTotal,
    recentAverageViews:views.length?Math.round(recentViewsTotal/views.length):null,
    topRecentVideo
  };
  console.log('[BiisViews] resolved:',JSON.stringify({query,channelId:result.channelId,name:result.displayName,pfp:!!result.profilePicture,subs:result.subscribers,views:result.totalViews,videos:result.videoCount,recent:result.recentVideoCount,isLive:result.isLive}));
  return result;
}

async function handleApi(req,res,url){
  if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});
  const query=clean(url.searchParams.get('channel')||url.searchParams.get('slug'));
  if(!query)return sendJson(res,400,{error:'Enter a YouTube channel name, @handle, channel ID or URL.'});
  try{
    const channel=await buildChannel(query);
    return sendJson(res,200,{ok:true,source:'youtubejs-innertube-keyless',fetchedAt:new Date().toISOString(),query,channel,raw:{source:'YouTube.js / Innertube',resolvedChannelId:channel.channelId,searchQuery:query,fieldStatus:{profilePicture:!!channel.profilePicture,subscribers:channel.subscribers!=null,totalViews:channel.totalViews!=null,videoCount:channel.videoCount!=null,recentVideos:channel.recentVideos.length,live:channel.isLive}}});
  }catch(error){console.error('[BiisViews] lookup error:',error);return sendJson(res,error.status||502,{ok:false,error:error.message||'Unable to fetch YouTube channel.'});}
}
function serveStatic(res,pathname){let relative=pathname==='/'?'/index.html':pathname;let filePath=path.normalize(path.join(PUBLIC_DIR,relative));if(!filePath.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden');}fs.stat(filePath,(err,stat)=>{if(err||!stat.isFile())filePath=path.join(PUBLIC_DIR,'index.html');fs.readFile(filePath,(readErr,content)=>{if(readErr){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':path.basename(filePath)==='index.html'?'no-cache':'public, max-age=3600'});res.end(content);});});}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/channel')return handleApi(req,res,url);serveStatic(res,decodeURIComponent(url.pathname));});
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`BiisViews YouTube.js server running on http://localhost:${PORT}`);
  setTimeout(()=>buildChannel('@YouTube').then(c=>console.log('[BiisViews] startup self-test OK:',JSON.stringify({pfp:!!c.profilePicture,subs:c.subscribers,views:c.totalViews,videos:c.videoCount}))).catch(e=>console.log('[BiisViews] startup self-test failed:',e.message)),1500);
});