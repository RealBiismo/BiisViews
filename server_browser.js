const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const puppeteer = require('puppeteer');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp' };
let browserPromise = null;

function sendJson(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function cleanSlug(v){return String(v||'').trim().replace(/^https?:\/\/(www\.)?kick\.com\//i,'').split(/[/?#]/)[0].replace(/^@/,'').toLowerCase();}
function first(...v){return v.find(x=>x!==undefined&&x!==null&&x!=='');}
function unwrap(raw){return raw?.data?.channel||raw?.data?.livestream||raw?.data?.stream||raw?.data||raw?.channel||raw?.livestream||raw?.stream||raw;}

function normalize(input,slug){
  const raw=unwrap(input)||{};
  const live=raw?.livestream||raw?.live_stream||raw?.stream||null;
  const user=raw?.user||raw?.owner||{};
  const cat=first(live?.categories?.[0],live?.category,raw?.category,raw?.recent_categories?.[0])||{};
  const viewers=first(live?.viewer_count,live?.viewers,raw?.viewer_count,raw?.viewers);
  const liveFlag=first(live?.is_live,raw?.is_live);
  return {
    slug:first(raw?.slug,user?.slug,slug),
    username:first(user?.username,raw?.username,raw?.name,user?.name,slug),
    displayName:first(user?.display_name,raw?.display_name,user?.username,raw?.username,slug),
    channelId:first(raw?.channel_id,raw?.id,live?.channel_id),
    userId:first(raw?.user_id,user?.id),
    chatroomId:first(raw?.chatroom?.id,raw?.chatroom_id),
    profilePicture:first(user?.profile_pic,user?.profile_picture,user?.avatar,user?.avatar_url,raw?.profile_pic,raw?.profile_picture,raw?.avatar,raw?.avatar_url)||null,
    banner:first(raw?.banner_image?.url,raw?.banner_image,raw?.banner,raw?.cover_image?.url,raw?.cover_image,user?.banner_image?.url,user?.banner_image)||null,
    bio:first(user?.bio,raw?.bio,raw?.description)||null,
    verified:Boolean(first(user?.is_verified,raw?.verified,raw?.is_verified,false)),
    followers:first(raw?.followers_count,raw?.followersCount,raw?.follower_count,raw?.followers,user?.followers_count)??null,
    following:first(raw?.following_count,raw?.followingCount,user?.following_count)??null,
    subscriptions:first(raw?.subscribers_count,raw?.subscriber_count,raw?.subscriptions_count,raw?.subscribers)??null,
    subscriptionEnabled:Boolean(first(raw?.subscription_enabled,raw?.subscriptions_enabled,raw?.can_subscribe,false)),
    vodEnabled:Boolean(first(raw?.vod_enabled,raw?.videos_enabled,false)),
    isLive: liveFlag!==undefined ? Boolean(liveFlag) : Boolean(live && (viewers!==undefined||live?.id)),
    viewers:viewers??null,
    title:first(live?.session_title,live?.title,raw?.session_title,raw?.stream_title,raw?.title)||null,
    category:first(cat?.name,cat?.title)||null,
    categoryId:first(cat?.id,live?.category_id,raw?.category_id)||null,
    language:first(live?.language,raw?.language,user?.language)||null,
    startedAt:first(live?.created_at,live?.started_at,live?.start_time,raw?.started_at)||null,
    streamId:first(live?.id,raw?.livestream_id,raw?.stream_id)||null,
    thumbnail:first(live?.thumbnail?.url,live?.thumbnail,raw?.thumbnail?.url,raw?.thumbnail)||null,
    playbackUrl:first(raw?.playback_url,live?.playback_url)||null,
    createdAt:first(raw?.channel_created_at,user?.created_at)||null,
    url:`https://kick.com/${first(raw?.slug,user?.slug,slug)}`
  };
}
function merge(base,next){const out={...base};for(const [k,v] of Object.entries(next||{})){const empty=out[k]===undefined||out[k]===null||out[k]==='';if(empty&&v!==undefined&&v!==null&&v!=='')out[k]=v;if(['isLive','verified','subscriptionEnabled','vodEnabled'].includes(k)&&v===true)out[k]=true;}return out;}

async function getBrowser(){
  if(!browserPromise){
    browserPromise=puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']}).catch(err=>{browserPromise=null;throw err;});
  }
  return browserPromise;
}

async function browserFetch(slug){
  const browser=await getBrowser();
  const page=await browser.newPage();
  await page.setViewport({width:1280,height:800});
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  const diagnostics=[];
  try{
    const nav=await page.goto(`https://kick.com/${encodeURIComponent(slug)}`,{waitUntil:'domcontentloaded',timeout:30000});
    diagnostics.push({transport:'browser-navigation',endpoint:`https://kick.com/${slug}`,status:nav?.status()||0,ok:!!nav&&nav.ok()});
    await new Promise(r=>setTimeout(r,2500));

    const result=await page.evaluate(async (slug)=>{
      const urls=[
        `/api/v2/channels/${encodeURIComponent(slug)}`,
        `/api/v1/channels/${encodeURIComponent(slug)}`,
        `/api/v2/channels/${encodeURIComponent(slug)}/livestream`,
        `/api/v1/channels/${encodeURIComponent(slug)}/livestream`,
        `/api/v2/channels/${encodeURIComponent(slug)}/chatroom`
      ];
      const responses=[];
      for(const url of urls){
        try{
          const r=await fetch(url,{credentials:'include',headers:{'Accept':'application/json, text/plain, */*'}});
          const text=await r.text();
          let data=null; try{data=JSON.parse(text);}catch{}
          responses.push({url,status:r.status,ok:r.ok,data,bodyPreview:data?undefined:text.slice(0,500)});
        }catch(e){responses.push({url,status:0,ok:false,error:String(e)});}
      }
      const meta={
        title:document.title,
        ogTitle:document.querySelector('meta[property="og:title"]')?.content||null,
        ogImage:document.querySelector('meta[property="og:image"]')?.content||null,
        description:document.querySelector('meta[name="description"]')?.content||document.querySelector('meta[property="og:description"]')?.content||null
      };
      return {responses,meta};
    },slug);

    let merged={slug,username:slug,displayName:slug,url:`https://kick.com/${slug}`};
    const raw=[];
    for(const r of result.responses){
      diagnostics.push({transport:'browser-fetch',endpoint:`https://kick.com${r.url}`,status:r.status,ok:r.ok,bodyPreview:r.bodyPreview,error:r.error});
      if(r.ok&&r.data&&typeof r.data==='object'){
        raw.push({endpoint:`https://kick.com${r.url}`,data:r.data});
        merged=merge(merged,normalize(r.data,slug));
      }
    }
    if(!merged.profilePicture&&result.meta.ogImage) merged.profilePicture=result.meta.ogImage;
    if(!merged.thumbnail&&result.meta.ogImage) merged.thumbnail=result.meta.ogImage;
    if(!merged.bio&&result.meta.description) merged.bio=result.meta.description;
    return {channel:merged,raw,diagnostics,meta:result.meta};
  } finally { await page.close().catch(()=>{}); }
}

async function handleApi(req,res,url){
  if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});
  const slug=cleanSlug(url.searchParams.get('slug'));
  if(!slug||!/^[a-z0-9_.-]{1,80}$/i.test(slug))return sendJson(res,400,{error:'Enter a valid Kick username or channel URL.'});
  try{
    const result=await browserFetch(slug);
    return sendJson(res,200,{ok:true,source:'kick-browser-session',transport:'puppeteer',fetchedAt:new Date().toISOString(),channel:result.channel,raw:result.raw,diagnostics:result.diagnostics,meta:result.meta});
  }catch(error){return sendJson(res,502,{ok:false,error:`Browser fetch failed: ${error.message}`,diagnostics:[{transport:'puppeteer',error:error.stack||error.message}]});}
}

function serveStatic(res,pathname){let relative=pathname==='/'?'/index.html':pathname;let filePath=path.normalize(path.join(PUBLIC_DIR,relative));if(!filePath.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden');}fs.stat(filePath,(err,stat)=>{if(err||!stat.isFile())filePath=path.join(PUBLIC_DIR,'index.html');fs.readFile(filePath,(readErr,content)=>{if(readErr){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':path.basename(filePath)==='index.html'?'no-cache':'public, max-age=3600'});res.end(content);});});}

const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/channel')return handleApi(req,res,url);serveStatic(res,decodeURIComponent(url.pathname));});
server.listen(PORT,'0.0.0.0',()=>console.log(`BiisViews browser-backed server running on http://localhost:${PORT}`));
