<template>
  <div ref="visual" class="garden-visual" :class="{'garden-visual--expanded':expanded}" :role="expanded?'dialog':undefined" :aria-modal="expanded?'true':undefined" :aria-label="expanded?'Biotron visual fullscreen':undefined">
    <iframe ref="frame" src="/garden/scene.html" title="Garden Anomaly — drag to rotate" tabindex="-1" sandbox="allow-scripts allow-same-origin" @load="sync" />
    <span v-if="showDragHint" class="garden-drag-hint">Drag to explore</span>
    <button ref="expand" class="garden-expand" type="button" :aria-label="expanded?'Exit fullscreen':'Open visual fullscreen'" :title="expanded?'Exit fullscreen (Esc)':'Fullscreen'" @click="toggleFullscreen">
      <svg v-if="!expanded" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg>
      <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>
  </div>
</template>
<script>
export default {
  props:{stage:{type:String,default:'intro'}},
  data(){return {expanded:false,previousOverflow:null,showDragHint:true}},
  mounted(){
    this.listener=e=>{
      if(e.source!==this.$refs.frame?.contentWindow || e.origin!==location.origin)return;
      if(e.data?.type==='garden-rendered')this.sync();
      if(e.data?.type==='garden-interaction')this.showDragHint=false;
      if(e.data?.type==='garden-exit')this.closeFullscreen();
    };
    this.keyListener=e=>{if(this.expanded && e.key==='Escape'){e.preventDefault();this.closeFullscreen()}};
    window.addEventListener('message',this.listener);
    window.addEventListener('keydown',this.keyListener);
  },
  beforeUnmount(){
    window.removeEventListener('message',this.listener);
    window.removeEventListener('keydown',this.keyListener);
    if(this.expanded)this.restoreView()
  },
  watch:{stage(){this.sync()}},
  methods:{
    send(data){this.$refs.frame?.contentWindow?.postMessage({type:'biotron-preview',...data},location.origin)},
    sync(){this.send({state:['ready','revealed'].includes(this.stage)?'ready':this.stage==='calibrating'?'calibrating':'waiting'})},
    note(on,pitch,velocity){this.send(on?{noteOn:true,pitch,velocity}:{noteOff:true,pitch})},
    toggleFullscreen(){
      if(this.expanded){this.closeFullscreen();return}
      // Use the page viewport: native fullscreen transitions can trap input in embedded browsers.
      this.previousOverflow=document.body.style.overflow;
      document.body.style.overflow='hidden';this.expanded=true;
      this.$nextTick(()=>this.$refs.expand?.focus());
    },
    closeFullscreen(){this.restoreView()},
    restoreView(){this.expanded=false;if(this.previousOverflow!==null){document.body.style.overflow=this.previousOverflow;this.previousOverflow=null}this.$nextTick(()=>this.$refs.expand?.focus())}
  }
}
</script>
<style scoped>
.garden-visual{position:relative;width:100%;max-width:320px;aspect-ratio:1;justify-self:center;overflow:visible}
.garden-visual iframe{display:block;position:absolute;left:-10%;top:-10%;width:120%;height:120%;border:0;background:transparent;pointer-events:auto}
.garden-drag-hint{position:absolute;bottom:-18px;left:0;right:0;text-align:center;font-size:11px;color:#827b8d;pointer-events:none}.garden-visual--expanded .garden-drag-hint{bottom:24px}
.garden-expand{position:absolute;z-index:3;touch-action:manipulation;right:0;bottom:0;display:grid;place-items:center;width:44px;height:44px;border:1px solid rgba(82,73,110,.18);border-radius:50%;background:rgba(251,250,247,.88);color:#645a83;box-shadow:0 3px 14px rgba(48,39,99,.07);cursor:pointer;transition:background .18s,transform .18s}
.garden-expand:hover{background:#eeeaf4;transform:scale(1.06)}
.garden-expand:focus-visible{outline:2px solid #7663bc;outline-offset:3px}
.garden-expand svg{pointer-events:none;width:20px;height:20px;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.garden-visual--expanded{position:fixed;inset:0;z-index:10000;width:100%;height:100%;max-width:none;aspect-ratio:auto;background:#fbfaf7;overflow:hidden}
.garden-visual--expanded iframe{width:min(100vw,100dvh);height:min(100vw,100dvh);left:50%;top:50%;transform:translate(-50%,-50%)}
.garden-visual--expanded .garden-expand{position:fixed;pointer-events:auto;right:max(24px,env(safe-area-inset-right));top:max(24px,env(safe-area-inset-top));bottom:auto;background:#fbfaf7}
@media(max-width:640px){.garden-visual:not(.garden-visual--expanded){width:min(76vw,320px)}}
@media(prefers-reduced-motion:reduce){.garden-expand{transition:none}}
</style>
