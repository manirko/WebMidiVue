<script>
import { SysExCommand } from "@/assets/js/SysExCommand"
import {toRaw} from "vue";
import HintComponent from "@/components/HintComponent.vue";
export default {
  components: {HintComponent},
  props: {
    commandLabel: {
      default: "",
      type: String
    },
    commandObject: {
      required: true,
      type: SysExCommand
    },
    tableValues: {
      required: false,
      type: Object
    },
    tableValuesReversed: {
      type: Boolean
    },
    slider_active: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      required: false,
    }
  },
  emits: ["InputChanged"],
  data() {
    return {
      rawValue: -1,
      maxValue: 0,
      minValue: 0,
      tableTranslate: null
    }
  },

  methods: {
    changed(event) {
      if (event.target.value === '' || !Number.isFinite(Number(event.target.value))) {
        this.rawValue = this.tableValues === undefined ? this.commandObject.value : this.tableTranslate.indexOf(String(this.commandObject.value))
        return
      }
      this.rawValue = Math.max(this.minValue, Math.min(this.maxValue, Math.round(Number(event.target.value))))
      if (this.tableValues !== undefined) {
        this.commandObject.set_value(parseInt(this.tableTranslate[this.rawValue]))
      }
      else {
        this.commandObject.set_value(this.rawValue)
      }
      this.$emit('InputChanged', this.commandObject)
    }
  },
  created() {
    if (this.tableValues !== undefined) {
      this.minValue = 0;
      this.tableTranslate = Object.keys(toRaw(this.tableValues));
      if (!this.tableTranslate.includes(String(this.commandObject.value))) this.tableTranslate.push(String(this.commandObject.value));
      this.tableTranslate.sort((a, b) => Number(a) - Number(b));
      if (this.tableValuesReversed) this.tableTranslate.reverse();
      this.maxValue = this.tableTranslate.length - 1;
      this.rawValue = this.tableTranslate.indexOf(String(this.commandObject.value));
    }
    else {
      this.rawValue = this.commandObject.value;
      this.maxValue = this.commandObject.max_value;
      this.minValue = this.commandObject.min_value;
    }
  }
}
</script>

<template>
  <div class="row">
    <label>
      {{ this.commandLabel }}
      <HintComponent v-if="this.description" :text="this.description" />
    </label>

    <div v-if="this.tableValues">
      <select v-model="this.rawValue" :aria-label="`${commandLabel} value`" class="form-control" @change="this.changed">
        <option v-for="(value, key) in this.tableTranslate" v-bind:key="key" :value="key">
          {{this.tableValues[parseInt(value)] ?? `Current value: ${value}`}}
        </option>
      </select>
    </div>
    <div v-else>
      <input type="number" :aria-label="`${commandLabel} value`" class="form-control"
             v-model="this.rawValue" :min="this.minValue" :max="this.maxValue"
             @change="this.changed($event)"/>
    </div>


    <input v-if="this.slider_active" type="range" :aria-label="`${commandLabel} slider`" class="settings_input"
           v-model="this.rawValue" :min="this.minValue" :max="this.maxValue"
           :step="this.commandObject.step"
           @change="this.changed($event)"/>
  </div>
</template>

<style scoped>
  .settings_input {
    width: 100%;
    min-height: 32px;
  }


</style>
