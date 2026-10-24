import {inheritPortfolioTheme} from './portfolio-theme.js';
inheritPortfolioTheme();
const click=id=>document.getElementById(id)?.click();
document.getElementById('player-map').onclick=()=>click('world-map');
document.getElementById('player-help').onclick=()=>click('help');
document.getElementById('player-awards').onclick=()=>window.dispatchEvent(new Event('player-awards'));
/* Inside the portfolio the way back is a client navigation of the host page,
   not a reload: the host owns the route change (and its cover). */
document.getElementById('player-home').onclick=e=>{if(parent===window||e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();parent.postMessage({type:'archipelago:navigate',href:'/'},location.origin);};
/* A mouse or a finger on one of the page's own buttons leaves no focus on it: Enter and Space belong to the world, and a button that kept
   focus would press itself again (the map, the help) every time the visitor interacts. A keyboard press (detail 0) keeps its focus and its ring.
   Capture phase: the button lets go before its own handler opens the map or the help, so they have nothing to hand focus back to. */
document.addEventListener('click',e=>{if(e.detail===0)return;const control=e.target.closest?.('#player-nav a,#player-nav button,#interact-action');if(control&&document.activeElement===control)control.blur();},true);
/* Pressed feedback on the frame of the press. A finger's :active waits until the browser knows the touch is no scroll (about 150 ms in Chrome), and
   a pointer's waits for style: [data-press] is on the button from pointerdown to pointerup, whatever the device. The touch buttons of the drive
   (#touch-controls) have their own, already instant. */
let pressed=null;
const letGo=()=>{if(pressed){delete pressed.dataset.press;pressed=null;}};
document.addEventListener('pointerdown',e=>{letGo();const button=e.target.closest?.('button:not(.atlas-pin),#player-nav a');if(e.button>0||!button||button.closest('#touch-controls')||button.disabled||button.getAttribute('aria-disabled')==='true')return;pressed=button;button.dataset.press='';},{capture:true,passive:true});
for(const type of ['pointerup','pointercancel','contextmenu','dragstart'])document.addEventListener(type,letGo,true);
addEventListener('blur',letGo);
