<template><div class="wake-volume"><div class="bars" aria-hidden="true"><span v-for="i in 32" :key="i" ref="bars" :class="{lit:i-1<=Math.round(value/150*31)}" /></div><input :id="id" :value="value" type="range" min="0" max="150" step="1" :aria-valuetext="`${value}%${value>100?' boost':''}`" @input="changed" @keydown="keyboard=true" @pointerdown="keyboard=false" /></div></template>
<script>
// Adapted from Wake Slider by David Haz / React Bits (2026).
// MIT + Commons Clause; full notice: /garden/REACT-BITS-LICENSE.md.
export default {
  props:{id:{type:String,required:true},value:{type:Number,required:true}},emits:['input'],
  data(){return{keyboard:false}},
  mounted(){this.head=this.value/150*100;this.speed=0;this.raf=0;this.last=0;this.reduce=matchMedia('(prefers-reduced-motion: reduce)');this.changedMotion=()=>this.settle();this.reduce.addEventListener('change',this.changedMotion);this.hidden=()=>this.settle();document.addEventListener('visibilitychange',this.hidden);this.paint()},
  beforeUnmount(){cancelAnimationFrame(this.raf);this.reduce?.removeEventListener('change',this.changedMotion);document.removeEventListener('visibilitychange',this.hidden)},
  watch:{value(){if(this.reduce?.matches||this.keyboard||document.hidden)this.settle();else if(!this.raf)this.raf=requestAnimationFrame(this.tick)}},
  methods:{
    changed(e){this.$emit('input',e)},
    settle(){cancelAnimationFrame(this.raf);this.raf=0;this.last=0;this.head=this.value/150*100;this.speed=0;this.paint()},
    paint(){const h=this.head/100*31,a=Math.min(1,Math.abs(this.speed)*.8/320),amp=this.reduce?.matches?0:a*a*(3-2*a),reach=1.5+3.5*amp,dir=Math.sign(this.speed)||1;(this.$refs.bars||[]).forEach((b,i)=>{const d=i-h,r=reach*(d*dir<0?1.45:.775),lift=Math.abs(d)<r?amp*Math.cos(Math.PI*d/(2*r))**2:0;b.style.transform=`scaleY(${.25+.55*lift})`})},
    tick(now){const dt=Math.min((now-(this.last||now-16))/1000,.032);this.last=now;const target=this.value/150*100,w=30,d=this.head-target,c=this.speed+w*d,decay=Math.exp(-w*dt);this.head=target+(d+c*dt)*decay;this.speed=(this.speed-w*c*dt)*decay;this.paint();if(Math.abs(this.head-target)>.015||Math.abs(this.speed)>.1)this.raf=requestAnimationFrame(this.tick);else this.settle()}
  }
}
</script>
<style scoped>.wake-volume{height:48px;position:relative;min-width:0}.bars{position:absolute;inset:0;display:flex;align-items:center;gap:3px;pointer-events:none}.bars span{flex:1;min-width:0;height:36px;border-radius:3px;background:#a9a6af;transform:scaleY(.25)}.bars span.lit{background:linear-gradient(#9484bd,#598fa5)}.wake-volume input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:ew-resize;touch-action:pan-y}.wake-volume:has(input:focus-visible){outline:2px solid #6a5acd;outline-offset:3px;border-radius:6px}</style>
