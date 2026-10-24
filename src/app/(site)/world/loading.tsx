/* A loading boundary makes this dynamic route prefetchable up to the layout (Next:
   "a dynamic route is skipped unless it has a loading.js"), so `router.prefetch('/world')`
   warms the shell and the click needs no server round trip before the world can start.
   Nothing is drawn for it: the leaves are the screen, and the page's text is not visible. */
export default function Loading() {
  return null
}
