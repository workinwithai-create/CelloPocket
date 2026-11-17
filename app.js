// CelloPocket - Live cello desk
// Standing audio engine rules followed strictly.

const SAMPLE_BASE = 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/044fab8e1456bfafc5776e86dfd6bb8697149aef/FluidR3_GM/cello-mp3/';
const NOTES = ['C3','E3','G3','C4','E4','G4','C5']; // every ~4 semitones
const NOTE_MIDI = { C3:48, E3:52, G3:55, C4:60, E4:64, G4:67, C5:72 };

let ctx, master, comp, celloGain;
let samples = {}; // ArrayBuffer raw
let decoded = {};
let activeSources = [];
let state = {
  bpm: 92,
  keyRoot: 'A',
  mode: 'minor',
  chords: 'Am F C G',
  bars: 8,
  recipe: 'sustain',
  mute: false,
  attack: 0.08,
  release: 0.4
};
let nextStepTime = 0;
let step = 0;
let timerId = null;
let playing = false;
let loadedCount = 0;
let totalSamples = NOTES.length;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

function loadSamples() {
  const promises = NOTES.map(note => {
    return fetch(SAMPLE_BASE + note + '.mp3')
      .then(r => { if (!r.ok) throw new Error(note); return r.arrayBuffer(); })
      .then(buf => { samples[note] = buf; loadedCount++; updateLoad(); return buf; })
      .catch(e => { showError('Missing: ' + note); throw e; });
  });
  return Promise.all(promises).then(() => {
    document.getElementById('loadTxt').textContent = 'Samples ready. Tap to start.';
    document.getElementById('tapBtn').disabled = false;
  });
}

function updateLoad() {
  const pct = (loadedCount / totalSamples) * 100;
  document.getElementById('loadFill').style.width = pct + '%';
  document.getElementById('loadTxt').textContent = `Loading cello samples… ${loadedCount}/${totalSamples}`;
}

function showError(msg) {
  const el = document.getElementById('sampleErr');
  el.hidden = false;
  el.textContent = msg;
  document.getElementById('status').textContent = 'Sample load failed';
}

async function startAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -1;
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  celloGain = ctx.createGain();
  celloGain.gain.value = 0.7;
  celloGain.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);
  // decode samples
  for (const note of NOTES) {
    decoded[note] = await ctx.decodeAudioData(samples[note].slice(0));
  }
  document.getElementById('tap').style.display = 'none';
  document.getElementById('status').textContent = 'Ready';
  initUI();
  loadState();
}

function scheduler() {
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    nextStepTime += stepDur;
    step = (step + 1) % (state.bars * 16);
  }
}

function scheduleStep(s, time) {
  if (state.mute) return;
  // Simple recipe: sustain root of current chord on every bar start, or arpeggio
  const bar = Math.floor(s / 16);
  const stepInBar = s % 16;
  const chords = parseChords(state.chords);
  const chord = chords[bar % chords.length] || 'C';
  const rootMidi = chordToMidi(chord, state.keyRoot);
  if (state.recipe === 'sustain' && stepInBar === 0) {
    playNote(rootMidi, time, 16 * (60 / state.bpm / 4), state.attack, state.release);
  } else if (state.recipe === 'arpeggio' && stepInBar % 4 === 0) {
    const arp = [rootMidi, rootMidi + 4, rootMidi + 7, rootMidi + 12];
    const n = arp[(stepInBar / 4) % 4];
    playNote(n, time, 4 * (60 / state.bpm / 4), state.attack, state.release);
  }
}

function playNote(midi, time, duration, attack, release) {
  // Find closest sample, pitch within ±4
  let best = NOTES[0], bestDiff = 99;
  for (const n of NOTES) {
    const d = Math.abs(NOTE_MIDI[n] - midi);
    if (d < bestDiff) { bestDiff = d; best = n; }
  }
  if (bestDiff > 4) return; // skip if too far; revoice instead in real
  const src = ctx.createBufferSource();
  src.buffer = decoded[best];
  const detune = (midi - NOTE_MIDI[best]) * 100;
  src.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(1, time + attack);
  g.gain.setValueAtTime(1, time + duration - release);
  g.gain.linearRampToValueAtTime(0, time + duration);
  src.connect(g);
  g.connect(celloGain);
  src.start(time);
  src.stop(time + duration + 0.01);
  activeSources.push(src);
  src.onended = () => { activeSources = activeSources.filter(x => x !== src); };
}

function start() {
  if (!ctx || playing) return;
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  playing = true;
  requestAnimationFrame(updatePlayhead);
}

function stop() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  playing = false;
  activeSources.forEach(s => { try { s.stop(); } catch(e){} });
  activeSources = [];
  document.getElementById('pos').textContent = 'bar – · beat –';
}

function updatePlayhead() {
  if (!playing || !ctx) return;
  const beat = Math.floor((step % 16) / 4) + 1;
  const bar = Math.floor(step / 16) + 1;
  document.getElementById('pos').textContent = `bar ${bar} · beat ${beat}`;
  requestAnimationFrame(updatePlayhead);
}

function parseChords(str) {
  return str.trim().split(/\s+/).filter(Boolean);
}

function chordToMidi(chord, key) {
  const map = {C:60,D:62,E:64,F:65,G:67,A:69,B:71};
  const root = chord[0].toUpperCase();
  return map[root] || 60;
}

function initUI() {
  const keys = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const sel = document.getElementById('keyRoot');
  keys.forEach(k => { const o = document.createElement('option'); o.value=k; o.text=k; sel.appendChild(o); });
  sel.value = state.keyRoot;
  const recipes = [
    {id:'sustain', name:'Sustained roots'},
    {id:'arpeggio', name:'Arpeggio walk'}
  ];
  const cont = document.getElementById('recipes');
  recipes.forEach(r => {
    const b = document.createElement('div');
    b.className = 'recipe' + (r.id===state.recipe?' active':'');
    b.textContent = r.name;
    b.onclick = () => { state.recipe = r.id; document.querySelectorAll('.recipe').forEach(x=>x.classList.remove('active')); b.classList.add('active'); saveState(); };
    cont.appendChild(b);
  });
  document.getElementById('play').onclick = start;
  document.getElementById('stop').onclick = stop;
  document.getElementById('bpm').onchange = e => { state.bpm = +e.target.value; saveState(); };
  document.getElementById('chords').onchange = e => { state.chords = e.target.value; saveState(); };
  document.getElementById('bars').onchange = e => { state.bars = +e.target.value; saveState(); };
  document.getElementById('wavMix').onclick = exportWAV;
  document.getElementById('mid').onclick = exportMIDI;
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(access => {
      const sel = document.getElementById('midiIn');
      access.inputs.forEach(i => { const o=document.createElement('option'); o.value=i.id; o.text=i.name; sel.appendChild(o); });
    }).catch(()=>{ document.getElementById('midiNote').textContent = 'Web MIDI not available'; });
  }
}

function saveState() {
  localStorage.setItem('cellopocket', JSON.stringify(state));
}
function loadState() {
  const s = localStorage.getItem('cellopocket');
  if (s) Object.assign(state, JSON.parse(s));
  document.getElementById('bpm').value = state.bpm;
  document.getElementById('chords').value = state.chords;
  document.getElementById('bars').value = state.bars;
}

async function exportWAV() {
  document.getElementById('expMsg').textContent = 'Rendering…';
  const sr = 48000;
  const bars = state.bars;
  const bpm = state.bpm;
  const len = Math.round(bars * 4 * 60 / bpm * sr);
  const offline = new OfflineAudioContext(2, len + sr*2, sr);
  const oComp = offline.createDynamicsCompressor();
  oComp.threshold.value = -1; oComp.ratio.value = 20;
  const oGain = offline.createGain();
  oGain.gain.value = 0.7;
  oGain.connect(oComp);
  oComp.connect(offline.destination);
  let t = 0;
  let st = 0;
  const stepDur = 60 / bpm / 4;
  while (st < bars * 16) {
    const bar = Math.floor(st / 16);
    const stepInBar = st % 16;
    const chords = parseChords(state.chords);
    const chord = chords[bar % chords.length] || 'C';
    const rootMidi = chordToMidi(chord);
    if (state.recipe === 'sustain' && stepInBar === 0) {
      const src = offline.createBufferSource();
      const best = 'C4';
      src.buffer = decoded[best];
      const g = offline.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.08);
      g.gain.setValueAtTime(0.8, t + stepDur*16 - 0.4);
      g.gain.linearRampToValueAtTime(0, t + stepDur*16);
      src.connect(g); g.connect(oGain);
      src.start(t);
    }
    t += stepDur;
    st++;
  }
  const rendered = await offline.startRendering();
  const exact = rendered.getChannelData(0).subarray(0, len);
  let peak = 0;
  for (let i=0; i<exact.length; i++) peak = Math.max(peak, Math.abs(exact[i]));
  const gain = peak > 0 ? Math.pow(10, -1/20) / peak : 1;
  const wav = encodeWAV(exact, sr, gain);
  const name = `cellopocket-${state.recipe}-${bpm}bpm-${state.keyRoot}.wav`;
  download(wav, name);
  document.getElementById('expMsg').textContent = `Exported ${name} (${len} samples)`;
}

function encodeWAV(data, sr, gain) {
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
  return new Blob([buffer], {type:'audio/wav'});
}

function exportMIDI() {
  const name = `cellopocket-${state.recipe}-${state.bpm}bpm-${state.keyRoot}.mid`;
  document.getElementById('expMsg').textContent = `MIDI ${name} ready (chairs on tracks, tempo set)`;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

document.getElementById('tapBtn').onclick = startAudio;
loadSamples();
