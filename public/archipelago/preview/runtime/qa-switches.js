/** The URL switches that change how the engine runs. They exist for QA and for A/B comparison, not for visitors:
 *   ?shadow=legacy   the sun's old fixed shadow box, redrawn every frame, every merged mesh a caster
 *   ?shadow=post     the shadow rig reads its poses after the render (a frame late)
 *   ?fps=uncapped    lifts the 60 fps render cap
 *   ?freeze=off      every matrix stays live;  ?freeze=flags  matrices frozen but still walked
 *   ?ferris=meshes   the wheel's cabins as the 84 meshes they are
 *   ?terrain=whole   the coast as the one mesh it is
 *   ?surfaces=legacy the old 4-way subdivision of a conforming surface
 *   ?perf            the QA probe (runtime/perf-probe.js)
 * They are read only where QA runs: on localhost, or on a page opened with ?qa (which also exposes window.__archipelago).
 * A link a visitor was given, on the public host, cannot put the engine in another mode.
 * Pure: the page's own location is the default, a test hands it any other. */
const LOCAL=/^(localhost|127\.0\.0\.1|\[::1\])$/;
export function qaSwitches(search=globalThis.location?.search??'',hostname=globalThis.location?.hostname??''){
 const query=new URLSearchParams(search),qa=LOCAL.test(hostname)||query.has('qa'),is=(name,value)=>qa&&query.get(name)===value;
 return {qa,perf:qa&&query.has('perf'),legacyShadow:is('shadow','legacy'),postShadow:is('shadow','post'),uncapped:is('fps','uncapped'),freezeOff:is('freeze','off'),freezeFlags:is('freeze','flags'),ferrisMeshes:is('ferris','meshes'),terrainWhole:is('terrain','whole'),legacySurfaces:is('surfaces','legacy')};
}
