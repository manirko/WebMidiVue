import {createRealtimeElementarySynth} from './elementary/engine.mjs';
import {SOUNDS} from './elementary/timbres.mjs';
import {AUDITION_BANKS} from './auditionBanks.mjs';
import {blocksKeyboardNotes, noteForKeyboardCode, parseMidiMessage} from './core.mjs';
import {biotronVoiceLevel} from './biotronCalibration.mjs';
// The same raw-MIDI → voice path is exercised by the carried-over offline PCM tests.
export class MidiInputSession {
  constructor(engine, onState = () => {}, options = {}) {
    this.engine = engine; this.onState = onState; this.voiceLevel = options.voiceLevel || (() => 1); this.input = null;
  }
  onMessage(event) {
    const message = parseMidiMessage(event.data), source = this.input?.id || 'midi';
    if (message.type === 'note-on') this.engine.noteOn(source, message.channel, message.note, message.velocity, this.engine.context?.currentTime, this.voiceLevel(message));
    else if (message.type === 'note-off') this.engine.noteOff(source, message.channel, message.note);
    else if (message.type === 'pitch-bend') this.engine.pitchBend(source, message.channel, message.value);
    else if (message.type === 'panic') this.engine.panic();
    this.onState({message, count: this.engine.activeVoiceCount});
  }
}
export class SoundPlayer {
  constructor({onState = () => {}, onStatus = () => {}, createEngine = createRealtimeElementarySynth} = {}) {
    Object.assign(this, {onState, onStatus, createEngine});
    this.choices = [...SOUNDS.map((preset,i) => ({id: 'sound-' + i, label: preset.name, preset})),
      ...AUDITION_BANKS.flatMap(bank => bank.variants)];
    this.selected = this.choices[0].id; this.volume = 70; this.safe = false;
    this.engine = null; this.epoch = 0; this.held = new Map(); this.midiNotes = 0;
    this.channels = {plant: 0, light: 1}; this.presetTask = Promise.resolve(); this.timers = new Set(); this.nextTap = 0;
  }
  emit() {this.onState({audio: this.engine?.state || 'idle', voices: this.engine?.activeVoiceCount || 0,
    notes: [...this.held.values()].filter(held => this.engine?.pool.ledger.entries.get(held.voice)?.state === 'active').map(held => held.note),
    started: Boolean(this.engine)});}
  async start() {
    if (this.starting) return this.starting;
    const epoch = this.epoch;
    // This constructor and resume call are reached synchronously from a user gesture.
    if (!this.engine) this.engine = this.createEngine({volume: this.volume, quality: this.safe ? 'safe' : 'standard',
      preset: this.choices.find(c => c.id === this.selected).preset, onStateChange: () => {
        if (this.engine?.state !== 'running') this.panic(); this.emit();
      }});
    const engine = this.engine, resume = engine.resume();
    const task = (async () => {
      try {
        await Promise.all([resume, engine.ensureReady()]);
        if (epoch !== this.epoch || engine !== this.engine) return;
        if (engine.state !== 'running') throw Error('Audio is paused. Press Start listening to resume.');
        this.onStatus('Sound ready'); this.emit(); return engine;
      } catch (error) {
        if (engine === this.engine) {this.onStatus(error.message); this.emit();}
        if (error.name !== 'AbortError') throw error;
      }
    })();
    this.starting = task;
    try {return await task;} finally {if (this.starting === task) this.starting = null;}
  }
  async choose(id) {
    const entry = this.choices.find(c => c.id === id); if (!entry) throw Error('Unknown sound.');
    this.selected = id;
    this.presetTask = this.presetTask.catch(() => {}).then(async () => {
      await this.starting;
      if (this.engine?.ready && !this.engine.stopped) await this.engine.applyPreset(this.choices.find(c => c.id === this.selected).preset);
    });
    await this.presetTask;
  }
  setVolume(value) {this.volume = value; this.engine?.setVolume(value);}
  async setLimit(safe) {
    this.safe = safe;
    this.presetTask = this.presetTask.catch(() => {}).then(async () => {
      await this.starting;
      if (this.engine?.ready && !this.engine.stopped) await this.engine.setQuality(this.safe ? 'safe' : 'standard');
    });
    await this.presetTask; this.emit();
  }
  receive(data) {
    const engine = this.engine;
    if (!engine?.ready || engine.state !== 'running' || engine.stopped) return;
    const message = parseMidiMessage(data);
    if (message.type === 'note-on') this.midiNotes++;
    const session = new MidiInputSession(engine, () => this.emit(), {
      voiceLevel: m => biotronVoiceLevel(m, {lightChannel: this.channels.light, lightLevel: 0.08})
    });
    session.input = {id: 'biotron'}; session.onMessage({data});
  }
  async hold(id, note, current = () => true) {
    if (this.held.has(id)) return;
    const epoch = this.epoch, token = {note}; this.held.set(id, token);
    let engine;
    try {engine = await this.start();}
    catch (error) {if (this.held.get(id) === token) this.held.delete(id); this.emit(); throw error;}
    if (!engine || epoch !== this.epoch || this.held.get(id) !== token || !current()) {if (this.held.get(id) === token) this.held.delete(id); return;}
    token.voice = engine.noteOn('keys:' + id, 0, note, 98); this.emit();
  }
  release(id) {
    const held = this.held.get(id); if (!held) return;
    this.held.delete(id); this.engine?.noteOff('keys:' + id, 0, held.note); this.emit();
  }
  releaseKeyboard() {for (const id of this.held.keys()) this.release(id);}
  async tap(note) {
    const id = 'tap:' + this.nextTap++; await this.hold(id, note);
    if (!this.held.has(id)) return;
    const timer = setTimeout(() => {this.timers.delete(timer); this.release(id);}, 270); this.timers.add(timer);
  }
  async keyDown(event) {
    if (blocksKeyboardNotes(event)) return;
    const note = noteForKeyboardCode(event.code); if (note === null) return;
    event.preventDefault(); await this.hold(event.code,note);
  }
  keyUp(event) {if (this.held.has(event.code)) {event.preventDefault(); this.release(event.code);}}
  panic() {this.releaseKeyboard(); this.engine?.panic(); this.emit();}
  async stop() {
    this.epoch++; this.releaseKeyboard();
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    const engine = this.engine;
    if (!engine) {this.emit(); return;}
    await engine.stop();
    if (this.engine === engine) this.engine = null;
    this.onStatus('Sound stopped'); this.emit();
  }
}
