/** Editor thumbnails never run the gameplay ticker, so the sign scheduler never paints for them. Paint every layer
 * once, synchronously, with the title / URL / neighbour plates settled on the current project. */
export function paintProjectsPreview(projects){
 if(!projects)return;
 projects.paintNow();
 // Nothing will tick these canvases: release the scheduler so no listener keeps them alive.
 projects.settle?.();
}
