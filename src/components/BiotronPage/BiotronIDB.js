import {Db} from "@/assets/js/PresetsIDB";
import {SysExCommand} from "@/assets/js/SysExCommand";

const fold127 = (arr, val) => {
    for (let i = 0; i < Math.floor(val / 127); i++) arr.push(127)
    arr.push(val % 127)
}
const foldMinusOne = (arr, val) => { arr.push(val - 1) }

// key → [number_command, max_value, min_value, custom_fold]; omitted = SysExCommand defaults
// (max 127, min 0, sendable true). The key is the command name: save/load presets rely on it.
const BIOTRON_COMMANDS = {
    plantBpm: [0, 1000, 1, fold127], lightBpm: [9, 30], noteOffPercent: [12, 100],
    noteDistance: [1, 100], firstValue: [2, 100], smoothness: [3, 99], scale: [4],
    minPlantVelocity: [15], maxPlantVelocity: [5], minLightVelocity: [17], maxLightVelocity: [6],
    randomness: [10], same_note_plant: [11, 10], same_note_light: [24, 10], range_light_note: [13, 36],
    light_pitch_mode: [19], plant_no_velocity: [22], light_no_velocity: [23],
    randomPlantVelocity: [16], randomLightVelocity: [18], performance: [21],
    middle_plant_note: [25, 72, 60], plant_midi_channel: [[127, 0], 16, 1, foldMinusOne],
    light_midi_channel: [[127, 1], 16, 1, foldMinusOne], swing_first_note_percent: [26, 100, 1],
    button_mode_state: [27],
}
export let BiotronCommandsData = new Map(Object.entries(BIOTRON_COMMANDS).map(
    ([name, [number_command, max_value, min_value, custom_fold]]) => [name, new SysExCommand({
        name, number_command,
        ...(max_value !== undefined && {max_value}), ...(min_value !== undefined && {min_value}),
        ...(custom_fold && {custom_fold}),
    })]))


const fast_role_preset = {
    "plantBpm": 404,
    "lightBpm": 8,
    "noteOffPercent": 1,
    "noteDistance": 50,
    "firstValue": 10,
    "smoothness": 0,
    "scale": 3,
    "minPlantVelocity": 0,
    "maxPlantVelocity": 97,
    "minLightVelocity": 0,
    "maxLightVelocity": 68,
    "randomness": true,
    "same_note_plant": 0,
    "same_note_light": 0,
    "range_light_note": 12,
    "light_pitch_mode": 0,
    "plant_no_velocity": 0,
    "light_no_velocity": 0,
    "randomPlantVelocity": true,
    "randomLightVelocity": true,
    "performance": 0,
    "middle_plant_note": 60,
    "plant_midi_channel": 1,
    "light_midi_channel": 2,
    "swing_first_note_percent": 100,
    "button_mode_state": false,
}

const the_performer_mode = {
    "plantBpm": 404,
    "lightBpm": 2,
    "noteOffPercent": 2,
    "noteDistance": 50,
    "firstValue": 10,
    "smoothness": 0,
    "scale": 6,
    "minPlantVelocity": 8,
    "maxPlantVelocity": 97,
    "minLightVelocity": 0,
    "maxLightVelocity": 54,
    "randomness": false,
    "same_note_plant": 1,
    "same_note_light": 0,
    "range_light_note": 18,
    "light_pitch_mode": false,
    "plant_no_velocity": 0,
    "light_no_velocity": true,
    "randomPlantVelocity": true,
    "randomLightVelocity": true,
    "performance": true,
    "middle_plant_note": 60,
    "plant_midi_channel": 1,
    "light_midi_channel": 2,
    "swing_first_note_percent": 100,
    "button_mode_state": false,
}

const in_discussion = {
    "plantBpm": 404,
    "lightBpm": 2,
    "noteOffPercent": 1,
    "noteDistance": 50,
    "firstValue": 10,
    "smoothness": 0,
    "scale": 5,
    "minPlantVelocity": 44,
    "maxPlantVelocity": 97,
    "minLightVelocity": 0,
    "maxLightVelocity": 54,
    "randomness": false,
    "same_note_plant": 0,
    "same_note_light": 0,
    "range_light_note": 18,
    "light_pitch_mode": false,
    "plant_no_velocity": 0,
    "light_no_velocity": 0,
    "randomPlantVelocity": true,
    "randomLightVelocity": true,
    "performance": true,
    "middle_plant_note": 60,
    "plant_midi_channel": 1,
    "light_midi_channel": 2,
    "swing_first_note_percent": 100,
    "button_mode_state": false,
}

const mixolyd = {
    "plantBpm": 462,
    "lightBpm": 4,
    "noteOffPercent": 4,
    "noteDistance": 50,
    "firstValue": 10,
    "smoothness": 0,
    "scale": 4,
    "minPlantVelocity": 8,
    "maxPlantVelocity": 98,
    "minLightVelocity": 74,
    "maxLightVelocity": 75,
    "randomness": 0,
    "same_note_plant": 1,
    "same_note_light": 0,
    "range_light_note": 12,
    "light_pitch_mode": 0,
    "plant_no_velocity": 0,
    "light_no_velocity": true,
    "randomPlantVelocity": true,
    "randomLightVelocity": 0,
    "performance": true,
    "middle_plant_note": 60,
    "plant_midi_channel": 1,
    "light_midi_channel": 2,
    "swing_first_note_percent": 100,
    "button_mode_state": false,
}


const builtinPresets = [
    {data: mixolyd, name: "Mixolyd (Default)"},
    {data: fast_role_preset, name: "Fast role"},
    {data: the_performer_mode, name: "The Performer mode"},
    {data: in_discussion, name: "In Discussion"},
]
const audibleHumanize = data => ({...data,
    minPlantVelocity: Math.max(1, data.minPlantVelocity),
    minLightVelocity: Math.max(1, data.minLightVelocity),
})

export class BiotronDb extends Db {
    DB_NAME = "BiotronDB"
    STORE_NAME = "Biotron_Patches"
    VERSION = 10

    constructor() {
        super(BiotronCommandsData)
        this.ready = this.initialize(builtinPresets.map(preset => ({...preset, data: audibleHumanize(preset.data)})))
    }

    async getPatch(id) {
        const result = await super.getPatch(id)
        // Refresh only an exact old, locked factory preset when it is selected.
        // No database migration or write to a connected device; explicit user
        // zeros, edited/imported presets and live readback remain unchanged.
        const refresh = patch => {
            if (!patch || patch.editable) return patch
            const builtin = builtinPresets.find(preset => preset.name === patch.name)
            if (!builtin || Object.keys(patch.data || {}).length !== Object.keys(builtin.data).length ||
                !Object.entries(builtin.data).every(([key, value]) => patch.data[key] === value)) return patch
            return {...patch, data: audibleHumanize(patch.data)}
        }
        return Array.isArray(result) ? result.map(refresh) : refresh(result)
    }
}
