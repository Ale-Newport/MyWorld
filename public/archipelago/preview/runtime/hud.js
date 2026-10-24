/* THE VISITOR'S HUD — what is on the glass, written the frame it changes and never because a frame came.
   main.js asks every frame what the HUD should say; this keeps what it said last and touches the page
   only when the answer is different, so a frame with nothing new costs no style and no layout:

   - the activity text (headline · clock · lines · notice) is a few spans; the clock is a role=timer
     element (aria-live off), so a screen reader hears "Gate 2/5" and "Cone down" but not a clock that
     moves sixty times a second. The text a reader of the page gets (textContent) is the same line as ever;
   - the interact button is shown and hidden on the frame its prompt starts and ends, and its label is
     written only when it changed (nothing at all while it is hidden);
   - the speed readout is looked at ten times a second and written only when its two digits differ.

   Nothing here reads the layout. The elements are the caller's; `document` is only for making spans. */
const SEPARATOR=' · ',SPEED_EVERY=100;
export function createHud({panel,action,readout,document:doc=globalThis.document}){
 let shape=null,clock=null,clockText='',label=null,digits=null,looked=-Infinity;
 const span=(text,timer)=>{const s=doc.createElement('span');s.textContent=text;if(timer){s.setAttribute('role','timer');s.setAttribute('aria-live','off');}return s;};
 return {
  /** The activity text. `h` is what the activities report: {headline, timer, lines, notice?}. */
  text(h){
   const head=h.headline||'',timer=h.timer||'',rest=[...h.lines,h.notice?.title].filter(Boolean).join(SEPARATOR),key=head+'\u0001'+(timer?'T':'')+'\u0001'+rest;
   if(key!==shape){
    shape=key;clock=null;clockText='';
    const nodes=[],add=node=>{if(nodes.length)nodes.push(doc.createTextNode(SEPARATOR));nodes.push(node);};
    if(head)add(span(head));
    if(timer){clock=span(timer,true);clockText=timer;add(clock);}
    if(rest)add(span(rest));
    panel.replaceChildren(...nodes);
   }else if(clock&&timer!==clockText){clockText=timer;clock.firstChild.nodeValue=timer;}
  },
  /** The interact button: `prompt` is what the world offers ('' or undefined for nothing), `touch` leaves the " · E" key hint off. */
  prompt(prompt,touch){
   const next=prompt?prompt+(touch?'':SEPARATOR+'E'):'';
   if(next===label)return;
   label=next;action.hidden=!next;if(next)action.textContent=next;
  },
  /** The speed in km/h, at most ten times a second and only when it reads differently. */
  speed(kmh,now){
   if(now-looked<SPEED_EVERY)return;looked=now;
   const next=String(Math.round(kmh)).padStart(2,'0');
   if(next!==digits){digits=next;readout.textContent=next;}
  },
  /** Everything off the glass (a drive that ended): the next frame writes what is true. */
  clear(){panel.replaceChildren();action.hidden=true;shape=clock=label=digits=null;clockText='';looked=-Infinity;},
 };
}
