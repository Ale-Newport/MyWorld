import {paintProjectScreen} from './portfolio/world2/interactions/screenMotion.js';

/** Editor thumbnails never run the gameplay ticker. Paint a completed, coherent
 * first frame explicitly instead of freezing blank canvases mid-transition. */
export function paintProjectsPreview(projects){
 if(!projects)return;
 const screen=projects.screen;
 if(screen){const context=screen.canvas.getContext('2d');if(context){paintProjectScreen(context,screen.canvas.width,screen.canvas.height,projects.current,0);screen.texture.needsUpdate=true;}}
 for(const flip of projects.flips){
  const context=flip.canvas.getContext('2d');if(context){flip.paint(context,projects.current);flip.texture.needsUpdate=true;}
  flip.progress=1;flip.swapped=true;flip.pending=null;flip.inner.rotation.y=Math.PI*2;
 }
 projects.paintAttributes();projects.paintPagination();
}
