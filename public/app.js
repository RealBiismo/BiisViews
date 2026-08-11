const form = document.querySelector('#lookupForm');
const input = document.querySelector('#channelInput');
const button = document.querySelector('#lookupButton');
const statusEl = document.querySelector('#status');
const result = document.querySelector('#result');

const els = Object.fromEntries([
  'cover','liveBadge','avatar','username','verified','channelLink','bio','streamTitle',
  'liveStatus','viewers','followers','category','channelId','chatroomId','startedAt','rawJson'
].map(id => [id, document.getElementById(id)]));

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : String(value);
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
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
  const c = payload.channel;
  result.classList.remove('hidden');

  els.username.textContent = c.username || c.slug || 'Unknown channel';
  els.channelLink.textContent = c.url;
  els.channelLink.href = c.url;
  els.bio.textContent = c.bio || 'No public bio returned.';
  els.streamTitle.textContent = c.title || (c.isLive ? 'Live now' : 'Channel is offline');
  els.liveStatus.textContent = c.isLive ? 'LIVE' : 'OFFLINE';
  els.viewers.textContent = c.isLive ? formatNumber(c.viewers) : '—';
  els.followers.textContent = formatNumber(c.followers);
  els.category.textContent = c.category || '—';

  els.channelId.textContent = c.channelId ? `Channel ID: ${c.channelId}` : '';
  els.chatroomId.textContent = c.chatroomId ? `Chatroom: ${c.chatroomId}` : '';
  els.startedAt.textContent = c.startedAt ? `Started: ${formatDate(c.startedAt)}` : '';
  els.rawJson.textContent = JSON.stringify(payload.raw, null, 2);

  els.liveBadge.classList.toggle('hidden', !c.isLive);
  els.verified.classList.toggle('hidden', !c.verified);

  if (c.profilePicture) {
    els.avatar.src = c.profilePicture;
    els.avatar.style.visibility = 'visible';
  } else {
    els.avatar.removeAttribute('src');
    els.avatar.style.visibility = 'hidden';
  }

  if (c.thumbnail) {
    els.cover.style.backgroundImage = `url("${String(c.thumbnail).replace(/"/g, '%22')}")`;
  } else {
    els.cover.style.backgroundImage = '';
  }
}

async function lookup(value) {
  setLoading(true);
  setStatus('Contacting Kick…');
  result.classList.add('hidden');

  try {
    const response = await fetch(`/api/channel?slug=${encodeURIComponent(value)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to fetch channel');
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
