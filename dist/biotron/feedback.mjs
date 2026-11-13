import {COMMANDS} from './protocol.mjs';
const STATE_FIELDS = Object.keys(COMMANDS);
// Receiver keeps the TouchMe schema; env.product survives its existing allowlist.
// Official contacts checked 06.11.2026: shop.playtronica.com/pages/get-in-touch and help.playtronica.com/site/contact/.
// Messenger recipients confirmed directly by Andrey in chat on 06.11.2026.
export const FEEDBACK_CONTACTS={whatsapp:'351937910673',telegram:'manirko',email:'support@playtronica.com'};
export function feedbackText(comment,details,include){
  return comment.trim()+(include?'\n\nTechnical details\n'+details:'');
}
const shorten=(text,limit)=>{const chars=[...text],notice='\n\n[Message shortened. Use Send feedback on the page for the full report.]';return chars.length>limit?chars.slice(0,limit-notice.length).join('')+notice:text;};
export function feedbackMail(build,text,email=FEEDBACK_CONTACTS.email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||'')?'mailto:'+email+'?subject='+encodeURIComponent('Biotron feedback · '+build)+'&body='+encodeURIComponent(shorten(text,6000)):null;
}
export function feedbackLink(channel,build,text,contacts=FEEDBACK_CONTACTS){
  const contact=contacts[channel];if(!contact)return null;
  if(channel==='email')return feedbackMail(build,text,contact);
  if(channel==='whatsapp'&&/^\d{8,15}$/.test(contact))return 'https://wa.me/'+contact+'?text='+encodeURIComponent(shorten(text,1500));
  if(channel==='telegram'&&/^[a-z][a-z0-9_]{4,31}$/i.test(contact))return 'https://t.me/'+contact+'?text='+encodeURIComponent(shorten(text,3000));
  return null;
}
const RATE_LIMIT_MESSAGE='Too many reports. Please try later or use another channel.';
export function feedbackFailure(error){
  return error?.message===RATE_LIMIT_MESSAGE?RATE_LIMIT_MESSAGE:'No confirmation received. Your comment is still here; try again or use another channel.';
}
export const FEEDBACK_ENDPOINT='https://playtron-reports.manirkocom.workers.dev/report';
export function feedbackPayload(build,comment,details,consent){
  if(!comment.trim())throw Error('Add a comment before sending.');
  if(!consent)throw Error('Allow the technical details to send this report.');
  const d=typeof details==='string'?JSON.parse(details):details;
  if(!d||typeof d!=='object')throw Error('The report is not ready. Please try again.');
  return {schema:'touchme-problem-report-v1',product:'biotron',build,consent:{technical:true,notice_version:'biotron-2026-11-13'},intent:{problem:'other',doing:'play-screen',text:comment.trim().slice(0,4000)},technical:{
    env:{product:'biotron',ua:d.environment?.userAgent,viewport:[d.environment?.viewport?.width,d.environment?.viewport?.height],secure:d.secureContext},
    midi:{selected:d.inputSelected,notes:d.deviceNoteCount,cc:d.lastCC?.number,connection:d.connection},
    audio:{state:d.audioState,volume:d.volume,stopped:d.soundStopped,baseLatency:d.audioLatency?.base,outputLatency:d.audioLatency?.output},
    sound:{name:d.sound},device:{...Object.fromEntries(STATE_FIELDS.filter(key=>Number.isInteger((d.deviceControl?.settings??d.preview?.draft)?.[key])).map(key=>[key,(d.deviceControl?.settings??d.preview?.draft)[key]])),readback:d.deviceControl?.readback||'unknown',firmware:d.deviceControl?.version||'unknown',keyMask:d.deviceControl?.keyMask,scaleMask:d.deviceControl?.scaleMask,pending:d.deviceControl?.queued||0},screen_device:Object.fromEntries(STATE_FIELDS.filter(key=>Number.isInteger(d.preview?.draft?.[key])).map(key=>[key,d.preview.draft[key]])),visual:{mode:d.hands?.mode},
    timeline:(d.actions||[]).slice(-40).map(type=>({type,t_ms:null})),
  }};
}
export function setupFeedback(build,report){
  const $=id=>document.getElementById(id),comment=$('feedback-comment'),include=$('feedback-details'),preview=$('feedback-preview'),result=$('feedback-result'),manual=$('feedback-copy-text');
  let sending=false;
  const details=()=>report();
  const text=()=>JSON.stringify(feedbackPayload(build,comment.value||'Preview',details(),true),null,2);
  const buttons=['feedback-submit','feedback-whatsapp','feedback-telegram','feedback-send','feedback-copy'].map($);
  const validate=()=>{for(const b of buttons)b.disabled=sending||!comment.value.trim()||!include.checked;};
  const showPreview=()=>{preview.value=text();};
  const clear=()=>{manual.hidden=true;manual.value='';result.textContent='';if(!preview.hidden)showPreview();validate();};
  $('feedback-open').addEventListener('click',()=>{validate();if(include.checked)details();});
  comment.maxLength=4000;comment.addEventListener('input',clear);include.addEventListener('change',()=>{clear();if(include.checked)details();});
  $('feedback-see').addEventListener('click',()=>{preview.hidden=!preview.hidden;$('feedback-see').setAttribute('aria-expanded',String(!preview.hidden));if(!preview.hidden)showPreview();});
  $('feedback-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(text());result.textContent='Feedback copied.';}
    catch{manual.hidden=false;manual.value=text();manual.focus();manual.select();result.textContent='Select this text and copy it.';}
  });
  for(const [channel,id]of [['whatsapp','feedback-whatsapp'],['telegram','feedback-telegram'],['email','feedback-send']]){
    const button=$(id);button.hidden=!feedbackLink(channel,build,'');
    button.addEventListener('click',()=>{
      if(!comment.value.trim()||!include.checked)return;
      const url=feedbackLink(channel,build,text());
      // Open during the click. Clipboard is a separate, explicit action (Andrey34006–34008).
      if(channel==='email')location.href=url;
      else if(!window.open(url,'_blank','noopener')){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent='Open '+button.textContent;result.replaceChildren(link);}
    });
  }
  $('feedback-submit').addEventListener('click',async()=>{
    if(sending)return;
    let payload;try{payload=feedbackPayload(build,comment.value,details(),include.checked);}catch(e){result.textContent=e.message;return;}
    sending=true;validate();result.textContent='Sending…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch(FEEDBACK_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      const receipt=await response.json();if(!response.ok||!receipt.ok||!/^PT-[2-9A-Z]{4}$/.test(receipt.id))throw Error(response.status===429?RATE_LIMIT_MESSAGE:'Not sent. Try again or use another channel.');
      result.textContent='Sent · '+receipt.id;comment.value='';
    }catch(e){result.textContent=feedbackFailure(e);}
    finally{clearTimeout(timer);sending=false;validate();}
  });validate();
}
