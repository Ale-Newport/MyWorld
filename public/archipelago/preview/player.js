const click=id=>document.getElementById(id)?.click();
document.getElementById('player-map').onclick=()=>click('world-map');
document.getElementById('player-help').onclick=()=>click('help');
document.getElementById('player-awards').onclick=()=>window.dispatchEvent(new Event('player-awards'));
