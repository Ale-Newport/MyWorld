import {ACCENT,ACCENT_SOFT,ACCENT_DEEP} from './portfolio/world2/signs/accent.js';

/** The player is a same-origin iframe: inherit the actual portfolio tokens
 * and its already cached font faces, including live theme edits. */
export function inheritPortfolioTheme(){
 const root=document.documentElement.style;
 /* The site's accent, as the host handed it to this frame (portfolio/world2/signs/accent.js): set on <html> so it is there in a standalone
    player too, and again on <body> below, over the copy of the host's tokens, so the CSS and the signs' canvases never disagree. */
 const accent=target=>{target.setProperty('--accent',ACCENT);target.setProperty('--accent-soft',ACCENT_SOFT);target.setProperty('--accent-deep',ACCENT_DEEP);};
 accent(root);
 if(parent===window)return;
 try{
  const source=getComputedStyle(parent.document.documentElement),target=document.body.style;
  for(const name of ['bg-primary','bg-secondary','bg-tertiary','text-primary','text-secondary','text-muted','border','border-strong','panel','panel-edge','panel-shadow','radius-card','accent','accent-deep','font-geist-sans','font-geist-mono']){
   const value=source.getPropertyValue('--'+name);if(value)target.setProperty('--'+name,value);
  }
  accent(target);
  const faces=[];for(const sheet of parent.document.styleSheets){try{for(const rule of sheet.cssRules)if(rule.type===CSSRule.FONT_FACE_RULE)faces.push(rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g,(_,url)=>`url("${new URL(url,sheet.href??parent.document.baseURI).href}")`));}catch{/* cross-origin stylesheets are not readable */}}
  const style=document.createElement('style');style.textContent=faces.join('\n');document.head.append(style);
 }catch{/* Standalone player uses the matching stylesheet's fallback tokens. */}
 inheritSafeArea();
}

/* THE SAFE AREA, FROM THE PAGE AROUND THE FRAME
   The world is drawn edge to edge, under a notch, the rounded corners and the home indicator; its buttons are not. A frame is
   never told the device's safe area (env(safe-area-inset-*) is 0 inside an iframe), so the host page measures its own
   (WorldRoute's [data-world-safe], padded by the four insets) and this copies the four lengths onto <html> as --safe-top,
   --safe-right, --safe-bottom and --safe-left, which the HUD's CSS keeps clear of (portfolio-theme.css). Read again whenever the
   frame changes size: turning the phone is what moves the notch. A frame opened on its own has no host to ask and keeps the
   stylesheet's own env() values. */
function inheritSafeArea(){
 let probe=null;
 try{probe=parent.document.querySelector('[data-world-safe]');}catch{return;}
 if(!probe)return;
 const root=document.documentElement.style,sides=['top','right','bottom','left'];
 const read=()=>{try{const cs=parent.getComputedStyle(probe);for(const side of sides)root.setProperty('--safe-'+side,cs.getPropertyValue('padding-'+side)||'0px');}catch{/* the host went away */}};
 /* The frame's own resize only: it fills the host's viewport, so a turn of the phone resizes it too, and nothing is left listening on
    the host's window once the frame is gone. */
 read();
 addEventListener('resize',read);
}
