import {commandFrame, createCommands, settingValue, validatePreset, parsePreset} from './protocol.mjs';
import {applySettingsVector, buildSettingsQuery} from './readback.mjs';
import {parseSettingsResponse} from './readback.mjs';
import {builtinPresets, audibleHumanize} from './factory-presets.mjs';
import {needsFirmwareUpdate, parseVersionReply} from './firmware.mjs';
import {isBiotron} from './midi.mjs';
export class SettingsSession {
  constructor({onChange = () => {}, persist = async () => {}, timeout = 2500} = {}) {
    Object.assign(this, {onChange, persist, timeout});
    this.values = audibleHumanize(builtinPresets[0].data);
    this.input = this.output = null; this.version = ''; this.epoch = this.nonce = this.revision = 0;
    this.snapshotKnown = false; this.pendingPreset = false; this.message = 'Local preset — changes stay in this browser.';
  }
  get updateAvailable() {return Boolean(this.output && needsFirmwareUpdate(this.version));}
  get writable() {return Boolean(this.output && this.input && isBiotron(this.input) && isBiotron(this.output) && this.output.state !== 'disconnected' && this.input.state !== 'disconnected');}
  changed(message) {if (message !== undefined) this.message = message; this.onChange();}
  clearRequests() {
    clearTimeout(this.versionRequest?.timer); this.versionRequest = null;
    if (this.readRequest) {clearTimeout(this.readRequest.timer); this.readRequest.reject(Error('Biotron changed.')); this.readRequest = null;}
  }
  cancel() {this.epoch++; this.clearRequests(); this.version = ''; this.snapshotKnown = false; this.changed();}
  connectionChanged(input, output, outputIndex = 0) {
    if (this.input === input && this.output === output && this.outputIndex === outputIndex) return;
    this.cancel(); this.input = input; this.output = output; this.outputIndex = outputIndex;
    this.changed(this.writable ? 'Check saved settings to read Biotron.' : 'Local preset — changes stay in this browser.');
  }
  versionTimeout(outputId) {
    if (outputId !== this.output?.id) return;
    clearTimeout(this.versionRequest?.timer); this.versionRequest = null; this.version = ''; this.changed();
  }
  async check() {
    if (!this.writable) throw Error('Connect the Biotron input and output first.');
    if (this.readRequest) return this.readRequest.promise;
    const epoch = this.epoch, output = this.output;
    this.version = ''; clearTimeout(this.versionRequest?.timer);
    const versionRequest = {epoch, output, outputIndex: this.outputIndex};
    versionRequest.timer = setTimeout(() => {if (this.versionRequest === versionRequest) this.versionTimeout(output.id);}, this.timeout);
    this.versionRequest = versionRequest;
    const nonce = this.nonce = this.nonce % 127 + 1;
    const revision = this.revision;
    let resolve, reject;
    const promise = new Promise((yes,no) => {resolve = yes; reject = no;});
    const request = {nonce, epoch, output, revision, resolve, reject, promise};
    request.timer = setTimeout(() => {if (this.readRequest === request) {this.readRequest = null; reject(Error('Saved settings check timed out. Retry Check saved settings.'));}}, this.timeout);
    this.readRequest = request;
    this.changed('Reading Biotron settings…');
    try {
      // These are read-only queries, sent only by the explicit Check action.
      output.send(buildSettingsQuery(nonce));
      output.send([240,20,13,126,this.outputIndex,247]);
      const snapshot = await promise;
      if (epoch !== this.epoch) return false;
      if (!snapshot.valid) throw Error('Biotron has no valid saved settings.');
      const commands = createCommands(); applySettingsVector(commands, snapshot.values);
      const values = validatePreset(Object.fromEntries(Object.entries(commands).map(([key,c]) => [key,c.value])));
      this.snapshotKnown = true;
      if (!this.pendingPreset && revision === this.revision) this.values = values;
      this.changed(this.pendingPreset ? 'Biotron read; the local preset is unchanged. Send to device to apply it.' : snapshot.dirty ? 'Read Biotron settings. Its saved copy has pending changes.' : 'Biotron settings loaded.');
      return true;
    } catch (error) {
      if (epoch === this.epoch) this.changed(error.message);
      throw error;
    } finally {
      if (this.readRequest === request) {clearTimeout(request.timer); this.readRequest = null;}
    }
  }
  receive(data) {
    const read = this.readRequest;
    if (read && read.epoch === this.epoch && read.output === this.output) {
      const snapshot = parseSettingsResponse(data, read.nonce);
      if (snapshot) {clearTimeout(read.timer); this.readRequest = null; read.resolve(snapshot); return;}
    }
    const version = this.versionRequest;
    if (!version || version.epoch !== this.epoch || version.output !== this.output) return;
    const reply = parseVersionReply(data, version.outputIndex);
    if (reply !== null) {clearTimeout(version.timer); this.versionRequest = null; this.version = reply; this.changed();}
  }
  async edit(name, input) {
    const value = settingValue(name, input);
    if (this.values[name] === value) return false;
    const epoch = this.epoch, output = this.output, snapshotKnown = this.snapshotKnown;
    const next = {...this.values, [name]: value};
    // Complete browser persistence before a live write; failed saves must not reach MIDI.
    await this.persist(next);
    if (epoch !== this.epoch) return false;
    this.values = {...this.values, [name]: value}; this.revision++;
    if (snapshotKnown && this.snapshotKnown && this.writable && output === this.output) {
      output.send(commandFrame(name, value)); this.changed('Changed setting sent to Biotron.');
    } else {this.pendingPreset = true; this.changed('Local preset changed. Check saved settings, then Send to device.');}
    return true;
  }
  load(data) {
    const validated = typeof data === 'string' ? parsePreset(data) : validatePreset(data);
    this.values = {...this.values, ...validated}; this.revision++; this.pendingPreset = true;
    this.changed('Preset loaded in browser. Send to device to apply it.');
  }
  async send() {
    if (!this.writable || !this.snapshotKnown) throw Error('Check saved settings before sending.');
    const values = validatePreset(this.values), output = this.output, epoch = this.epoch;
    // Preserve the old ordering: all other settings precede plant tempo.
    for (const name of [...Object.keys(values).filter(name => name !== 'plantBpm'), 'plantBpm']) {
      if (epoch !== this.epoch || output !== this.output || !this.writable) throw Error('Biotron changed before sending finished.');
      output.send(commandFrame(name, values[name]));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (epoch !== this.epoch) return;
    this.pendingPreset = false; this.changed('Preset sent to Biotron.');
  }
}
