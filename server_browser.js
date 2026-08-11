const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function sendJson(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function first(...v){return v.find(x=>x!==undefined&&x!==null&&x!=='');}
function cleanInput(v){return String(v||'').trim();}
function decodeHtml(s){return String(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function stripCountLabel(v){return String(v||'').replace(/subscribers?|views?|videos?|watching|likes?/ig,'').trim();}
function numberFromText(v){
  if(v===undefined||v===null||v==='') return null;
  const raw=String(v).replace(/,/g,'').trim();
  const m=raw.match(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/i);
  if(!m) return null;
  const n=parseFloat(m[1]); const u=(m[2]||'').toUpperCase();
  return Math.round(n*(u==='B'?1e9:u==='M'?1e6:u==='K'?1e3:1));
}
function textOf(v){if(!v)return null;if(typeof v==='string')return v;if(v.simpleText)return v.simpleText;if(Array.isArray(v.runs))return v.runs.map(x=>x.text||'').join('');return null;}
function bestThumb(t){if(!t)return null;if(typeof t==='string')return t;const arr=Array.isArray(t)?t:(t.thumbnails||[]);return arr.length?arr[arr.length-1]?.url||null:null;}

async function fetchPage(url){
  const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':UA,'Accept-Language':'en-GB,en;q=0.9','Accept':'text/html,application/xhtml+xml'}});
  const text=await r.text();
  if(!r.ok){const e=new Error(`YouTube returned HTTP ${r.status}`);e.status=r.status;e.details=text.slice(0,300);throw e;}
  return {url:r.url,html:text,status:r.status};
}
function meta(html,property){const p=property.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');for(const re of [new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`,'i')]){const m=html.match(re);if(m)return decodeHtml(m[1]);}return null;}
function canonical(html){const m=html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)||html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);return m?.[1]||null;}

function extractJson(html,markers){
  for(const marker of markers){
    const idx=html.indexOf(marker); if(idx<0) continue;
    let start=html.indexOf('{',idx+marker.length); if(start<0) continue;
    let depth=0,inStr=false,esc=false;
    for(let i=start;i<html.length;i++){
      const ch=html[i];
      if(inStr){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')inStr=false;continue;}
      if(ch==='"'){inStr=true;continue;}
      if(ch==='{')depth++; else if(ch==='}'){depth--;if(depth===0){try{return JSON.parse(html.slice(start,i+1));}catch{break;}}}
    }
  }
  return null;
}
function walkAll(node,fn,results=[],depth=0){if(node===null||node===undefined||depth>22)return results;if(fn(node))results.push(node);if(Array.isArray(node)){for(const v of node)walkAll(v,fn,results,depth+1);}else if(typeof node==='object'){for(const v of Object.values(node))walkAll(v,fn,results,depth+1);}return results;}
function findKey(node,key){let value;walkAll(node,n=>{if(value!==undefined)return false;if(n&&typeof n==='object'&&!Array.isArray(n)&&Object.prototype.hasOwnProperty.call(n,key)){value=n[key];return true;}return false;});return value;}
function allText(node){const out=[];walkAll(node,n=>{if(n&&typeof n==='object'){const t=textOf(n);if(t)out.push(t);}return false;});return [...new Set(out)];}
function findText(node,re){return allText(node).find(t=>re.test(t))||null;}
function regexText(html,patterns){for(const re of patterns){const m=html.match(re);if(m)return decodeHtml(m[1]||m[0]);}return null;}

function parseInput(value){
  const raw=cleanInput(value);
  try{const u=new URL(raw.match(/^https?:\/\//i)?raw:`https://${raw}`);if(/(^|\.)youtube\.com$/i.test(u.hostname)){const parts=u.pathname.split('/').filter(Boolean);if(parts[0]==='channel'&&parts[1])return {path:`/channel/${parts[1]}`,label:parts[1]};if(parts[0]?.startsWith('@'))return {path:`/${parts[0]}`,label:parts[0]};if(parts[0]==='c'&&parts[1])return {path:`/@${parts[1]}`,label:parts[1]};if(parts[0]==='user'&&parts[1])return {path:`/user/${parts[1]}`,label:parts[1]};}}catch{}
  if(/^UC[A-Za-z0-9_-]{20,}$/.test(raw))return {path:`/channel/${raw}`,label:raw};
  const h=raw.replace(/^@/,'').replace(/\s+/g,'');return {path:`/@${encodeURIComponent(h)}`,label:`@${h}`};
}

function parseChannelPage(page,input){
  const html=page.html; const data=extractJson(html,['var ytInitialData = ','ytInitialData = ','"ytInitialData":']);
  const texts=allText(data);
  const ogTitle=meta(html,'og:title'); const ogImage=meta(html,'og:image'); const description=meta(html,'description')||meta(html,'og:description'); const canon=canonical(html)||page.url;
  const channelId=first(html.match(/"channelId":"(UC[A-Za-z0-9_-]+)"/)?.[1],html.match(/"externalId":"(UC[A-Za-z0-9_-]+)"/)?.[1],html.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/)?.[1]);
  const subscriberText=first(texts.find(t=>/\bsubscribers?\b/i.test(t)),regexText(html,[/"subscriberCountText":\{"simpleText":"([^"]+)"/i,/"subscriberCountText":\{"runs":\[\{"text":"([^"]+)"/i]));
  const videoCountText=first(texts.find(t=>/^\s*[0-9,.KMB]+\s+videos?\s*$/i.test(t)),regexText(html,[/"videosCountText":\{[^}]*"simpleText":"([^"]+)"/i]));
  const handle=first(regexText(html,[/"vanityChannelUrl":"https:\/\/www\.youtube\.com\/(@[^"]+)"/i]),regexText(html,[/"canonicalBaseUrl":"\/(@[^"]+)"/i]));
  const avatar=first(ogImage,bestThumb(findKey(data,'avatar'))); const banner=bestThumb(findKey(data,'banner'));
  return {platform:'YouTube',channelId:channelId||null,username:handle||input,displayName:ogTitle||input,customUrl:handle||null,profilePicture:avatar||null,banner:banner||null,bio:description||null,subscribers:numberFromText(stripCountLabel(subscriberText)),subscriberText:subscriberText||null,hiddenSubscribers:!subscriberText,totalViews:null,totalViewsText:null,videoCount:numberFromText(stripCountLabel(videoCountText)),videoCountText:videoCountText||null,country:null,createdAt:null,privacyStatus:'public',url:canon,isLive:false};
}

function parseAboutPage(page,channel){
  const html=page.html; const data=extractJson(html,['var ytInitialData = ','ytInitialData = ','"ytInitialData":']); const texts=allText(data);
  const viewsText=first(texts.find(t=>/^\s*[0-9,.KMB]+\s+views?\s*$/i.test(t)),texts.find(t=>/\bviews\b/i.test(t)),regexText(html,[/([0-9,.]+\s+views)/i]));
  const joinedText=first(texts.find(t=>/^Joined\s+/i.test(t)),regexText(html,[/(Joined\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})/i]));
  const countryLabelIndex=texts.findIndex(t=>/^Country$/i.test(t)); const country=countryLabelIndex>=0?texts[countryLabelIndex+1]:null;
  return {...channel,totalViews:first(channel.totalViews,numberFromText(stripCountLabel(viewsText))),totalViewsText:viewsText||channel.totalViewsText,createdAt:first(channel.createdAt,joinedText?.replace(/^Joined\s+/i,'')),country:first(channel.country,country)};
}

function parseVideosPage(page){
  const data=extractJson(page.html,['var ytInitialData = ','ytInitialData = ','"ytInitialData":']);
  const renderers=walkAll(data,n=>!!(n?.gridVideoRenderer||n?.videoRenderer||n?.richItemRenderer?.content?.videoRenderer)); const seen=new Set(); const videos=[];
  for(const wrap of renderers){
    const v=wrap.gridVideoRenderer||wrap.videoRenderer||wrap.richItemRenderer?.content?.videoRenderer; if(!v?.videoId||seen.has(v.videoId))continue; seen.add(v.videoId);
    const title=textOf(v.title); const views=textOf(v.viewCountText)||textOf(v.shortViewCountText); const published=textOf(v.publishedTimeText); const duration=textOf(v.lengthText)||textOf(v.thumbnailOverlays?.find?.(x=>x.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text);
    videos.push({videoId:v.videoId,title:title||'Untitled',views:numberFromText(views),viewsText:views||null,published:published||null,duration:duration||null,thumbnail:bestThumb(v.thumbnail),url:`https://www.youtube.com/watch?v=${v.videoId}`});
    if(videos.length>=12)break;
  }
  return videos;
}

function parseLivePage(page,channel){
  const html=page.html; const player=extractJson(html,['var ytInitialPlayerResponse = ','ytInitialPlayerResponse = ','"ytInitialPlayerResponse":']); const data=extractJson(html,['var ytInitialData = ','ytInitialData = ','"ytInitialData":']);
  const vd=player?.videoDetails||{}; const micro=player?.microformat?.playerMicroformatRenderer||{};
  const isLive=Boolean(vd.isLiveContent&&micro.liveBroadcastDetails?.isLiveNow!==false || micro.liveBroadcastDetails?.isLiveNow || /"style":"LIVE"/.test(html));
  if(!isLive)return {...channel,isLive:false,viewers:null,title:null,category:null,categoryId:null,language:null,startedAt:null,streamId:null,thumbnail:null,liveLikes:null,liveUrl:null};
  const texts=allText(data); const watching=first(texts.find(t=>/watching/i.test(t)),regexText(html,[/([0-9,.KMB]+\s+watching)/i])); const likes=first(texts.find(t=>/^[0-9,.KMB]+\s+likes?$/i.test(t)),regexText(html,[/"likeCount":"([0-9]+)"/i]));
  const videoId=first(vd.videoId,html.match(/"videoId":"([A-Za-z0-9_-]{11})"/)?.[1]); const thumbs=vd.thumbnail?.thumbnails||micro.thumbnail?.thumbnails;
  return {...channel,isLive:true,viewers:numberFromText(watching),viewersText:watching||null,title:first(vd.title,meta(html,'og:title')),category:micro.category||null,categoryId:null,language:first(vd.defaultAudioLanguage,micro.defaultAudioLanguage),startedAt:first(micro.liveBroadcastDetails?.startTimestamp,micro.publishDate),streamId:videoId||null,thumbnail:first(bestThumb(thumbs),meta(html,'og:image')),liveLikes:numberFromText(likes),liveLikesText:likes||null,liveUrl:videoId?`https://www.youtube.com/watch?v=${videoId}`:page.url};
}

function deriveStats(channel,videos){
  const numericViews=videos.map(v=>v.views).filter(v=>Number.isFinite(v));
  const recentViewsTotal=numericViews.reduce((a,b)=>a+b,0);
  return {...channel,recentVideos:videos,recentVideoCount:videos.length,recentViewsTotal:numericViews.length?recentViewsTotal:null,recentAverageViews:numericViews.length?Math.round(recentViewsTotal/numericViews.length):null,topRecentVideo:numericViews.length?[...videos].filter(v=>Number.isFinite(v.views)).sort((a,b)=>b.views-a.views)[0]:null};
}

async function handleApi(req,res,url){
  if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});
  const query=cleanInput(url.searchParams.get('channel')||url.searchParams.get('slug')); if(!query)return sendJson(res,400,{error:'Enter a YouTube channel name, @handle, channel ID or URL.'});
  try{
    const parsed=parseInput(query); const base=`https://www.youtube.com${parsed.path}`; const diagnostics=[];
    const channelPage=await fetchPage(base); diagnostics.push({page:'channel',url:channelPage.url,status:channelPage.status}); let channel=parseChannelPage(channelPage,parsed.label);
    let about=null; try{about=await fetchPage(`${base}/about`);diagnostics.push({page:'about',url:about.url,status:about.status});channel=parseAboutPage(about,channel);}catch(e){diagnostics.push({page:'about',error:e.message});}
    let videosPage=null,videos=[]; try{videosPage=await fetchPage(`${base}/videos`);diagnostics.push({page:'videos',url:videosPage.url,status:videosPage.status});videos=parseVideosPage(videosPage);}catch(e){diagnostics.push({page:'videos',error:e.message});}
    let livePage=null; try{livePage=await fetchPage(`${base}/live`);diagnostics.push({page:'live',url:livePage.url,status:livePage.status});channel=parseLivePage(livePage,channel);}catch(e){diagnostics.push({page:'live',error:e.message});channel={...channel,isLive:false};}
    channel=deriveStats(channel,videos);
    return sendJson(res,200,{ok:true,source:'youtube-public-pages-keyless',fetchedAt:new Date().toISOString(),channel,raw:{diagnostics,pages:{channel:channelPage.url,about:about?.url||null,videos:videosPage?.url||null,live:livePage?.url||null}}});
  }catch(error){return sendJson(res,error.status||502,{ok:false,error:error.message||'Unable to fetch YouTube channel.',details:error.details});}
}

function serveStatic(res,pathname){let relative=pathname==='/'?'/index.html':pathname;let filePath=path.normalize(path.join(PUBLIC_DIR,relative));if(!filePath.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden');}fs.stat(filePath,(err,stat)=>{if(err||!stat.isFile())filePath=path.join(PUBLIC_DIR,'index.html');fs.readFile(filePath,(readErr,content)=>{if(readErr){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':path.basename(filePath)==='index.html'?'no-cache':'public, max-age=3600'});res.end(content);});});}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/channel')return handleApi(req,res,url);serveStatic(res,decodeURIComponent(url.pathname));});
server.listen(PORT,'0.0.0.0',()=>console.log(`BiisViews keyless YouTube stats server running on http://localhost:${PORT}`));