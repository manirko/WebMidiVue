export function div(val, by){
    return (val - val % by) / by;
}

export class SysExCommand {
    flag_device = [20, 13]

    name
    number_command;
    value;
    min_value;
    max_value;
    step;
    sendable;
    fold_function;

    set_value(value) {
        this.value = value
    }


    constructor({
                    name = null,
                    number_command = 0,
                    min_value = 0,
                    max_value = 126,
                    step = 1,
                    sendable = true,
                    custom_fold = null,
                }
    ) {
        if (number_command === null) throw "Number Command is null";

        this.name = name === null ? `Command number ${number_command}` : name

        this.number_command = number_command
        this.value = min_value;
        this.min_value = min_value;
        this.max_value = max_value;
        this.step = step;
        this.sendable = sendable

        if (custom_fold === null) {
            this.fold_function = (arr, val) => {arr.push(val % 127)}
        }
        else {
            this.fold_function = custom_fold
        }


    }

    toString() {
        return `{"name": "${this.name}", "value": ${this.value}, "params": {
            "number_command": ${this.number_command},
            "min_value": ${this.min_value},
            "max_value": ${this.max_value},
            "step": ${this.step},
            "default_value": ${this.default_value}
        }}`
    }

    toShortDict() {
        return {
            name: this.name,
            value: this.value
        }
    }

    check_params() {
        if (this.min_value > this.max_value) {
            return false;
        }
        if (this.value < this.min_value) {
            return false;
        }
        return this.value <= this.max_value;

    }

    sendToMidi(device, flag=this.flag_device) {
        if (!this.sendable) return;

        let sys_ex_message = [0xF0]

        if (!this.check_params()) return;

        sys_ex_message = sys_ex_message.concat(flag).concat(this.number_command)

        this.fold_function(sys_ex_message, this.value)

        sys_ex_message.push(0xF7);

        console.log(sys_ex_message);

        device.send(sys_ex_message)
    }

}

// Biotron v1.2.2-v1.2.5 used the short frame. v1.3.0 and later use the
// namespaced system frame. Keep both explicit: removing the short frame would
// force otherwise updatable old devices back to physical BOOT contacts.
export const BIOTRON_LEGACY_BOOT_MESSAGE = [0xF0, 0x0B, 0x7F, 0xF7]
export const BIOTRON_BOOT_MESSAGE = [0xF0, 0x0B, 0x14, 0x0D, 0x7F, 0xF7]

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

// Legacy synchronous helper used by existing device-setting pages. Keep its
// behavior unchanged here; the updater itself uses the non-blocking delay.
export function sleep(milliseconds) {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) { /* preserve existing command pacing */ }
}

async function waitForDisconnect(device, deadline, pollMs) {
    while (Date.now() < deadline) {
        if (device.state === 'disconnected') return true
        await delay(pollMs)
    }
    return device.state === 'disconnected'
}

export async function bootDevice(device, {
    timeoutMs = 5000,
    pollMs = 50,
    legacyWaitMs = 300,
} = {}) {
    if (!device) throw new Error('Connect Biotron before entering update mode.')
    if (device.state === 'disconnected') {
        throw new Error('Biotron is disconnected. Reconnect it and try again.')
    }

    await device.open()
    const deadline = Date.now() + timeoutMs

    device.send(BIOTRON_LEGACY_BOOT_MESSAGE)
    const legacyDeadline = Math.min(deadline, Date.now() + legacyWaitMs)
    if (await waitForDisconnect(device, legacyDeadline, pollMs)) return

    device.send(BIOTRON_BOOT_MESSAGE)

    // Web MIDI send() queues data. Keep the port open until USB disconnects;
    // closing it immediately can discard the SysEx on some host backends.
    if (await waitForDisconnect(device, deadline, pollMs)) return
    throw new Error('Biotron did not enter update mode. Keep it connected and retry once.')
}
