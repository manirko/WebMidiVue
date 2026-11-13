import {BUILD} from './version.mjs';
import {MidiSession} from './biotron/midi.mjs';
import {SettingsSession} from './biotron/settings.mjs';
import {mountSettings} from './biotron/settings-ui.mjs';
import {mountVolume} from './biotron/volume-ui.mjs';
import {mountKeyboard} from './biotron/keyboard-ui.mjs';
import {SoundPlayer} from './biotron/sound/player.mjs';
import {setupFeedback} from './biotron/feedback.mjs';
const $ = id => document.getElementById(id);
const status = text => { $('status').textContent = text; };
let keyboardUI;
const sound = new SoundPlayer({onState: state => {
  $('instrument').dataset.audio = state.audio;
  $('instrument').dataset.activeVoices = state.voices;
  keyboardUI?.render(state.notes);
  $('stop').disabled = !state.started;
}, onStatus: status});
let settingsUI;
const midi = new MidiSession({onMessage: data => {settings.receive(data); sound.receive(data);},
  onSilence: () => sound.panic(), onState: state => {
    settings.connectionChanged(state.input, state.output, state.outputIndex);
    for (const [id, ports, selected, empty] of [
      ['midi-input', state.inputs, state.input, 'Choose an input'],
      ['midi-output', state.outputs, state.output, 'Choose an output']
    ]) {
      const select = $(id);
      select.replaceChildren(new Option(empty, ''), ...ports.map(port => new Option(port.name || 'MIDI port', port.id)));
      select.value = selected?.id || '';
    }
    $('midi-status').textContent = state.message;
    $('connection-status').textContent = state.message; $('connect').title = state.message;
    if (state.input || state.status !== 'idle') status(state.message);
    settingsUI?.render();
  }});
const settings = new SettingsSession({onChange: () => {
  $('firmware-open').hidden = !settings.updateAvailable;
  sound.channels = {plant: settings.values.plant_midi_channel - 1, light: settings.values.light_midi_channel - 1};
  settingsUI?.render();
}});
settingsUI = mountSettings($('settings-content'), settings);
function openDialog(id) {
  keyboardUI.release();
  sound.releaseKeyboard();
  $('feedback-card').hidden = true; $('feedback-open').setAttribute('aria-expanded','false');
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $(id).showModal(); $(id + '-open').setAttribute('aria-expanded', 'true');
}
for (const id of ['help', 'settings']) {
  $(id).querySelector('[data-close]').addEventListener('click', () => $(id).close());
  $(id).addEventListener('close', () => $(id + '-open').setAttribute('aria-expanded', 'false'));
}
async function connect() {
  // Both permission requests begin in the click, before any asynchronous audio initialization.
  const permission = midi.connect();
  await Promise.all([permission, sound.start()]);
}
const attempt = fn => Promise.resolve().then(fn).catch(error => status(error.message));
$('connect').addEventListener('click', () => { void connect().catch(error => status(error.message)); });
$('midi-connect').addEventListener('click', () => { void midi.connect().catch(error => status(error.message)); });
$('settings-open').addEventListener('click', () => { openDialog('settings'); void midi.connect().catch(error => status(error.message)); });
$('help-open').addEventListener('click', () => openDialog('help'));
$('fullscreen').addEventListener('click', async () => {
  try {await (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());}
  catch (error) {status(error.message);}
});
document.addEventListener('fullscreenchange', () => {
  const label = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  $('fullscreen').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  $('fullscreen').setAttribute('aria-label', label); $('fullscreen').title = label;
});
for (const page of ['how', 'midi']) $(page + '-tab').addEventListener('click', () => {
  for (const tab of ['how', 'midi']) { $(tab + '-panel').hidden = tab !== page; $(tab + '-tab').setAttribute('aria-pressed', String(tab === page)); }
});
$('midi-input').addEventListener('change', event => { void midi.selectInput(event.target.value).catch(error => status(error.message)); });
$('midi-output').addEventListener('change', event => { void midi.selectOutput(event.target.value).catch(error => status(error.message)); });
$('stop').addEventListener('click', () => { keyboardUI.release(); void attempt(async () => { await Promise.all([sound.stop(), midi.pause()]); }); });
for (const entry of sound.choices) $('sound').add(new Option(entry.label, entry.id));
$('sound').value = '';
$('sound').addEventListener('change', event => { void sound.choose(event.target.value).catch(error => status(error.message)); });
mountVolume($('volume'), sound);
$('limit-four').addEventListener('change', event => { void sound.setLimit(event.target.checked).catch(error => status(error.message)); });
keyboardUI = mountKeyboard($('keyboard'), sound, status);
const pointers = new Set();
$('garden').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointers.add(event.pointerId); $('garden').setPointerCapture(event.pointerId);
  void sound.hold('pointer:' + event.pointerId, 64, () => pointers.has(event.pointerId)).catch(error => status(error.message));
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('garden').addEventListener(name, event => {pointers.delete(event.pointerId); sound.release('pointer:' + event.pointerId);});
$('garden').addEventListener('click', event => { if (event.detail === 0) void sound.tap(64).catch(error => status(error.message)); });
window.addEventListener('keydown', event => { void sound.keyDown(event).catch(error => status(error.message)); });
window.addEventListener('keyup', event => sound.keyUp(event));
window.addEventListener('blur', () => { pointers.clear(); keyboardUI.release(); sound.releaseKeyboard(); });
$('feedback-open').addEventListener('click', () => { const open = $('feedback-card').hidden; $('feedback-card').hidden = !open; $('feedback-open').setAttribute('aria-expanded', String(open)); if (open) $('feedback-comment').focus(); });
$('feedback-card').querySelector('.play-card-close').addEventListener('click', () => { $('feedback-card').hidden = true; $('feedback-open').setAttribute('aria-expanded', 'false'); $('feedback-open').focus(); });
window.addEventListener('keydown', event => {if (event.key === 'Escape' && !$('feedback-card').hidden) { $('feedback-card').hidden = true; $('feedback-open').setAttribute('aria-expanded','false'); }});
setupFeedback(BUILD, () => ({product: 'biotron', secureContext: isSecureContext,
  environment: {userAgent: navigator.userAgent, viewport: {width: innerWidth, height: innerHeight}},
  inputSelected: Boolean(midi.input), connection: midi.status, deviceNoteCount: sound.midiNotes,
  audioState: sound.engine?.state || 'idle', volume: sound.volume, sound: sound.selected,
  deviceControl: {settings: settings.values, version: settings.version, readback: settings.snapshotKnown ? 'known' : 'unknown'}}));
async function hide() {pointers.clear(); keyboardUI.release(); settings.cancel(); await Promise.all([midi.pause(), sound.stop()]);}
document.addEventListener('visibilitychange', () => { if (document.hidden) void hide().catch(error => status(error.message)); });
window.addEventListener('pagehide', () => { void hide().catch(error => status(error.message)); });
