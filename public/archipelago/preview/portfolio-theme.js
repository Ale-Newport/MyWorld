/** The player is a same-origin iframe: inherit the actual portfolio tokens
 * and its already cached font faces, including live theme edits. */
export function inheritPortfolioTheme(){
 if(parent===window)return;
 try{
  const source=getComputedStyle(parent.document.documentElement),target=document.body.style;
  for(const name of ['bg-primary','bg-secondary','bg-tertiary','text-primary','text-secondary','text-muted','border','border-strong','panel','panel-edge','panel-shadow','radius-card','accent','accent-deep','font-geist-sans','font-geist-mono']){
   const value=source.getPropertyValue('--'+name);if(value)target.setProperty('--'+name,value);
  }
  const faces=[];for(const sheet of parent.document.styleSheets){try{for(const rule of sheet.cssRules)if(rule.type===CSSRule.FONT_FACE_RULE)faces.push(rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g,(_,url)=>`url("${new URL(url,sheet.href??parent.document.baseURI).href}")`));}catch{/* cross-origin stylesheets are not readable */}}
  const style=document.createElement('style');style.textContent=faces.join('\n');document.head.append(style);
 }catch{/* Standalone player uses the matching stylesheet's fallback tokens. */}
}
