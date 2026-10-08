import {inheritPortfolioTheme} from './portfolio-theme.js';
inheritPortfolioTheme();
const click=id=>document.getElementById(id)?.click();
document.getElementById('player-map').onclick=()=>click('world-map');
document.getElementById('player-help').onclick=()=>click('help');
document.getElementById('player-awards').onclick=()=>window.dispatchEvent(new Event('player-awards'));
/* Inside the portfolio the way back is a client navigation of the host page,
   not a reload: the host owns the route change (and its cover). */
document.getElementById('player-home').onclick=e=>{if(parent===window||e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();parent.postMessage({type:'archipelago:navigate',href:'/'},location.origin);};
