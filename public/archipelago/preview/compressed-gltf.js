/** The models are still ordinary GLBs for the studio; the player downloads
 * smaller gzip copies and decodes them before handing bytes to GLTFLoader. */
export async function loadCompressedGLB(loader, url, onProgress) {
 const response = await fetch(url);
 if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
 const total = Number(response.headers.get('content-length')) || 0;
 let loaded = 0;
 const source = response.body ?? new Blob([await response.arrayBuffer()]).stream();
 const stream = source.pipeThrough(new TransformStream({
  transform(chunk, controller) {
   loaded += chunk.byteLength;
   onProgress?.({ loaded, total });
   controller.enqueue(chunk);
  },
 })).pipeThrough(new DecompressionStream('gzip'));
 const bytes = await new Response(stream).arrayBuffer();
 return loader.parseAsync(bytes, new URL('.', new URL(url, location.href)).href);
}
