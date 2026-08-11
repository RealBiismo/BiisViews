const form = document.querySelector('#lookupForm');
const input = document.querySelector('#channelInput');
const button = document.querySelector('#lookupButton');
const statusEl = document.querySelector('#status');
const result = document.querySelector('#result');

const DEFAULT_CHANNEL = 'TYRIQUEHYDE';
const ids = ['cover','liveBadge','avatar','username','displayName','channelLink','bio','streamTitle','liveStatus','viewers','subscribers','totalViews','videoCount','category','country','liveLikes','channelId','customUrl','streamId','categoryId','language','privacyStatus','startedAt','createdAt','rawJson'];
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

  els.username.textContent = c.customUrl || c.username || c.displayName || 'Unknown channel';
  els.displayName.textContent = c.displayName && c.displayName !== c.username ? c.displayName : '';
  els.channelLink.textContent = c.url || '';
  els.channelLink.href = c.url || '#';
  els.bio.textContent = c.bio || 'No public channel description returned.';
  els.streamTitle.textContent = c.isLive ? (c.title || 'Live now') : 'Channel is not currently live';
  els.liveStatus.textContent = c.isLive ? 'LIVE' : 'OFFLINE';
  els.viewers.textContent = c.isLive ? formatNumber(c.viewers) : '—';
  els.subscribers.textContent = c.hiddenSubscribers ? 'Hidden' : formatNumber(c.subscribers);
  els.totalViews.textContent = formatNumber(c.totalViews);
  els.videoCount.textContent = formatNumber(c.videoCount);
  els.category.textContent = c.category || '—';
  els.country.textContent = c.country || '—';
  els.liveLikes.textContent = c.isLive ? formatNumber(c.liveLikes) : '—';
  els.channelId.textContent = c.channelId || '—';
  els.customUrl.textContent = c.customUrl || '—';
  els.streamId.textContent = c.streamId || '—';
  els.categoryId.textContent = c.categoryId || '—';
  els.language.textContent = c.language || '—';
  els.privacyStatus.textContent = c.privacyStatus || '—';
  els.startedAt.textContent = formatDate(c.startedAt);
  els.createdAt.textContent = formatDate(c.createdAt);
  els.rawJson.textContent = JSON.stringify(payload.raw, null, 2);

  els.liveBadge.classList.toggle('hidden', !c.isLive);

  if (c.profilePicture) {
    els.avatar.src = c.profilePicture;
    els.avatar.style.visibility = 'visible';
  } else {
    els.avatar.removeAttribute('src');
    els.avatar.style.visibility = 'hidden';
  }

  const coverImage = c.thumbnail || c.profilePicture;
  els.cover.style.backgroundImage = coverImage ? `url("${String(coverImage).replace(/"/g, '%22')}")` : '';
}

async function lookup(value) {
  setLoading(true);
  setStatus('Checking YouTube channel and live-stream data…');
  result.classList.add('hidden');

  try {
    const response = await fetch(`/api/channel?channel=${encodeURIComponent(value)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to fetch YouTube channel');
    showChannel(payload);
    setStatus(`${payload.channel.isLive ? 'LIVE · ' : ''}Fetched ${payload.channel.displayName || payload.channel.username}.`);
    history.replaceState(null, '', `?channel=${encodeURIComponent(value)}`);
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

const initial = new URLSearchParams(location.search).get('channel') || DEFAULT_CHANNEL;
input.value = initial;
lookup(initial);