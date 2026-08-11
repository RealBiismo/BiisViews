const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp' };

function sendJson(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function first(...v){return v.find(x=>x!==undefined&&x!==null&&x!=='');}
function cleanInput(value){return String(value||'').trim();}
function bestThumb(t){return t?.maxres?.url||t?.standard?.url||t?.high?.url||t?.medium?.url||t?.default?.url||null;}

async function yt(endpoint, params={}){
  const u = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null&&v!=='') u.searchParams.set(k,String(v));
  u.searchParams.set('key',YOUTUBE_API_KEY);
  const r = await fetch(u,{headers:{Accept:'application/json'}});
  const text = await r.text();
  let data=null; try{data=JSON.parse(text);}catch{}
  if(!r.ok){const message=data?.error?.message||`YouTube returned HTTP ${r.status}`;const e=new Error(message);e.status=r.status;e.details=data||text.slice(0,500);throw e;}
  return data;
}

function parseIdentifier(value){
  const raw=cleanInput(value);
  try{
    const u=new URL(raw.match(/^https?:\/\//i)?raw:`https://${raw}`);
    if(/(^|\.)youtube\.com$/i.test(u.hostname)||/(^|\.)youtu\.be$/i.test(u.hostname)){
      const parts=u.pathname.split('/').filter(Boolean);
      if(parts[0]==='channel'&&parts[1]) return {type:'id',value:parts[1]};
      if(parts[0]?.startsWith('@')) return {type:'handle',value:parts[0]};
      if(parts[0]==='user'&&parts[1]) return {type:'username',value:parts[1]};
      if(parts[0]==='c'&&parts[1]) return {type:'query',value:parts[1]};
    }
  }catch{}
  if(/^UC[A-Za-z0-9_-]{20,}$/.test(raw)) return {type:'id',value:raw};
  if(raw.startsWith('@')) return {type:'handle',value:raw};
  return {type:'handle-or-query',value:raw};
}

async function getChannelBy(filterKey,filterValue){
  const data=await yt('channels',{part:'snippet,statistics,brandingSettings,status', [filterKey]:filterValue, maxResults:1});
  return data.items?.[0]||null;
}

async function resolveChannel(input){
  const id=parseIdentifier(input);
  if(id.type==='id') return getChannelBy('id',id.value);
  if(id.type==='username') return getChannelBy('forUsername',id.value);
  if(id.type==='handle') return getChannelBy('forHandle',id.value);
  if(id.type==='handle-or-query'){
    const direct=await getChannelBy('forHandle',id.value).catch(()=>null);
    if(direct) return direct;
  }
  const q=id.value;
  const search=await yt('search',{part:'snippet',type:'channel',q,maxResults:1});
  const channelId=search.items?.[0]?.snippet?.channelId||search.items?.[0]?.id?.channelId;
  if(!channelId) return null;
  return getChannelBy('id',channelId);
}

async function getLiveVideo(channelId){
  const search=await yt('search',{part:'snippet',channelId,eventType:'live',type:'video',maxResults:5,order:'date'});
  const videoId=search.items?.[0]?.id?.videoId;
  if(!videoId) return null;
  const videos=await yt('videos',{part:'snippet,liveStreamingDetails,statistics,status',id:videoId});
  return videos.items?.[0]||null;
}

async function getCategory(categoryId){
  if(!categoryId) return null;
  const data=await yt('videoCategories',{part:'snippet',id:categoryId});
  return data.items?.[0]?.snippet?.title||null;
}

function normalizeChannel(channel,live,category){
  const s=channel.snippet||{};
  const stats=channel.statistics||{};
  const branding=channel.brandingSettings?.channel||{};
  const ls=live?.snippet||{};
  const ld=live?.liveStreamingDetails||{};
  const vs=live?.statistics||{};
  const custom=first(s.customUrl,branding.unsubscribedTrailer);
  const handle=s.customUrl||null;
  return {
    platform:'YouTube',
    channelId:channel.id,
    username:first(handle,s.title,channel.id),
    displayName:s.title||channel.id,
    customUrl:s.customUrl||null,
    profilePicture:bestThumb(s.thumbnails),
    bio:s.description||null,
    country:first(s.country,branding.country)||null,
    createdAt:s.publishedAt||null,
    subscribers:stats.hiddenSubscriberCount?null:stats.subscriberCount??null,
    hiddenSubscribers:Boolean(stats.hiddenSubscriberCount),
    totalViews:stats.viewCount??null,
    videoCount:stats.videoCount??null,
    isLive:Boolean(live),
    viewers:ld.concurrentViewers??null,
    title:ls.title||null,
    category:category||null,
    categoryId:ls.categoryId||null,
    language:first(ls.defaultAudioLanguage,ls.defaultLanguage,s.defaultLanguage)||null,
    startedAt:first(ld.actualStartTime,ld.scheduledStartTime)||null,
    scheduledStartAt:ld.scheduledStartTime||null,
    streamId:live?.id||null,
    thumbnail:bestThumb(ls.thumbnails),
    liveLikes:vs.likeCount??null,
    liveComments:vs.commentCount??null,
    privacyStatus:channel.status?.privacyStatus||null,
    madeForKids:first(channel.status?.madeForKids,channel.status?.selfDeclaredMadeForKids),
    url:`https://www.youtube.com/channel/${channel.id}`,
    liveUrl:live?.id?`https://www.youtube.com/watch?v=${live.id}`:null
  };
}

async function handleApi(req,res,url){
  if(req.method!=='GET') return sendJson(res,405,{error:'Method not allowed'});
  if(!YOUTUBE_API_KEY) return sendJson(res,503,{ok:false,error:'BiisViews needs a YouTube Data API key. Set YOUTUBE_API_KEY in Render.'});
  const query=cleanInput(url.searchParams.get('channel')||url.searchParams.get('slug'));
  if(!query) return sendJson(res,400,{error:'Enter a YouTube channel name, @handle, channel ID or URL.'});
  try{
    const channel=await resolveChannel(query);
    if(!channel) return sendJson(res,404,{ok:false,error:'YouTube channel not found.'});
    const live=await getLiveVideo(channel.id);
    const category=live?await getCategory(live.snippet?.categoryId).catch(()=>null):null;
    const normalized=normalizeChannel(channel,live,category);
    return sendJson(res,200,{ok:true,source:'youtube-data-api-v3',fetchedAt:new Date().toISOString(),channel:normalized,raw:{channel,liveVideo:live}});
  }catch(error){
    return sendJson(res,error.status&&error.status>=400&&error.status<600?error.status:502,{ok:false,error:error.message||'Unable to fetch YouTube channel.',details:error.details});
  }
}

function serveStatic(res,pathname){let relative=pathname==='/'?'/index.html':pathname;let filePath=path.normalize(path.join(PUBLIC_DIR,relative));if(!filePath.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden');}fs.stat(filePath,(err,stat)=>{if(err||!stat.isFile())filePath=path.join(PUBLIC_DIR,'index.html');fs.readFile(filePath,(readErr,content)=>{if(readErr){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':path.basename(filePath)==='index.html'?'no-cache':'public, max-age=3600'});res.end(content);});});}

const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/channel')return handleApi(req,res,url);serveStatic(res,decodeURIComponent(url.pathname));});
server.listen(PORT,'0.0.0.0',()=>console.log(`BiisViews YouTube server running on http://localhost:${PORT}`));
