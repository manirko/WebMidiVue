<script>
import {SysExCommand} from "@/assets/js/SysExCommand";
import HintComponent from "@/components/HintComponent.vue";

export default {
  components: {HintComponent},
  emits: ['InputChanged'],
  props: {
    commandLabel: {
      default: "",
      type: String
    },
    listOfVariants: {
      default: {},
    },
    commandObject: {
      required: true,
      type: SysExCommand
    },
    description: {
      type: String,
      required: false,
    },
  },
  data() {
    return {
      Value: 0
    }
  },
  methods: {
    changed() {
      this.commandObject.set_value(this.Value)
      this.$emit('InputChanged', this.commandObject)
    }
  },
  mounted() {
    this.Value = this.commandObject.value;
  }
}
</script>

<template>
  <div class="row">
    <label>
      {{ this.commandLabel }}
      <HintComponent v-if="this.description" :text="this.description" />
    </label>

    <select v-model="this.Value" :aria-label="commandLabel" class="form-control" @change="changed">
      <option v-for="(item, index) in this.listOfVariants" v-bind:key="index" :value="index">
        {{item}}
      </option>
    </select>
  </div>
</template>

<style scoped>

</style>
