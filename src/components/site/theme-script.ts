/* The theme's first-paint script (see theme.ts), in a module of its own: the site's layout is a server component
   and inlines it as a string, which it could not take from a client module. */

export const THEME_KEY = 'theme'

/** Runs inline, first thing in the page: the stored choice, else the system's, written on <html>. */
export const themeScript = `(function(){var d=document.documentElement;if(d.dataset.themeLock)return;var t;try{t=localStorage.getItem('${THEME_KEY}')}catch(e){}if(t!=='light'&&t!=='dark')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t;d.style.colorScheme=t})()`
