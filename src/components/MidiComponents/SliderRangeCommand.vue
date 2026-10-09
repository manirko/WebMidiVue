<script>
import {SysExCommand} from "@/assets/js/SysExCommand"
import Slider from '@vueform/slider'
import HintComponent from "@/components/HintComponent.vue";

export default {
  components: {HintComponent, Slider},
  emits: ["input-changed"],
  props: {
    commandLabel: {
      default: "",
      type: String
    },
    minCommandObject: {
      required: true,
      type: SysExCommand
    },
    maxCommandObject: {
      required: true,
      type: SysExCommand
    },
    description: {
      type: String,
      required: false,
    }
  },
  data() {
    return {
      minValue: 0,
      maxValue: 0,
      values: [0, 0]
    }
  },
  methods: {
    changeEndpoint(index, command, event) {
      const value = event ? event.target.value : this.values[index]
      if (value === '' || !Number.isFinite(Number(value))) {
        this.values[index] = command.value
        if (event) event.target.value = command.value
        return
      }
      this.values[index] = Math.max(command.min_value, Math.min(command.max_value, Math.round(Number(value))))
      if (event) event.target.value = this.values[index]
      command.set_value(this.values[index])
      this.$emit('input-changed', command)
    },
    changed() {
      if (this.minCommandObject.value !== this.values[0]) {
        this.changeEndpoint(0, this.minCommandObject)
      }
      if (this.maxCommandObject.value !== this.values[1]) {
        this.changeEndpoint(1, this.maxCommandObject)
      }
    },
  },
  created() {
    this.minValue = this.minCommandObject.value;
    this.maxValue = this.maxCommandObject.value;
    this.values = [this.minCommandObject.value, this.maxCommandObject.value]
    if (this.minValue > this.maxValue) {
      this.minValue = this.maxValue
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
      <div class="row command-range-pair" style="margin-bottom: 10px">
        <div class="col">
          <input type="number" :aria-label="`${commandLabel} minimum`" class="form-control" @change="changeEndpoint(0, minCommandObject, $event)"
                 :value="this.values[0]" :min="this.minCommandObject.min_value" :max="this.minCommandObject.max_value" />
        </div>
        -
        <div class="col">
          <input type="number" :aria-label="`${commandLabel} maximum`" class="form-control" @change="changeEndpoint(1, maxCommandObject, $event)"
                 :value="this.values[1]" :min="this.minCommandObject.min_value" :max="this.maxCommandObject.max_value" />
        </div>
      </div>
      <div class="row">
        <Slider
            v-model="values"
            class="slider-blue"
            :tooltips="false"
            :aria="{'aria-label': `${commandLabel} range`}"
            :max="this.maxCommandObject.max_value"
            :min="this.minCommandObject.min_value"
            :step="this.minCommandObject.step"
            :lazy="false"
            @change="this.changed"
        />
      </div>

  </div>
</template>

<style scoped>
@import "@vueform/slider/themes/default.css";

.slider-blue {
  --slider-connect-bg: #3B82F6;
  --slider-handle-ring-color: #ffffff80;
  --slider-handle-bg: #0275ff;
}
</style>
