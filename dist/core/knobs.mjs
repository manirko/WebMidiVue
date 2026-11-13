import {clamp} from './presets.mjs';
export const toNormalized=(value,spec)=>spec.log?Math.log(clamp(value,spec.min,spec.max)/spec.min)/Math.log(spec.max/spec.min):(clamp(value,spec.min,spec.max)-spec.min)/(spec.max-spec.min);
export const fromNormalized=(value,spec)=>spec.log?spec.min*(spec.max/spec.min)**clamp(value,0,1):spec.min+clamp(value,0,1)*(spec.max-spec.min);
export const keyboardStep=(value,direction,fine,spec)=>clamp(value+direction*spec.step*(fine&&!Number.isInteger(spec.step)?.1:1),spec.min,spec.max);
export function quantize(value,spec,fine=false){const step=spec.step*(fine&&!Number.isInteger(spec.step)?.1:1);return clamp(Number((spec.min+Math.round((clamp(value,spec.min,spec.max)-spec.min)/step)*step).toFixed(9)),spec.min,spec.max);}
export function knob(spec,initial,onChange,onCommit=()=>{},edit={}) {
 const wrap=document.createElement('div');wrap.className='knob';wrap.dataset.control=spec.id;
 const label=document.createElement('label');label.textContent=spec.name;wrap.dataset.help=spec.help||`${spec.name}: drag vertically, use arrow keys, or edit the value. Double-click the knob to reset.`;
 const dial=document.createElement('input');dial.type='range';dial.min=0;dial.max=1000;dial.step=1;dial.id=`knob-${spec.id}`;dial.setAttribute('aria-label',spec.name);label.htmlFor=dial.id;
 const face=document.createElement('span');face.className='dial-face';face.setAttribute('aria-hidden','true');
 const control=document.createElement('span');control.className='dial-control';control.append(face,dial);
 const scale=spec.displayScale||1,offset=spec.displayOffset||0;
 const options=spec.options;
 const value=document.createElement(options?'select':'input');value.className='value-editor';value.setAttribute('aria-label',`${spec.name} value`);value.title=spec.help||spec.inputUnit||spec.name;
 if(options)options.forEach((name,i)=>value.add(new Option(name,String(spec.min+i*spec.step))));
 else{value.type='number';value.min=spec.min*scale+offset;value.max=spec.max*scale+offset;value.step=spec.step*scale;value.inputMode='decimal';value.hidden=true;}
 const readout=options?null:document.createElement('button');if(readout){readout.type='button';readout.className='value-display';readout.title='Click to edit';}
 const description=document.createElement('span');description.className='sr-only';description.id=`hint-${spec.id}`;description.textContent=wrap.dataset.help;dial.setAttribute('aria-describedby',description.id);value.setAttribute('aria-describedby',description.id);
 wrap.append(label,control);if(readout)wrap.append(readout);wrap.append(value,description);
 let current=initial,origin=null,modified=false,editStart=initial;
 const paint=(next,fine=false)=>{current=quantize(next,spec,fine);dial.value=String(Math.round(toNormalized(current,spec)*1000));wrap.style.setProperty('--turn',`${-135+toNormalized(current,spec)*270}deg`);const text=spec.format?spec.format(current):String(current);if(readout){readout.textContent=text;readout.setAttribute('aria-label',`${spec.name} value: ${text}. Edit value`);}if(options||document.activeElement!==value)value.value=String(options?current:Number((current*scale+offset).toFixed(3)));dial.setAttribute('aria-valuetext',text);return current;};
 const change=(next,fine=false)=>{const old=current;const v=paint(next,fine);if(v!==old){modified=true;onChange(v);}};
 const commit=()=>{if(modified){modified=false;onCommit(current);}};
 dial.addEventListener('input',()=>change(fromNormalized(Number(dial.value)/1000,spec)));
 dial.addEventListener('change',commit);
 dial.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();dial.focus();dial.setPointerCapture(e.pointerId);modified=false;origin={y:e.clientY,n:toNormalized(current,spec)};});
 dial.addEventListener('pointermove',e=>{if(origin)change(fromNormalized(origin.n+(origin.y-e.clientY)/(e.shiftKey?1600:160),spec),e.shiftKey);});
 dial.addEventListener('pointerup',()=>{if(origin){origin=null;commit();}});
 for(const event of ['pointercancel','lostpointercapture'])dial.addEventListener(event,()=>{origin=null;modified=false;});
 dial.addEventListener('dblclick',()=>{change(initial);commit();});
 dial.addEventListener('keydown',e=>{if(['Backspace','Delete'].includes(e.key)){e.preventDefault();change(initial);}else if(['Home','End'].includes(e.key)){e.preventDefault();change(e.key==='Home'?spec.min:spec.max);}else if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();change(keyboardStep(current,['ArrowUp','ArrowRight'].includes(e.key)?1:-1,e.shiftKey,spec),e.shiftKey);}});
 dial.addEventListener('keyup',e=>{if(['Backspace','Delete','Home','End','ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key))commit();});
 if(options)value.addEventListener('change',()=>{change(Number(value.value));commit();});
 else{
  const finish=()=>{if(value.value!==''&&Number.isFinite(Number(value.value)))change((Number(value.value)-offset)/scale);value.hidden=true;readout.hidden=false;paint(current);commit();};
  readout.addEventListener('click',()=>{edit.begin?.();editStart=current;readout.hidden=true;value.hidden=false;value.value=String(Number((current*scale+offset).toFixed(3)));value.focus();value.select();});
  value.addEventListener('input',()=>{const n=(Number(value.value)-offset)/scale;if(value.value!==''&&Number.isFinite(n)&&n>=spec.min&&n<=spec.max)change(n);});
  value.addEventListener('change',()=>{if(value.value!==''&&Number.isFinite(Number(value.value)))change((Number(value.value)-offset)/scale);commit();});
  value.addEventListener('blur',finish);
  value.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();value.blur();readout.focus();}else if(e.key==='Escape'){e.preventDefault();change(editStart);modified=false;value.value=String((editStart*scale)+offset);edit.cancel?.();value.blur();readout.focus();}});
 }
 const rename=name=>{spec.name=name;label.textContent=name;dial.setAttribute('aria-label',name);value.setAttribute('aria-label',`${name} value`);paint(current);};
 paint(initial);return {element:wrap,set:paint,rename,get value(){return current;}};
}
