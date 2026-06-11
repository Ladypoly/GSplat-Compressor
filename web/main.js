// GSplat Compressor — 100% client-side. Files never leave the browser;
// all compression runs locally via @playcanvas/splat-transform.
import {
  readFile, getInputFormat, processDataTable,
  writeFile, getOutputFormat,
  MemoryReadFileSystem, MemoryFileSystem, logger
} from '@playcanvas/splat-transform';
import { createGraphicsDevice } from 'playcanvas';

const $ = (id) => document.getElementById(id);

const state = {
  originalName: null,   // loaded file name
  originalBytes: null,  // Uint8Array of the loaded file
  count: null,          // input splat count
  origBlobUrl: null,    // blob URL feeding the original viewer
  previewBlobUrl: null, // blob URL feeding the result viewer
  outBytes: null,       // last compressed output
  outExt: null,         // output extension (.sog/.spz/.compressed.ply)
  savedPct: null
};

// Output format definitions. `viewable` = the SuperSplat viewer can render it
// directly; otherwise we transcode a compressed-PLY proxy for preview.
const FORMATS = {
  sog: { ext: '.sog', label: 'SOG' },
  compressed_ply: { ext: '.compressed.ply', label: 'Compressed PLY' },
  spz: { ext: '.spz', label: 'SPZ' }
};
// The SuperSplat viewer is fed blob: URLs (no extension), so it can only sniff
// PLY-family content reliably. Anything else is transcoded to a compressed-PLY
// proxy for preview.

const fmtInt = (n) => (n == null ? '—' : n.toLocaleString());
function fmtBytes(n) {
  if (n == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// ---- splat-transform library helpers ------------------------------------

// Lazily created shared GPU device (WebGPU) for SOG compression.
let _devicePromise = null;
const createDevice = () => {
  if (!_devicePromise) {
    const canvas = document.createElement('canvas');
    _devicePromise = createGraphicsDevice(canvas, { deviceTypes: ['webgpu'] });
  }
  return _devicePromise;
};

async function readTable(bytes, filename) {
  const rfs = new MemoryReadFileSystem();
  rfs.set(filename, bytes);
  return (await readFile({
    filename,
    inputFormat: getInputFormat(filename),
    options: {}, params: [], fileSystem: rfs
  }))[0];
}

async function writeBytes(dataTable, outFilename, options) {
  const wfs = new MemoryFileSystem();
  await writeFile({
    filename: outFilename,
    outputFormat: getOutputFormat(outFilename, options),
    dataTable, options, createDevice
  }, wfs);
  return wfs.results.get(outFilename);
}

const setBlob = (key, bytes) => {
  if (state[key]) URL.revokeObjectURL(state[key]);
  state[key] = URL.createObjectURL(new Blob([bytes]));
  return state[key];
};

// ---- viewer -------------------------------------------------------------

// settings.json lives at the site root; absolute URL so it resolves from the
// viewer's own (sub)directory and from any Pages base path.
const settingsUrl = new URL('viewer-settings.json', document.baseURI).href;
function viewerSrc(blobUrl) {
  // ?debug exposes getCameraState/setCameraState (camera sync); ?noanim stops
  // the intro orbit that would otherwise fight setCameraState.
  return `viewer/index.html?content=${encodeURIComponent(blobUrl)}` +
    `&settings=${encodeURIComponent(settingsUrl)}&debug&noanim`;
}

const enable = (id, on) => $(id).classList.toggle('disabled', !on);

// ---- compression progress (driven by splat-transform's logger) ----------
// The library reports determinate progress bars (decode/encode/SH iters) and
// numbered task scopes through the global logger. We surface the active task
// and its percentage in the compress status area.
let progressSink = null; // set while a compress run is in flight
logger.setRenderer({
  handle(e) {
    if (!progressSink) return;
    switch (e.kind) {
      case 'scopeStart': progressSink(e.name, null); break;
      case 'barStart': progressSink(e.name, 0); break;
      case 'barTick': progressSink(e.name, e.total ? e.current / e.total : null); break;
      case 'barEnd': progressSink(e.name, 1); break;
    }
  }
});

function startProgressUI() {
  const el = $('compressStatus');
  el.classList.remove('hidden', 'error');
  el.innerHTML = `
    <div class="progress">
      <div class="progress-head"><span class="loader-ring small"></span><span class="progress-label">Compressing locally…</span></div>
      <div class="progress-track"><div class="progress-fill"></div></div>
    </div>`;
  const label = el.querySelector('.progress-label');
  const track = el.querySelector('.progress-track');
  const fill = el.querySelector('.progress-fill');
  let last = '';
  // Direct DOM writes (no rAF): heavy steps block the main thread, so the
  // browser only repaints when work yields — at which point the latest value
  // is shown. Skipping rAF also keeps it working in backgrounded tabs.
  progressSink = (name, ratio) => {
    const pretty = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Working';
    const pct = ratio == null ? -1 : Math.round(ratio * 100);
    const key = `${pretty}|${pct}`;
    if (key === last) return;
    last = key;
    if (ratio == null) {
      track.classList.add('indeterminate');
      label.textContent = `${pretty}…`;
    } else {
      track.classList.remove('indeterminate');
      fill.style.width = `${pct}%`;
      label.textContent = `${pretty} · ${pct}%`;
    }
  };
}
const stopProgressUI = () => { progressSink = null; };

// ---- viewer mount with load animation -----------------------------------
// Show a spinner overlay while the splat decodes in the iframe, then fade the
// rendered view in once the SuperSplat viewer reports it's done.
function mountViewer(wrapId, iframeId, blobUrl) {
  const wrap = $(wrapId);
  const iframe = $(iframeId);
  wrap.classList.add('loading');
  wrap.classList.remove('ready');
  iframe.src = viewerSrc(blobUrl);
  watchViewerReady(iframe, () => {
    wrap.classList.remove('loading');
    wrap.classList.add('ready');
  });
}

function watchViewerReady(iframe, onReady, tries = 0) {
  let ready = false;
  try {
    const d = iframe.contentDocument;
    if (d && d.readyState === 'complete') {
      const lt = d.getElementById('loadingText');
      const canvas = d.querySelector('canvas');
      if (canvas && (!lt || lt.textContent.trim() === '100%')) ready = true;
    }
  } catch { /* cross-frame timing */ }
  if (ready) { onReady(); return; }
  if (tries < 250) setTimeout(() => watchViewerReady(iframe, onReady, tries + 1), 100);
  else onReady(); // reveal anyway after ~25s
}

// ---- step 1: load (local, no upload) ------------------------------------

const dropzone = $('dropzone');
const fileInput = $('fileInput');
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault(); dropzone.classList.remove('over');
  if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) loadFile(fileInput.files[0]); });

async function loadFile(file) {
  const info = $('loadInfo');
  info.classList.remove('hidden', 'error');
  info.textContent = `Reading ${file.name}…`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.originalName = file.name;
    state.originalBytes = bytes;

    // Read once to learn the splat count and to make a viewable preview.
    let dt;
    try {
      dt = await readTable(bytes, file.name);
    } catch (e) {
      throw new Error(`Couldn't read this splat file (${e.message || e}).`);
    }
    state.count = dt.numRows;

    // PLY / compressed-PLY render directly from a blob; transcode anything
    // else (SOG, SPZ, splat, ksplat, lcc) to a compressed-PLY proxy.
    info.textContent = `Preparing preview…`;
    const plyFamily = file.name.toLowerCase().endsWith('.ply');
    const origViewBytes = plyFamily ? bytes : await writeBytes(dt, 'orig.compressed.ply', {});

    info.innerHTML = `Loaded <b>${file.name}</b> · ${fmtBytes(bytes.length)} · ${fmtInt(state.count)} splats`;

    // Reset decimate, mount original viewer, reset review section.
    $('decimateSlider').value = 100;
    syncDecimateFromSlider();
    mountViewer('wrapOrig', 'viewerOrig', setBlob('origBlobUrl', origViewBytes));
    $('viewerResult').removeAttribute('src');
    $('wrapResult').classList.remove('loading', 'ready');
    $('stats').classList.add('hidden');
    $('resultNote').classList.add('hidden');
    $('downloadBtn').disabled = true;
    state.outBytes = null;

    enable('step-compress', true);
    enable('step-review', true);
    $('step-compress').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    info.classList.add('error');
    info.textContent = `Error: ${err.message}`;
  }
}

// ---- step 2: compress ---------------------------------------------------

const formatSel = $('format');
formatSel.addEventListener('change', syncFormatControls);
function syncFormatControls() {
  const f = formatSel.value;
  document.querySelector('.fmt-sog').classList.toggle('hidden', f !== 'sog');
  document.querySelector('.fmt-spz').classList.toggle('hidden', f !== 'spz');
}
syncFormatControls();

// decimate slider <-> target count (keep %).
const decimateSlider = $('decimateSlider');
const targetCount = $('targetCount');
function decimateReadout() {
  const keep = Number(decimateSlider.value);
  const est = state.count != null ? Math.max(1, Math.round((state.count * keep) / 100)) : null;
  $('currentCount').textContent = fmtInt(state.count);
  const r = $('decimateReadout');
  if (keep >= 100) r.textContent = state.count != null ? `Keep all · ${fmtInt(state.count)} splats` : 'Keep all';
  else r.textContent = est != null ? `Keep ${keep}% · ~${fmtInt(est)} splats` : `Keep ${keep}%`;
}
function syncDecimateFromSlider() {
  const keep = Number(decimateSlider.value);
  targetCount.value = state.count != null ? Math.max(1, Math.round((state.count * keep) / 100)) : '';
  decimateReadout();
}
function syncDecimateFromTarget() {
  if (state.count == null) return;
  let t = Number(targetCount.value);
  if (!isFinite(t) || t < 1) return;
  t = Math.min(t, state.count);
  decimateSlider.value = Math.max(1, Math.min(100, Math.round((t / state.count) * 100)));
  decimateReadout();
}
decimateSlider.addEventListener('input', syncDecimateFromSlider);
targetCount.addEventListener('input', syncDecimateFromTarget);
decimateReadout();

// A `decimate` process action: exact target count when known, else percentage.
function decimateAction() {
  const keep = Number(decimateSlider.value);
  if (keep >= 100) return null;
  if (state.count != null) {
    const t = Number(targetCount.value);
    if (isFinite(t) && t >= 1 && t < state.count) return { kind: 'decimate', count: Math.round(t), percent: null };
  }
  return { kind: 'decimate', count: null, percent: keep };
}

$('compressBtn').addEventListener('click', compress);

async function compress() {
  if (!state.originalBytes) return;
  const fmt = FORMATS[formatSel.value];

  startProgressUI();
  $('compressBtn').disabled = true;
  const started = performance.now();

  try {
    // Re-read from the original bytes so repeated runs are independent.
    let dt = await readTable(state.originalBytes, state.originalName);

    const actions = [];
    if ($('filterNan').checked) actions.push({ kind: 'filterNaN' });
    const h = $('harmonics').value;
    if (h !== '') actions.push({ kind: 'filterBands', value: Number(h) });
    const dec = decimateAction();
    if (dec) actions.push(dec);
    if (actions.length) dt = await processDataTable(dt, actions, { createDevice });

    const outCount = dt.numRows;
    const options = {};
    if (formatSel.value === 'spz') options.spzVersion = Number($('spzVersion').value);
    if (formatSel.value === 'sog') options.iterations = Number($('iterations').value) || 10;

    const outBytes = await writeBytes(dt, `out${fmt.ext}`, options);

    // Preview: compressed-PLY renders directly; SOG/SPZ get a compressed-PLY
    // proxy (the viewer can't sniff those from a blob URL).
    const isProxy = fmt.ext !== '.compressed.ply';
    const previewBytes = isProxy ? await writeBytes(dt, 'preview.compressed.ply', {}) : outBytes;

    const inSize = state.originalBytes.length;
    const outSize = outBytes.length;
    state.outBytes = outBytes;
    state.outExt = fmt.ext;
    state.savedPct = inSize > 0 ? (1 - outSize / inSize) * 100 : 0;

    showResult({
      label: fmt.label, isProxy,
      inSize, outSize, outCount, savedPct: state.savedPct,
      ratio: outSize / inSize, durationMs: performance.now() - started, previewBytes
    });
  } catch (err) {
    const status = $('compressStatus');
    status.classList.remove('hidden');
    status.classList.add('error');
    status.textContent = `Error: ${err.message || err}`;
  } finally {
    stopProgressUI();
    $('compressBtn').disabled = false;
  }
}

// ---- step 3 + 4: review & export ----------------------------------------

function showResult(d) {
  $('compressStatus').classList.add('hidden');
  const savedClass = d.savedPct >= 0 ? 'good' : 'bad';
  $('stats').classList.remove('hidden');
  $('stats').innerHTML = `
    <div class="stat"><span>Original</span><b>${fmtBytes(d.inSize)}</b></div>
    <div class="stat"><span>${d.label}</span><b>${fmtBytes(d.outSize)}</b></div>
    <div class="stat"><span>Saved</span><b class="${savedClass}">${d.savedPct.toFixed(1)}%</b></div>
    <div class="stat"><span>Ratio</span><b>${d.ratio.toFixed(3)}×</b></div>
    <div class="stat"><span>Splats</span><b>${fmtInt(d.outCount)}</b></div>
    <div class="stat"><span>Time</span><b>${(d.durationMs / 1000).toFixed(1)} s</b></div>
  `;

  $('resultCaption').textContent = `Result · ${d.label}`;
  const note = $('resultNote');
  mountViewer('wrapResult', 'viewerResult', setBlob('previewBlobUrl', d.previewBytes));
  if (d.isProxy) {
    note.classList.remove('hidden');
    note.textContent = `Preview shown as a PLY proxy (same splats as the ${d.label}).`;
  } else {
    note.classList.add('hidden');
  }

  $('downloadBtn').disabled = false;
  $('step-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// <original base>_<NN>pct<output ext>, e.g. "Rural Road_92pct.spz".
function downloadName() {
  const INPUT_EXTS = ['.compressed.ply', '.ply', '.sog', '.spz', '.splat', '.ksplat', '.lcc'];
  let base = state.originalName || 'splat';
  const lower = base.toLowerCase();
  const inExt = INPUT_EXTS.find((e) => lower.endsWith(e));
  if (inExt) base = base.slice(0, -inExt.length);
  const pct = state.savedPct != null ? `_${Math.round(state.savedPct)}pct` : '';
  return `${base}${pct}${state.outExt}`;
}

$('downloadBtn').addEventListener('click', () => {
  if (!state.outBytes) return;
  const url = URL.createObjectURL(new Blob([state.outBytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

// ---- camera sync between the two viewers --------------------------------
// Each viewer iframe exposes window.getCameraState()/setCameraState() (same
// origin, via the ?debug param). Leader/follower model: whichever view the
// user is actively driving (pointer down, or wheel within a short window) is
// the leader; each frame its camera is copied to the other. Only ever
// leader -> follower, so there's no feedback loop. A short lingering window
// after release keeps the follower tracking the orbit controller's inertia.
const cam = {
  orig: $('viewerOrig'),
  result: $('viewerResult'),
  leader: null,
  dragging: false,
  leaderUntil: 0
};
const LINGER_MS = 700;

const camRead = (k) => {
  try { return cam[k].contentWindow?.getCameraState?.() ?? null; } catch { return null; }
};
const camWrite = (k, s) => {
  try { cam[k].contentWindow?.setCameraState?.(s); } catch {}
};

for (const k of ['orig', 'result']) {
  cam[k].addEventListener('load', () => {
    try {
      const w = cam[k].contentWindow;
      // Hide the debug panel (we only enable ?debug for its camera API) and the
      // play/pause animation button (we force orbit mode, so it's irrelevant).
      const style = w.document.createElement('style');
      style.textContent = '#sse-debug-panel,#play,#pause{display:none !important;}';
      w.document.head.appendChild(style);
      // Track interaction to pick the leader (capture phase: fires before the
      // viewer's own canvas handlers).
      w.addEventListener('pointerdown', () => { cam.leader = k; cam.dragging = true; }, true);
      w.addEventListener('pointermove', () => {
        if (cam.dragging && cam.leader === k) cam.leaderUntil = performance.now() + LINGER_MS;
      }, true);
      const release = () => { if (cam.leader === k) { cam.dragging = false; cam.leaderUntil = performance.now() + LINGER_MS; } };
      w.addEventListener('pointerup', release, true);
      w.addEventListener('pointercancel', release, true);
      w.addEventListener('wheel', () => { cam.leader = k; cam.leaderUntil = performance.now() + LINGER_MS; }, { capture: true, passive: true });
    } catch {}
    // Viewers start in 'anim' mode (a synthesized intro orbit), which re-applies
    // its own pose every frame and blocks setCameraState. The 'r' (reset) key
    // goes through the viewer's input path to switch to interactive 'orbit'
    // mode AT the configured initial camera (eye-level, scene centre) — which
    // sticks. Retry until the API is ready.
    kickToOrbit(k);
  });
}

function kickToOrbit(k, tries = 0) {
  let done = false;
  try {
    const w = cam[k].contentWindow;
    if (w && typeof w.getCameraState === 'function') {
      const s = w.getCameraState();
      if (s && s.mode === 'orbit') {
        done = true;
      } else {
        const ev = { key: 'r', code: 'KeyR', keyCode: 82, bubbles: true };
        w.dispatchEvent(new KeyboardEvent('keydown', ev));
        w.document.dispatchEvent(new KeyboardEvent('keydown', ev));
      }
    }
  } catch {}
  if (!done && tries < 120) setTimeout(() => kickToOrbit(k, tries + 1), 100);
}

const camActiveLeader = () => {
  if (cam.dragging) return cam.leader;
  if (performance.now() < cam.leaderUntil) return cam.leader;
  return null;
};

function syncOnce() {
  if (!$('linkCams').checked) return;
  const leader = camActiveLeader();
  if (leader) {
    const s = camRead(leader);
    if (s) camWrite(leader === 'orig' ? 'result' : 'orig', s);
  } else if (!cam.leader) {
    const a = camRead('orig');
    if (a && a.mode === 'orbit') camWrite('result', a);
  }
}

// rAF for smoothness while visible; timer fallback for backgrounded tabs.
function camSyncTick() { syncOnce(); requestAnimationFrame(camSyncTick); }
requestAnimationFrame(camSyncTick);
setInterval(syncOnce, 100);
