/* The world's daylight lock (see Daylight.tsx), in a module of its own: the layout is a server component and
   inlines it as a string, which it could not take from a client module. */

/** Inline, first thing in the world's layout: daylight before the first paint. */
export const daylightScript = `(function(){var d=document.documentElement;d.dataset.themeLock='1';d.dataset.theme='light';d.style.colorScheme='light'})()`
