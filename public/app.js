const form = document.querySelector('#lookupForm');
const input = document.querySelector('#channelInput');
const button = document.querySelector('#lookupButton');
const statusEl = document.querySelector('#status');
const result = document.querySelector('#result');

const ids = ['cover','liveBadge','avatar','username','displayName','verified','channelLink','bio','streamTitle','liveStatus','viewers','followers','category','following','subscriptions','language','vodEnabled','channelId','userId','chatroomId','streamId','categoryId','subscriptionEnabled','startedAt','createdAt','rawJson','diagnosticsJson'];
const els = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : String(value);
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const yesNo = (value) => value === true ? 'Yes' : value === false ? 'No' : '—';

function setLoading(loading) {
  button.disabled = loading;
  button.textContent = loading ? 'Fetching…' : 'Search channel';
}

function setStatus(message, error = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', error);
}

function showChannel(payload) {
  const c = payload.channel || {};
  result.classList.remove('hidden');

  els.username.textContent = c.username || c.slug || 'Unknown channel';
  els.displayName.textContent = c.displayName && c.displayName !== c.username ? c.displayName : '';
  els.channelLink.textContent = c.url || '';
  els.channelLink.href = c.url || '#';
  els.bio.textContent = c.bio || 'No public bio returned.';
  els.streamTitle.textContent = c.title || (c.isLive ? 'Live now' : 'Channel is offline');
  els.liveStatus.textContent = c.isLive ? 'LIVE' : 'OFFLINE';
  els.viewers.textContent = c.isLive ? formatNumber(c.viewers) : '—';
  els.followers.textContent = formatNumber(c.followers);
  els.category.textContent = c.category || '—';
  els.following.textContent = formatNumber(c.following);
  els.subscriptions.textContent = formatNumber(c.subscriptions);
  els.language.textContent = c.language || '—';
  els.vodEnabled.textContent = yesNo(c.vodEnabled);
  els.channelId.textContent = c.channelId ?? '—';
  els.userId.textContent = c.userId ?? '—';
  els.chatroomId.textContent = c.chatroomId ?? '—';
  els.streamId.textContent = c.streamId ?? '—';
  els.categoryId.textContent = c.categoryId ?? '—';
  els.subscriptionEnabled.textContent = yesNo(c.subscriptionEnabled);
  els.startedAt.textContent = formatDate(c.startedAt);
  els.createdAt.textContent = formatDate(c.createdAt);
  els.rawJson.textContent = JSON.stringify(payload.raw, null, 2);
  els.diagnosticsJson.textContent = JSON.stringify(payload.diagnostics || [], null, 2);

  els.liveBadge.classList.toggle('hidden', !c.isLive);
  els.verified.classList.toggle('hidden', !c.verified);

  if (c.profilePicture) {
    els.avatar.src = c.profilePicture;
    els.avatar.style.visibility = 'visible';
  } else {
    els.avatar.removeAttribute('src');
    els.avatar.style.visibility = 'hidden';
  }

  const coverImage = c.banner || c.thumbnail;
  els.cover.style.backgroundImage = coverImage ? `url("${String(coverImage).replace(/"/g, '%22')}")` : '';
}

async function lookup(value) {
  setLoading(true);
  setStatus('Checking Kick endpoints…');
  result.classList.add('hidden');

  try {
    const response = await fetch(`/api/channel?slug=${encodeURIComponent(value)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
      const diagnostics = payload.diagnostics || [];
      const detail = diagnostics.map(d => `${d.status || '?'} ${d.endpoint}`).join(' · ');
      throw new Error(detail ? `${payload.error || 'Unable to fetch channel'} ${detail}` : (payload.error || 'Unable to fetch channel'));
    }
    showChannel(payload);
    setStatus(`Fetched ${payload.channel.username || payload.channel.slug}.`);
    history.replaceState(null, '', `?channel=${encodeURIComponent(payload.channel.slug || value)}`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (value) lookup(value);
});

const initial = new URLSearchParams(location.search).get('channel');
if (initial) {
  input.value = initial;
  lookup(initial);
}