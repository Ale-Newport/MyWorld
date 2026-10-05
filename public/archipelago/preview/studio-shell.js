/* The embedded studio's place in the admin (loaded only by the admin's
   studio.html, never by /world): two drawer buttons in the studio's
   header for narrow screens (the asset library and the inspector open
   over the viewport instead of squeezing it — see studio-theme.css),
   and a report to the admin whenever the world holds edits that have
   not been saved, so the admin's header can say so and warn before
   leaving. */
const body=document.body,header=document.querySelector('header');
const toggle=(cls,label,place)=>{const b=document.createElement('button');b.type='button';b.className='studio-drawer-toggle';b.textContent=label;b.setAttribute('aria-expanded','false');b.addEventListener('click',()=>{const on=!body.classList.contains(cls);body.classList.remove('show-library','show-inspector');body.classList.toggle(cls,on);document.querySelectorAll('.studio-drawer-toggle').forEach((x)=>x.setAttribute('aria-expanded',String(x===b&&on)));});place(b);return b;};
if(header){toggle('show-library','Library',(b)=>header.prepend(b));toggle('show-inspector','Properties',(b)=>header.querySelector('.top-right')?.prepend(b)??header.append(b));}
// Escape, or a click into the viewport, closes an open drawer.
addEventListener('keydown',(e)=>{if(e.key==='Escape'&&(body.classList.contains('show-library')||body.classList.contains('show-inspector'))){body.classList.remove('show-library','show-inspector');document.querySelectorAll('.studio-drawer-toggle').forEach((x)=>x.setAttribute('aria-expanded','false'));}});
document.getElementById('world')?.addEventListener('pointerdown',()=>{if(matchMedia('(max-width: 980px)').matches)body.classList.remove('show-library','show-inspector');});
/* Unsaved edits: the editor writes its state into the status line
   ("CHANGES NOT SAVED" / "LOCAL WORLD · SAVED", editor.updateHistory);
   following that line means no hook into the editor's internals. */
const status=document.getElementById('world-status');
let last=null;const report=()=>{const dirty=/NOT SAVED/i.test(status?.textContent??'');if(dirty===last)return;last=dirty;if(parent!==window)parent.postMessage({type:'archipelago:dirty',dirty},location.origin);};
if(status)new MutationObserver(report).observe(status,{childList:true,characterData:true,subtree:true});
