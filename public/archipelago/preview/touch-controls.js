/* TOUCH CONTROLS — /world on a phone or a tablet (markup in index.html,
   look in player.css). The player page only: the studio has none of this
   markup and never binds it.

   Shown while the input mode is 'touch'. Inputs follows the last device
   used — a finger on the world, a key, the mouse, a pad — and this keeps
   body[data-input] on it (body[data-vehicle] says car or plane). A coarse
   primary pointer starts in touch mode, as /world2 does, so a phone shows
   its controls before the first touch; the first key, mouse move or pad
   button hides them again.

   Steering and throttle are not here: they are /world2's joystick on the
   ground around the car (runtime/touch-joystick.js, wired in Driving).
   These are the presses that have no gesture, each the same path as its
   key:
     JUMP                 SPACE's own press and release (VehicleInput):
                          a press hops, held the wheels stay raised, the
                          release lets them down. Two quick taps do not
                          fly — CAR / PLANE is there for that.
     BACK ON YOUR WHEELS  R's own action, so races keep their gate and the
                          plane or a car held by a run refuse it, as for R.
     CAR / PLANE          what SPACE twice does.
     the interact button  (#interact-action, shown by a prompt) E itself,
                          so it starts the activities as well.
   They act on pointerdown and let go on pointerup, pointercancel or lost
   capture: a hold is a hold, and a second finger can drive meanwhile (a
   tap made while another finger is down never becomes a click). A click
   no pointer made (a screen reader, a keyboard) acts as well. Whatever
   lets go of the keyboard lets go of JUMP: the map (main.js holdControls),
   a teleport or recovery (Driving.place), car ↔ plane, another device, a
   blur, a hidden tab, and the end of the drive. */
const $=id=>document.getElementById(id);
/** Binds the touch HUD to a drive; returns {release, dispose}, or null on a page without it. */
export function touchControls(driving){
 const body=document.body,ui=$('touch-controls');
 if(!ui||body.dataset.player!=='true'||body.classList.contains('studio-admin'))return null;
 const inputs=driving.inputs,jump=$('touch-jump'),vehicle=$('touch-vehicle'),recover=$('touch-recover'),undo=[];
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);undo.push(()=>target.removeEventListener(type,fn,options));};
 const subscribe=(events,name,fn)=>{events.on(name,fn);undo.push(()=>events.off(name,fn));};
 const enabled=button=>button.getAttribute('aria-disabled')!=='true';
 let jumpPointer=null;
 /** JUMP lets go: SPACE's own release (a no-op when the drive already let go of it). */
 const release=()=>{if(jumpPointer===null)return;jumpPointer=null;delete jump.dataset.pressed;driving.jumpButton(false);};
 /** Car or plane, and whether the car is free (a countdown, a project board or the plane hold it). */
 const refresh=()=>{
  const plane=driving.modes.isPlane,free=!plane&&driving.player.state==='default';
  body.dataset.vehicle=plane?'plane':'car';vehicle.setAttribute('aria-pressed',String(plane));
  jump.setAttribute('aria-disabled',String(!free));recover.setAttribute('aria-disabled',String(!free));vehicle.setAttribute('aria-disabled',String(driving.player.state==='locked'));
  if(!free)release();
 };
 const device=mode=>{body.dataset.input=mode;if(mode!=='touch')release();};
 if(matchMedia('(pointer: coarse)').matches)inputs.assumeTouch();
 device(inputs.mode);subscribe(inputs.events,'modeChange',device);
 subscribe(driving.modes.events,'change',()=>{release();refresh();});subscribe(driving.player.events,'stateChange',refresh);subscribe(driving.events,'placed',refresh);refresh();
 /** Whether a click on `button` is a pointer's own (already acted on at pointerdown): one is down on it, or lifted
  * from it a moment ago. A click with no pointer — a screen reader, a keyboard — acts by itself. */
 const pointerClick=button=>{const down=new Set();let until=0;listen(button,'pointerdown',e=>down.add(e.pointerId));const up=e=>{if(down.delete(e.pointerId))until=performance.now()+600;};for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(button,type,up);return ()=>down.size>0||performance.now()<until;};
 /** One-shot buttons: on pointerdown, or on a click no pointer made. */
 const press=(button,act)=>{const fromPointer=pointerClick(button);
  listen(button,'pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();if(enabled(button))act();});
  listen(button,'click',()=>{if(!fromPointer()&&enabled(button))act();});
 };
 press(recover,()=>driving.recoverButton());
 press(vehicle,()=>driving.toggleVehicle());
 // The interact button is the on-screen E: on a touch screen it sends the 'interact' action itself, so it starts the
 // activities as E does (main.js's click, kept for the mouse, reaches the World2 prompts and races only).
 const interact=$('interact-action'),use=()=>{inputs.pressTouchAction('interact');inputs.releaseTouchAction('interact');},interactPointer=pointerClick(interact);
 listen(interact,'pointerdown',e=>{if(inputs.mode!=='touch'||e.pointerType==='mouse')return;e.preventDefault();use();});
 listen(interact,'click',()=>{if(inputs.mode==='touch'&&!interactPointer())use();});
 const jumpPointerClick=pointerClick(jump);
 listen(jump,'pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();if(!enabled(jump)||jumpPointer!==null)return;jumpPointer=e.pointerId;jump.dataset.pressed='';try{jump.setPointerCapture(e.pointerId);}catch{/* already gone */}driving.jumpButton(true);});
 const lift=e=>{if(e.pointerId===jumpPointer)release();};
 for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(jump,type,lift);
 listen(jump,'click',()=>{if(!jumpPointerClick()&&enabled(jump)){driving.jumpButton(true);driving.jumpButton(false);}});
 // A long press must not select the label or open a menu: either would cancel the pointer and end a hold.
 for(const target of [ui,interact])listen(target,'contextmenu',e=>{if(inputs.mode==='touch')e.preventDefault();});
 listen(window,'blur',release);listen(document,'visibilitychange',()=>{if(document.hidden)release();});
 const dispose=()=>{release();undo.splice(0).forEach(f=>f());delete body.dataset.input;delete body.dataset.vehicle;};
 driving.bin.add(dispose);
 return {release,dispose};
}
