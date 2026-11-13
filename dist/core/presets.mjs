export const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(Number(x)) ? Number(x) : a));
const defaults = {waveA:'triangle',waveB:'sine',mixB:.2,ratio:1,detune:4,attack:.015,decay:.4,sustain:.65,release:.35,cutoff:2200,resonance:.7,fm:0,fmRatio:2,noise:0,vibrato:4,vibratoRate:5,echo:.08,space:.12,delay:.24,drive:.08};
const make=(id,name,family,description,p)=>Object.freeze({id,name,family,description,...defaults,...p});
export const PRESETS = Object.freeze([
  make('warm','01 · First touch','Warm','A warm, immediate voice that makes a small touch feel clear.',{}),
  make('felt','02 · Felt keys','Warm','Soft, woody strikes with a short, close tail.',{attack:.004,decay:.24,sustain:.15,release:.2,cutoff:1450,mixB:.1}),
  make('velvet','03 · Velvet','Warm','A rounded, low light for slow, held gestures.',{waveB:'sawtooth',mixB:.16,cutoff:850,attack:.09,release:.8,detune:8,space:.2}),
  make('cello','04 · Copper string','Warm','A gently bowed, resonant string colour.',{waveA:'sawtooth',waveB:'triangle',mixB:.35,attack:.12,cutoff:1200,resonance:2,release:.55,vibrato:10}),
  make('glass','05 · Glass bells','Glass','Clear, bright overtones that bloom after each strike.',{waveA:'sine',ratio:2.01,mixB:.25,fm:1.8,fmRatio:2.7,attack:.003,decay:.65,sustain:.08,release:1.1,cutoff:9500,space:.23}),
  make('kalimba','06 · Little tines','Glass','A small metal pluck with a dry, friendly attack.',{waveA:'sine',ratio:3,mixB:.15,fm:.7,fmRatio:3.5,attack:.003,decay:.18,sustain:.06,release:.18,cutoff:4600,space:.08}),
  make('crystal','07 · Crystal choir','Glass','A floating, slightly detuned high shimmer.',{waveA:'sine',ratio:2,mixB:.35,detune:9,attack:.18,release:1.3,cutoff:6500,space:.28,vibrato:7}),
  make('water','08 · Water drops','Glass','A liquid, hollow strike with a rounded echo.',{waveA:'sine',fm:2.8,fmRatio:1.5,attack:.003,decay:.13,sustain:.02,release:.25,cutoff:2800,resonance:2.2,echo:.22,delay:.31}),
  make('flute','09 · Paper flute','Breath','A focused breath with a small, human wobble.',{waveA:'sine',waveB:'triangle',mixB:.12,noise:.035,attack:.07,release:.3,cutoff:3900,vibrato:11}),
  make('reed','10 · Ember reed','Breath','A dark reed that opens as the contact changes.',{waveA:'sawtooth',waveB:'triangle',mixB:.35,attack:.075,cutoff:1100,resonance:2.2,vibrato:22,release:.45}),
  make('air','11 · Air between us','Breath','An airy voice for unhurried shared gestures.',{waveA:'sine',noise:.11,attack:.2,release:1,cutoff:3200,space:.27,detune:10}),
  make('whistle','12 · Small bird','Breath','A clear, lively whistle with a fast trill.',{waveA:'sine',mixB:.06,attack:.01,release:.13,cutoff:7500,vibrato:34,vibratoRate:8,echo:.16,delay:.15}),
  make('sub','13 · Soft current','Electric','A compact, rounded bass that follows the hands.',{waveA:'triangle',ratio:.5,mixB:.4,cutoff:650,attack:.008,release:.17,space:0,echo:0,drive:.2}),
  make('rubber','14 · Rubber pulse','Electric','A bouncy, filtered pulse with a short finish.',{waveA:'square',waveB:'triangle',mixB:.3,cutoff:1200,resonance:3,attack:.004,decay:.14,sustain:.24,release:.14,drive:.18}),
  make('acid','15 · Citrus wire','Electric','A bright resonant line with a little grit.',{waveA:'sawtooth',waveB:'square',mixB:.18,cutoff:2600,resonance:3.6,attack:.005,release:.2,drive:.3,echo:.12}),
  make('fm','16 · Electric pearl','Electric','A clean digital key with a ringing centre.',{waveA:'sine',fm:3.2,fmRatio:2,ratio:2,mixB:.12,attack:.004,decay:.35,sustain:.16,release:.6,cutoff:5800,echo:.13}),
  make('horizon','17 · Slow horizon','Space','A wide, slow voice with a clear edge at the start.',{waveA:'triangle',waveB:'sawtooth',mixB:.26,detune:12,attack:.24,release:1.4,cutoff:1800,space:.29,echo:.15}),
  make('theremin','18 · Hand in the air','Space','A singing, exposed tone with expressive vibrato.',{waveA:'sine',mixB:.13,attack:.055,release:.4,vibrato:28,vibratoRate:5.5,space:.22}),
  make('orbit','19 · Orbiting light','Space','A hollow, glassy voice with a repeating glint.',{waveA:'sine',fm:1.2,fmRatio:1.4,ratio:1.5,mixB:.18,attack:.025,release:.9,echo:.3,delay:.36,space:.2}),
  make('night','20 · Goodnight','Space','A soft ending: dark, gentle, and close.',{waveA:'sine',waveB:'triangle',mixB:.15,cutoff:900,attack:.16,release:1.2,space:.26,vibrato:5}),
]);
export function validatePreset(p) {
  for(const k of ['waveA','waveB']) if(!['sine','triangle','sawtooth','square'].includes(p[k]))throw new Error(`Invalid waveform ${k}`);
  const ranges={mixB:[0,.5],ratio:[.5,4],detune:[-20,20],attack:[.003,2],decay:[.03,2],sustain:[0,1],release:[.03,3],cutoff:[80,12000],resonance:[0,16],fm:[0,4],fmRatio:[.5,6],noise:[0,.2],vibrato:[0,80],vibratoRate:[0,12],echo:[0,.35],space:[0,.3],delay:[.02,.75],drive:[0,.5]};
  for(const [k,[a,b]]of Object.entries(ranges))if(!Number.isFinite(p[k])||p[k]<a||p[k]>b)throw new Error(`${p.id}: ${k} is outside ${a}…${b}`);
  return p;
}
PRESETS.forEach(validatePreset);
// Reverb tail: 0.6 s at 0 % … 4.5 s at 100 %, exponential.
export const spaceDecay = x => .8*(6/.8)**clamp(x,0,1);
// Presets store send levels; the macros' send curves are .40·x^0.8 (Reverb) and .45·x^0.8 (Delay), so their inverse keeps each preset's level.
const sendAmount = (send,max) => clamp((send/max)**1.25,0,1);
export const macroDefaults = p => ({tone:.5,resonance:p.resonance,attack:p.attack,release:p.release,motion:p.vibrato,space:sendAmount(p.space,.6),echo:sendAmount(p.echo,.45),time:clamp(p.delay,.06,.9),drive:p.drive});
export const MACROS = [
  {id:'tone',name:'Tone',min:0,max:1,step:.01,displayScale:100,inputUnit:'percent',format:v=>`${Math.round(v*100)}%`},
  // Web Audio's lowpass Q is in dB: up to 16 dB is an audible, Ableton-like range (research 05.11, MDN); the voice compensates level.
  {id:'resonance',name:'Resonance',min:0,max:16,step:.1,unit:'dB',format:v=>`${v.toFixed(1)} dB`},
  {id:'attack',name:'Attack',min:.003,max:2,step:.001,log:true,displayScale:1000,inputUnit:'milliseconds',format:v=>`${Math.round(v*1000)} ms`},
  {id:'release',name:'Release',min:.03,max:3,step:.01,log:true,displayScale:1000,inputUnit:'milliseconds',format:v=>`${Math.round(v*1000)} ms`},
  {id:'motion',name:'Motion',min:0,max:80,step:1,unit:'ct',format:v=>`${Math.round(v)} ct`},
  // Reverb and Delay are macros, as in Ableton racks (Andrey 05.11 «невыразительные»): one knob moves the send, the tail or the
  // repeats, and their darkness together. Delay time glides the repeats like Delay's Repitch mode; there is no tempo to sync to.
  {id:'space',name:'Reverb',min:0,max:1,step:.01,displayScale:100,inputUnit:'percent',format:v=>`${Math.round(v*100)}%`},
  {id:'echo',name:'Delay',min:0,max:1,step:.01,displayScale:100,inputUnit:'percent',format:v=>`${Math.round(v*100)}%`},
  {id:'time',name:'Delay time',min:.06,max:.9,step:.001,log:true,displayScale:1000,inputUnit:'milliseconds',format:v=>`${Math.round(v*1000)} ms`},
  {id:'drive',name:'Drive',min:0,max:1,step:.01,displayScale:100,inputUnit:'percent',format:v=>`${Math.round(v*100)}%`},
];
