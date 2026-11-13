import {COMMANDS} from './protocol.mjs';
import {Presets} from './presets.mjs';
const SCALES = ['Major','Minor','Chrom','Dorian','Mixolydian','Lydian','Wholetone','Minblues','Majblues','Minpen','Majpen','Diminished','Hirajōshi'];
// Labels and groups from BiotronPageUpdated.vue; the wire ranges stay in COMMANDS.
const GROUPS = {
  'Plant sensor': [
    ['plant_no_velocity','🔇 Mute','switch'], ['plantBpm','🌱 The beat'], ['noteOffPercent','🎵 Note hold'],
    ['middle_plant_note','🏠︎ Home note'], ['scale','🎼 Scale','scale']
  ],
  'More fun': [
    ['plant_midi_channel','🎛️ MIDI channel'], ['button_mode_state','Biotron mute pad','switch'], ['swing_first_note_percent','Swing note'],
    ['randomPlantVelocity','🧍 Humanize','switch'], ['minPlantVelocity','💪 Note velocity · minimum'], ['maxPlantVelocity','💪 Note velocity · maximum'],
    ['randomness','📡 Input variation','switch'], ['performance','✋ Manual control','switch'], ['same_note_plant','🔂 Note repeat'],
    ['firstValue','🌞 Wake-up'], ['noteDistance','👣 Step size'], ['smoothness','⏳ Delay']
  ],
  'Light sensor': [
    ['light_no_velocity','🔇 Mute','switch'], ['randomLightVelocity','🧍 Humanize','switch'], ['light_pitch_mode','〜 Pitch bend','switch'],
    ['light_midi_channel','🎛️ MIDI channel'], ['lightBpm','🌞 Every N plant beats'], ['same_note_light','🔂 Note repeat'],
    ['minLightVelocity','🔨 Note velocity · minimum'], ['maxLightVelocity','🔨 Note velocity · maximum'], ['range_light_note','📏 Range']
  ]
};
export function mountSettings(root, session, storage) {
  root.innerHTML = '<div class="preset-tools"><label for="preset">Preset</label><select id="preset"></select><input id="preset-name" type="text" maxlength="80" aria-label="Preset name" placeholder="Preset name"><div class="preset-actions"><button id="preset-load">Load preset</button><button id="preset-save">Save preset</button><button id="settings-check">Check saved settings</button><button id="settings-send">Send to device</button></div></div><p id="settings-status" role="status"></p><div id="settings-fields"></div>';
  const $ = id => root.querySelector('#' + id), controls = new Map();
  let presets, list = [];
  function refreshPresets() {
    presets ||= new Presets(storage);
    list = presets.list(); $('preset').replaceChildren(...list.map((p,i) => new Option(p.name, i)));
  }
  try {refreshPresets();} catch (error) {session.message = error.message;}
  for (const [label, fields] of Object.entries(GROUPS)) {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'settings-group';
    const legend = document.createElement('legend'); legend.textContent = label; fieldset.append(legend);
    for (const [name, text, type] of fields) {
      const label = document.createElement('label'); label.className = 'setting'; label.htmlFor = 'setting-' + name;
      const caption = document.createElement('span'); caption.textContent = text; label.append(caption);
      const input = document.createElement(type === 'switch' || type === 'scale' ? 'select' : 'input');
      input.id = 'setting-' + name; input.dataset.setting = name;
      if (type === 'switch') input.append(new Option('Off',0), new Option('On',1));
      else if (type === 'scale') input.append(...SCALES.map((s,i) => new Option(s,i)));
      else {input.type = 'number'; input.min = COMMANDS[name].min; input.max = COMMANDS[name].max; input.step = 1;}
      input.addEventListener('change', () => {
        const raw = input.value;
        if (raw.trim() === '' || !Number.isFinite(Number(raw))) {render(); return;}
        const value = Math.max(COMMANDS[name].min, Math.min(COMMANDS[name].max, Math.round(Number(raw))));
        input.value = value;
        void run(() => session.edit(name, value));
      });
      controls.set(name, input); label.append(input); fieldset.append(label);
    }
    $('settings-fields').append(fieldset);
  }
  async function run(action) {try {await action();} catch (error) {session.changed(error.message);} render();}
  $('preset-load').addEventListener('click', () => {void run(() => {
    // Re-read storage on Load so a failed or damaged read cannot apply stale data.
    const index = Number($('preset').value); refreshPresets();
    if (!list[index]) throw Error('Choose another preset.');
    $('preset').value = index; session.load(list[index].data);
  });});
  $('preset-save').addEventListener('click', () => {void run(() => {
    presets ||= new Presets(storage);
    presets.save($('preset-name').value, session.values); refreshPresets(); $('preset').value = list.length - 1; session.changed('Preset saved in this browser.');
  });});
  $('settings-check').addEventListener('click', () => {void run(() => session.check());});
  $('settings-send').addEventListener('click', () => {void run(() => session.send());});
  function render() {
    for (const [name, input] of controls) {
      const value = String(session.values[name]);
      if (input.tagName === 'SELECT' && ![...input.options].some(option => option.value === value)) input.add(new Option(value,value));
      input.value = value;
    }
    $('settings-status').textContent = session.message;
    $('settings-check').disabled = !session.writable || Boolean(session.readRequest);
    $('settings-send').disabled = !session.writable || !session.snapshotKnown;
  }
  render(); return {render};
}
