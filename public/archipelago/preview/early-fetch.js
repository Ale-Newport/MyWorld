/** Files the page's inline script (index.html) asked for while the module graph was still downloading, keyed by absolute URL.
 * A consumer takes the pending response instead of asking again; a file nobody started is simply fetched. */
const early=globalThis.__archipelagoEarly??{};
const absolute=url=>new URL(url,document.baseURI).href;
export function fetchEarly(url,init){
 const key=absolute(url),hit=early[key];
 if(!hit)return fetch(url,init);
 delete early[key];
 // A request that failed on its own is asked for again, as it would have been without the head start.
 return hit.catch(()=>fetch(url,init));
}
/** One of the two files the release names ('world' or 'assets'). The inline script starts them as soon as the release answers,
 * before the module graph has run, and says which URL it started: a release that names another URL is fetched afresh. */
export function fetchReleaseFile(kind,url,init){
 const pending=early['release:'+kind];
 if(!pending)return fetch(url,init);
 delete early['release:'+kind];
 return pending.then(hit=>hit&&hit.url===absolute(url)?hit.response:fetch(url,init),()=>fetch(url,init)).then(response=>response,()=>fetch(url,init));
}
