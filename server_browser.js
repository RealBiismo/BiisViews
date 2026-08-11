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
function numberFromText(v){if(v===undefined||v===null)return null;const s=String(v).replace(/[^0-9.]/g,'');if(!s)return null;if(/[kKmMbB]/.test(String(v))){const n=parseFloat(s);const t=String(v).toLowerCase();return Math.round(n*(t.includes('b')?1e9:t.includes('m')?1e6:1e3));}return Number(s.replace(/\./g,''))||Number(s)||null;}
function textOf(v){if(!v)return null;if(typeof v==='string')return v;if(v.simpleText)return v.simpleText;if(Array.isArray(v.runs))return v.runs.map(x=>x.text||'').join('');return null;}
function bestThumb(t){if(!t)return null;if(typeof t==='string')return t;const arr=Array.isArray(t)?t:(t.thumbnails||[]);return arr.length?arr[arr.length-1]?.url||null:null;}

async function fetchPage(url){
  const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':UA,'Accept-Language':'en-GB,en;q=0.9','Accept':'text/html,application/xhtml+xml'}});
  const text=await r.text();
  if(!r.ok){const e=new Error(`YouTube returned HTTP ${r.status}`);e.status=r.status;e.details=text.slice(0,300);throw e;}
  return {url:r.url,html:text,status:r.status};
}

function decodeHtml(s){return String(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function meta(html,property){
  const p=property.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=[new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`,'i')];
  for(const re of patterns){const m=html.match(re);if(m)return decodeHtml(m[1]);}return null;
}
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

function walk(node,fn,depth=0){if(node===null||node===undefined||depth>18)return null;if(fn(node))return node;if(Array.isArray(node)){for(const v of node){const x=walk(v,fn,depth+1);if(x)return x;}}else if(typeof node==='object'){for(const v of Object.values(node)){const x=walk(v,fn,depth+1);if(x)return x;}}return null;}
function findKey(node,key){let value;walk(node,n=>{if(n&&typeof n==='object'&&!Array.isArray(n)&&Object.prototype.hasOwnProperty.call(n,key)){value=n[key];return true;}return false;});return value;}
function findTextMatching(node,re){let out=null;walk(node,n=>{if(n&&typeof n==='object'){const t=textOf(n);if(t&&re.test(t)){out=t;return true;}}return false;});return out;}

function parseInput(value){
  const raw=cleanInput(value);
  try{
    const u=new URL(raw.match(/^https?:\/\//i)?raw:`https://${raw}`);
    if(/(^|\.)youtube\.com$/i.test(u.hostname)){
      const parts=u.pathname.split('/').filter(Boolean);
      if(parts[0]==='channel'&&parts[1])return {path:`/channel/${parts[1]}`,label:parts[1]};
      if(parts[0]?.startsWith('@'))return {path:`/${parts[0]}`,label:parts[0]};
      if(parts[0]==='c'&&parts[1])return {path:`/@${parts[1]}`,label:parts[1]};
      if(parts[0]==='user'&&parts[1])return {path:`/user/${parts[1]}`,label:parts[1]};
    }
  }catch{}
  if(/^UC[A-Za-z0-9_-]{20,}$/.test(raw))return {path:`/channel/${raw}`,label:raw};
  const h=raw.replace(/^@/,'').replace(/\s+/g,'');
  return {path:`/@${encodeURIComponent(h)}`,label:`@${h}`};
}

function parseChannelPage(page,input){
  const html=page.html;
  const data=extractJson(html,['var ytInitialData = ','ytInitialData = ','"ytInitialData":']);
  const ogTitle=meta(html,'og:title');
  const ogImage=meta(html,'og:image');
  const description=meta(html,'description')||meta(html,'og:description');
  const canon=canonical(html)||page.url;
  const channelId=first(
    html.match(/"channelId":"(UC[A-Za-z0-9_-]+)"/)?.[1],
    html.match(/"externalId":"(UC[A-Za-z0-9_-]+)"/)?.[1],
    html.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/)?.[1]
  );
  const subscriberText=first(findTextMatching(data,/subscriber/i),html.match(/"subscriberCountText":\{"simpleText":"([^"]+)"/)?.[1]);
  const videoCountText=first(findTextMatching(data,/\bvideos?\b/i),html.match(/"videosCountText":\{[^}]*"simpleText":"([^"]+)"/)?.[1]);
  const handle=first(html.match(/"vanityChannelUrl":"https:\/\/www\.youtube\.com\/(@[^"]+)"/)?.[1],html.match(/"canonicalBaseUrl":"\/@([^"]+)"/)?.[1]&&`@${html.match(/"canonicalBaseUrl":"\/@([^"]+)"/)?.[1]}`);
  const avatar=first(ogImage,bestThumb(findKey(data,'avatar')));
  const banner=bestThumb(findKey(data,'banner'));
  return {
    platform:'YouTube', channelId:channelId||null, username:handle||input, displayName:ogTitle||input, customUrl:handle||null,
    profilePicture:avatar||null,banner:banner||null,bio:description||null,
    subscribers:numberFromText(subscriberText),hiddenSubscribers:!subscriberText,totalViews:null,videoCount:numberFromText(videoCountText),
    country:null,createdAt:null,privacyStatus:'public',url:canon
  };
}

function parseAboutPage(page,channel){
  const html=page.html;const data=extractJson(html,['var ytInitialData = ','ytInitialData = ','"ytInitialData":']);
  const viewsText=first(findTextMatching(data,/views/i),html.match(/([0-9,.]+) views/)?.[0]);
  const joinedText=first(findTextMatching(data,/joined/i),html.match(/Joined [A-Za-z]+ \d{1,2}, \d{4}/)?.[0]);
  const countryText=findTextMatching(data,/^[A-Za-z][A-Za-z .'-]{2,40}$/);
  return {...channel,totalViews:first(channel.totalViews,numberFromText(viewsText)),createdAt:first(channel.createdAt,joinedText?.replace(/^Joined\s+/i,'')),country:first(channel.country,countryText)};
}

function parseLivePage(page,channel){
  const html=page.html;
  const player=extractJson(html,['var ytInitialPlayerResponse = ','ytInitialPlayerResponse = ','"ytInitialPlayerResponse":']);
  const data=extractJson(html,['var ytInitialData = ','ytInitialData = ','"ytInitialData":']);
  const vd=player?.videoDetails||{};
  const micro=player?.microformat?.playerMicroformatRenderer||{};
  const isLive=Boolean(vd.isLiveContent || micro.liveBroadcastDetails?.isLiveNow || /"style":"LIVE"/.test(html) || /\bwatching\b/i.test(html));
  if(!isLive)return {...channel,isLive:false,viewers:null,title:null,category:null,categoryId:null,language:null,startedAt:null,streamId:null,thumbnail:null,liveLikes:null,liveUrl:null};
  const watching=first(findTextMatching(data,/watching/i),html.match(/([0-9,.]+) watching/i)?.[0]);
  const likes=first(findTextMatching(data,/ likes?$/i),html.match(/"likeCount":"([0-9]+)"/)?.[1]);
  const category=first(micro.category,findKey(data,'category'));
  const videoId=first(vd.videoId,html.match(/"videoId":"([A-Za-z0-9_-]{11})"/)?.[1]);
  const thumbs=vd.thumbnail?.thumbnails||micro.thumbnail?.thumbnails;
  return {...channel,isLive:true,viewers:numberFromText(watching),title:first(vd.title,meta(html,'og:title')),category:typeof category==='string'?category:null,categoryId:null,language:first(vd.defaultAudioLanguage,micro.defaultAudioLanguage),startedAt:first(micro.liveBroadcastDetails?.startTimestamp,micro.publishDate),streamId:videoId||null,thumbnail:first(bestThumb(thumbs),meta(html,'og:image')),liveLikes:numberFromText(likes),liveUrl:videoId?`https://www.youtube.com/watch?v=${videoId}`:page.url};
}

async function handleApi(req,res,url){
  if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});
  const query=cleanInput(url.searchParams.get('channel')||url.searchParams.get('slug'));
  if(!query)return sendJson(res,400,{error:'Enter a YouTube channel name, @handle, channel ID or URL.'});
  try{
    const parsed=parseInput(query);
    const base=`https://www.youtube.com${parsed.path}`;
    const channelPage=await fetchPage(base);
    let channel=parseChannelPage(channelPage,parsed.label);
    let about=null; try{about=await fetchPage(`${base}/about`);channel=parseAboutPage(about,channel);}catch{}
    let livePage=null; try{livePage=await fetchPage(`${base}/live`);channel=parseLivePage(livePage,channel);}catch{channel={...channel,isLive:false};}
    return sendJson(res,200,{ok:true,source:'youtube-public-pages-keyless',fetchedAt:new Date().toISOString(),channel,raw:{channelPage:{url:channelPage.url,status:channelPage.status},aboutPage:about?{url:about.url,status:about.status}:null,livePage:livePage?{url:livePage.url,status:livePage.status}:null}});
  }catch(error){return sendJson(res,error.status||502,{ok:false,error:error.message||'Unable to fetch YouTube channel.',details:error.details});}
}

function serveStatic(res,pathname){let relative=pathname==='/'?'/index.html':pathname;let filePath=path.normalize(path.join(PUBLIC_DIR,relative));if(!filePath.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden');}fs.stat(filePath,(err,stat)=>{if(err||!stat.isFile())filePath=path.join(PUBLIC_DIR,'index.html');fs.readFile(filePath,(readErr,content)=>{if(readErr){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':path.basename(filePath)==='index.html'?'no-cache':'public, max-age=3600'});res.end(content);});});}

const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/channel')return handleApi(req,res,url);serveStatic(res,decodeURIComponent(url.pathname));});
server.listen(PORT,'0.0.0.0',()=>console.log(`BiisViews keyless YouTube server running on http://localhost:${PORT}`));
