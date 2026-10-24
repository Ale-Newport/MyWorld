/** The Achievements dialog's rows, ready before the dialog is asked for.
 *
 * The rows are made once and kept; opening the dialog brings them up to date with `sync(view)` and writes only the text that changed
 * (nothing, most of the time), so opening is a showModal and no more. The markup is what it always was: <p><strong>✓ title</strong><small>description · n / m</small></p>.
 *
 * The ✓ and ○ markers are in none of the page's fonts. The first layout that meets them asks the system for a font, about ten
 * milliseconds each, and that layout used to be the click's. `warm()` does it once, under the loading cover: the dialog is laid out
 * off screen (never painted, one synchronous task) with both markers in its own styles, then put back exactly as it was.
 *
 * The elements are the caller's; `document` is only for making them. */
export function createAwardsList({dialog,list,document:doc=globalThis.document}){
 const rows=[];
 const make=()=>{const row=doc.createElement('p'),title=doc.createElement('strong'),description=doc.createElement('small');row.append(title,description);list.append(row);return {row,title,description,head:'',text:''};};
 return {
  /** `view` is gameplay.achievements.view(): [{title, description, progress, target, unlocked}]. */
  sync(view){
   for(let i=rows.length;i<view.length;i++)rows.push(make());
   while(rows.length>view.length)rows.pop().row.remove();
   for(let i=0;i<view.length;i++){
    const award=view[i],r=rows[i],head=(award.unlocked?'✓ ':'○ ')+award.title,text=award.description+' · '+Math.min(award.progress,award.target)+' / '+award.target;
    if(head!==r.head)r.title.textContent=r.head=head;
    if(text!==r.text)r.description.textContent=r.text=text;
   }
  },
  /** Builds the rows and pays the dialog's first layout now. */
  warm(view){
   this.sync(view);
   const probe=doc.createElement('p'),held=dialog.getAttribute('style');
   probe.innerHTML='<strong>✓ ○</strong><small> · 0 / 1</small>';list.append(probe);
   dialog.style.cssText='display:block;visibility:hidden;position:fixed;left:-9999px';
   void dialog.offsetHeight;
   // Back as it was: Blink writes a style attribute back from the CSSOM lazily, so it is asked for before it is removed (or style="" stays behind).
   if(held===null){dialog.hasAttribute('style');dialog.removeAttribute('style');}else dialog.setAttribute('style',held);
   probe.remove();
  },
  get count(){return rows.length;},
 };
}
