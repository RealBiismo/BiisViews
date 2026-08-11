const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp' };

function sendJson(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function cleanSlug(value){return String(value||'').trim().replace(/^https?:\/\/(www\.)?kick\.com\//i,'').split(/[/?#]/)[0].replace(/^@/,'').toLowerCase();}
function first(...values){return values.find(v=>v!==undefined&&v!==null&&v!=='');}
function unwrap(raw){return raw?.data?.channel || raw?.data || raw?.channel || raw;}

function normalizeChannel(input,requestedSlug){
  const raw=unwrap(input)||{};
  const livestream=raw?.livestream||raw?.live_stream||raw?.stream||null;
  const user=raw?.user||raw?.owner||{};
  const categoryObj=first(livestream?.categories?.[0],livestream?.category,raw?.category,raw?.recent_categories?.[0])||{};
  const viewerCount=first(livestream?.viewer_count,livestream?.viewers,raw?.viewer_count,raw?.viewers);
  const profilePicture=first(user?.profile_pic,user?.profile_picture,user?.avatar,user?.avatar_url,raw?.profile_pic,raw?.profile_picture,raw?.avatar,raw?.avatar_url);
  const banner=first(raw?.banner_image?.url,raw?.banner_image,raw?.banner,raw?.cover_image?.url,raw?.cover_image,user?.banner_image?.url,user?.banner_image,user?.banner);
  const thumbnail=first(livestream?.thumbnail?.url,livestream?.thumbnail,raw?.thumbnail?.url,raw?.thumbnail,banner);
  const followers=first(raw?.followers_count,raw?.followersCount,raw?.follower_count,raw?.followers,user?.followers_count);
  const following=first(raw?.following_count,raw?.followingCount,user?.following_count);
  const subscriptions=first(raw?.subscribers_count,raw?.subscriber_count,raw?.subscriptions_count,raw?.subscribers);
  const liveFlag=first(livestream?.is_live,raw?.is_live);
  const isLive=liveFlag !== undefined ? Boolean(liveFlag) : Boolean(livestream && (viewerCount !== undefined || livestream?.id));
  return {
    slug:first(raw?.slug,user?.slug,requestedSlug),
    username:first(user?.username,raw?.username,raw?.name,user?.name,requestedSlug),
    displayName:first(user?.display_name,raw?.display_name,user?.username,raw?.username,requestedSlug),
    channelId:first(raw?.id,raw?.channel_id,livestream?.channel_id),
    userId:first(raw?.user_id,user?.id),
    chatroomId:first(raw?.chatroom?.id,raw?.chatroom_id),
    profilePicture:profilePicture||null,
    banner:banner||null,
    bio:first(user?.bio,raw?.bio,raw?.description)||null,
    verified:Boolean(first(user?.is_verified,raw?.verified,raw?.is_verified,false)),
    followers:followers??null,
    following:following??null,
    subscriptions:subscriptions??null,
    subscriptionEnabled:Boolean(first(raw?.subscription_enabled,raw?.subscriptions_enabled,raw?.can_subscribe,false)),
    vodEnabled:Boolean(first(raw?.vod_enabled,raw?.videos_enabled,false)),
    isLive,
    viewers:viewerCount??null,
    title:first(livestream?.session_title,livestream?.title,raw?.stream_title,raw?.title)||null,
    category:first(categoryObj?.name,categoryObj?.title)||null,
    categoryId:first(categoryObj?.id,livestream?.category_id,raw?.category_id)||null,
    language:first(livestream?.language,raw?.language,user?.language)||null,
    startedAt:first(livestream?.created_at,livestream?.started_at,livestream?.start_time)||null,
    streamId:first(livestream?.id,raw?.livestream_id)||null,
    thumbnail:thumbnail||null,
    playbackUrl:first(raw?.playback_url,livestream?.playback_url)||null,
    createdAt:first(raw?.created_at,user?.created_at)||null,
    updatedAt:first(raw?.updated_at,user?.updated_at)||null,
    url:`https://kick.com/${first(raw?.slug,user?.slug,requestedSlug)}`
  };
}

function mergeChannel(base,next){
  const out={...base};
  for(const [key,value] of Object.entries(next||{})){
    const empty=out[key]===undefined||out[key]===null||out[key]===''||out[key]==='—';
    if(empty && value!==undefined && value!==null && value!=='') out[key]=value;
    if((key==='isLive'||key==='verified'||key==='subscriptionEnabled'||key==='vodEnabled') && value===true) out[key]=true;
  }
  return out;
}

function scoreChannel(c){
  const keys=['profilePicture','banner','bio','channelId','userId','chatroomId','followers','following','subscriptions','viewers','title','category','categoryId','language','startedAt','streamId','createdAt'];
  return keys.reduce((n,k)=>n+(c?.[k]!==undefined&&c?.[k]!==null&&c?.[k]!==''?1:0),0)+(c?.isLive?2:0);
}

function curlProbe(endpoint,slug){return new Promise(resolve=>{const args=['-sS','-L','--compressed','--max-time','12','-H','Accept: application/json, text/plain, */*','-H','Accept-Language: en-GB,en;q=0.9','-H',`Referer: https://kick.com/${encodeURIComponent(slug)}`,'-H','Origin: https://kick.com','-H','User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36','-w','\n__BIISVIEWS_STATUS__:%{http_code}',endpoint];execFile('curl',args,{timeout:15000,maxBuffer:5*1024*1024},(error,stdout='',stderr='')=>{const marker='\n__BIISVIEWS_STATUS__:';const idx=stdout.lastIndexOf(marker);const body=idx>=0?stdout.slice(0,idx):stdout;const status=idx>=0?Number(stdout.slice(idx+marker.length).trim()):0;let json=null;try{json=JSON.parse(body);}catch{}resolve({endpoint,status,ok:status>=200&&status<300,json,bodyPreview:json?undefined:body.slice(0,700),transport:'curl',transportError:error&&!stdout?(stderr||error.message):undefined});});});}

async function probeAll(slug){
  const slugEndpoints=[
    `https://api.kick.com/private/v1/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`
  ];
  const diagnostics=[];
  const successful=[];
  let merged=null;

  for(const endpoint of slugEndpoints){
    const probe=await curlProbe(endpoint,slug);
    diagnostics.push(probe);
    if(probe.ok&&probe.json&&typeof probe.json==='object'){
      const normalized=normalizeChannel(probe.json,slug);
      successful.push({endpoint,raw:probe.json,channel:normalized,score:scoreChannel(normalized)});
      merged=mergeChannel(merged||{},normalized);
    }
  }

  if(!merged) return {ok:false,diagnostics};

  const channelId=merged.channelId;
  if(channelId){
    for(const endpoint of [
      `https://api.kick.com/channels/${channelId}/followers-count`,
      `https://api.kick.com/private/v0/channels/${channelId}/viewer-count`
    ]){
      const p=await curlProbe(endpoint,slug);
      diagnostics.push(p);
      if(p.ok&&p.json){
        const d=unwrap(p.json)||p.json;
        if(endpoint.includes('followers-count')) merged.followers=first(d?.followers_count,d?.count,d?.followers,merged.followers);
        if(endpoint.includes('viewer-count')){
          merged.viewers=first(d?.viewer_count,d?.count,d?.viewers,merged.viewers);
          const explicitLive=first(d?.is_live,d?.live);
          if(explicitLive!==undefined) merged.isLive=Boolean(explicitLive);
        }
      }
    }
  }

  successful.sort((a,b)=>b.score-a.score);
  const richest=successful[0];
  return {ok:true,channel:merged,rawResponses:successful.map(x=>({endpoint:x.endpoint,data:x.raw})),endpoint:richest?.endpoint||successful[0]?.endpoint,diagnostics};
}

async function handleApi(req,res,url){
  if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});
  const slug=cleanSlug(url.searchParams.get('slug'));
  if(!slug||!/^[a-z0-9_.-]{1,80}$/i.test(slug))return sendJson(res,400,{error:'Enter a valid Kick username or channel URL.'});
  const result=await probeAll(slug);
  if(result.ok)return sendJson(res,200,{ok:true,source:'kick-endpoint-merge',endpoint:result.endpoint,transport:'curl',fetchedAt:new Date().toISOString(),channel:result.channel,raw:result.rawResponses,diagnostics:result.diagnostics});
  return sendJson(res,502,{ok:false,error:'No tested Kick endpoint returned usable channel JSON.',diagnostics:result.diagnostics});
}

function serveStatic(res,pathname){let relative=pathname==='/'?'/index.html':pathname;let filePath=path.normalize(path.join(PUBLIC_DIR,relative));if(!filePath.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden');}fs.stat(filePath,(err,stat)=>{if(err||!stat.isFile())filePath=path.join(PUBLIC_DIR,'index.html');fs.readFile(filePath,(readErr,content)=>{if(readErr){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':path.basename(filePath)==='index.html'?'no-cache':'public, max-age=3600'});res.end(content);});});}

const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/channel')return handleApi(req,res,url);serveStatic(res,decodeURIComponent(url.pathname));});
server.listen(PORT,'0.0.0.0',()=>console.log(`BiisViews running on http://localhost:${PORT}`));