import {isSecondPort, withDeadline} from '../core/core.mjs';
export const isBiotron = port => /biotron/i.test(port?.name || '');
export const primaryPorts = ports => ports.filter(port => port.state !== 'disconnected' && !isSecondPort(port.name));
export function automaticInput(ports) {
  const named = primaryPorts(ports).filter(isBiotron);
  if (named.length === 1) return named[0];
  if (named.length === 2 && named[0].name === named[1].name && named[0].manufacturer === named[1].manufacturer) return named[0];
  return null;
}
const norm = text => (text || '').toLowerCase().replace(/midi(?:in|out)(?!2)/g, '').replace(/[^a-z0-9]/g,'');
export function pairedOutput(input, inputs, outputs) {
  if (!isBiotron(input)) return null;
  const same = p => isBiotron(p) && (!input.manufacturer || !p.manufacturer || p.manufacturer === input.manufacturer);
  const ins = primaryPorts(inputs).filter(same), outs = primaryPorts(outputs).filter(same);
  const exact = outs.filter(p => norm(p.name) === norm(input.name));
  const peers = ins.filter(p => norm(p.name) === norm(input.name));
  if (exact.length === peers.length && peers.includes(input)) return exact[peers.indexOf(input)];
  return ins.length === 1 && outs.length === 1 ? outs[0] : null;
}
export class MidiSession {
  constructor({request = options => navigator.requestMIDIAccess(options), onState = () => {}, onMessage = () => {}, onSilence = () => {}, timeout = 8000} = {}) {
    Object.assign(this, {request, onState, onMessage, onSilence, timeout});
    this.access = this.input = this.output = null;
    this.epoch = 0; this.enabled = false; this.status = 'idle'; this.owned = new Set(); this.opening = new Map(); this.closing = new Map();
    this.message = event => {if (this.enabled && event.currentTarget === this.input) this.onMessage(event.data);};
    this.changed = () => {if (this.enabled) void this.refresh().catch(error => this.emit('error', error.message));};
  }
  ports(type) {return primaryPorts([...(this.access?.[type].values() || [])]);}
  emit(status, message) {
    this.status = status;
    this.onState({status, message: message || (this.input ? `${this.input.name} connected` : 'Biotron not connected'), input: this.input, output: this.output,
      inputs: this.ports('inputs'), outputs: this.ports('outputs'), outputIndex: this.outputIndex});
  }
  get outputIndex() { return this.output ? [...this.access.outputs.values()].filter(p => isBiotron(p) && p.state !== 'disconnected').indexOf(this.output) : 0; }
  async connect() {
    if (this.connecting) return this.connecting;
    this.enabled = true;
    const epoch = ++this.epoch;
    const task = (async () => {
      this.emit('requesting', 'Allow MIDI and SysEx access.');
      if (!this.access) {
        const access = await withDeadline(this.request({sysex: true}), this.timeout);
        if (!this.enabled || epoch !== this.epoch) return;
        this.access = access; access.addEventListener('statechange', this.changed);
      }
      if (!this.enabled || epoch !== this.epoch) return;
      await this.refresh();
    })();
    this.connecting = task;
    try { await task; }
    catch (error) {if (epoch === this.epoch) this.emit('error', error.message); throw error;}
    finally {if (this.connecting === task) this.connecting = null;}
  }
  async closePort(port) {
    if (!this.owned.has(port)) return;
    if (this.closing.has(port)) return this.closing.get(port);
    // Disconnected Windows ports can hang Chrome on close (W07); detach them instead.
    if (port.state === 'disconnected') {this.owned.delete(port); return;}
    const task = Promise.resolve().then(() => port.close()).then(() => this.owned.delete(port));
    this.closing.set(port, task);
    try {await withDeadline(task, this.timeout);}
    finally {if (this.closing.get(port) === task) this.closing.delete(port);}
  }
  async openPort(port, epoch) {
    if (this.closing.has(port)) await withDeadline(this.closing.get(port), this.timeout);
    if (epoch !== this.epoch || !this.enabled) return false;
    if (port.connection === 'open' && !this.owned.has(port)) return true;
    if (this.opening.has(port)) throw Error('The previous MIDI connection is still opening. Reconnect the device.');
    this.owned.add(port);
    const task = Promise.resolve().then(() => port.open()).then(async () => {
      if (epoch !== this.epoch || !this.enabled || port.state === 'disconnected') {await this.closePort(port); return false;}
      return true;
    }).finally(() => this.opening.delete(port));
    this.opening.set(port, task);
    try {return await withDeadline(task, this.timeout);}
    catch (error) {if (epoch === this.epoch) this.epoch++; if (!this.opening.has(port)) await this.closePort(port); throw error;}
  }
  async releasePorts() {
    this.input?.removeEventListener('midimessage', this.message);
    this.input = this.output = null; this.onSilence(); this.emit('idle');
    const results = await Promise.allSettled([...this.owned].map(p => this.closePort(p)));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
  async refresh() {
    if (!this.enabled || this.selecting) return;
    if (this.input?.state === 'disconnected' || this.output?.state === 'disconnected') {
      this.epoch++; await this.releasePorts();
    }
    if (!this.enabled) return;
    if (!this.input) {
      const inputs = this.ports('inputs');
      const same = inputs.find(p => p.id === this.wantedInput);
      const input = same || (this.wantedInput === '' ? null : automaticInput(inputs));
      if (input) return this.selectInput(input.id, false);
    } else if (!this.output && this.wantedOutput !== '') {
      const output = pairedOutput(this.input, this.ports('inputs'), this.ports('outputs'));
      if (output) return this.selectOutput(output.id);
    }
    this.emit(this.input ? 'connected' : 'choose');
  }
  async selectInput(id, remember = true) {
    if (remember) this.wantedInput = id;
    if (this.input?.id === id && this.input.state !== 'disconnected') {this.emit('connected'); return;}
    const epoch = ++this.epoch; this.selecting = true;
    try {
      await this.releasePorts();
      const input = this.access?.inputs.get(id);
      if (!this.enabled || epoch !== this.epoch || !input || input.state === 'disconnected' || isSecondPort(input.name)) return;
      if (!await this.openPort(input, epoch) || epoch !== this.epoch) return;
      this.input = input; input.addEventListener('midimessage', this.message);
      this.wantedOutput = undefined;
      const output = pairedOutput(input, this.ports('inputs'), this.ports('outputs'));
      if (output && await this.openPort(output, epoch) && epoch === this.epoch) this.output = output;
      this.emit('connected');
    } finally {this.selecting = false;}
  }
  async selectOutput(id) {
    this.wantedOutput = id;
    if (this.output?.id === id && this.output.state !== 'disconnected') return;
    const epoch = ++this.epoch, old = this.output; this.output = null;
    this.emit(this.input ? 'connected' : 'choose');
    if (old) await this.closePort(old);
    const output = this.access?.outputs.get(id);
    if (!this.enabled || epoch !== this.epoch || !output || output.state === 'disconnected' || isSecondPort(output.name)) return;
    if (await this.openPort(output, epoch) && epoch === this.epoch) this.output = output;
    this.emit(this.input ? 'connected' : 'choose');
  }
  async pause() {this.enabled = false; this.epoch++; await this.releasePorts();}
  async dispose() {this.access?.removeEventListener('statechange', this.changed); await this.pause(); this.access = null;}
}
