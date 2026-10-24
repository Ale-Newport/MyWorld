/* The player's modules (public/archipelago/preview/*.js) are ES modules in a folder whose nearest package.json has no "type".
   Node runs them, but prints a warning for every file that it had to detect that. importPreview() imports one with exactly that
   warning (MODULE_TYPELESS_PACKAGE_JSON) held back, so the scripts that reuse the player's own code (the seed exporter, the model
   verifier) do not need `node --no-warnings`; every other warning is still printed. */
/** `specifier` is relative to this folder (scripts/world). */
export async function importPreview(specifier) {
  const emit = process.emitWarning
  process.emitWarning = function (warning, ...rest) {
    const code = typeof rest[0] === 'object' && rest[0] ? rest[0].code : rest[1]
    return code === 'MODULE_TYPELESS_PACKAGE_JSON' ? undefined : emit.call(process, warning, ...rest)
  }
  try { return await import(specifier) } finally { process.emitWarning = emit }
}
