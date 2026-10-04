import next from 'eslint-config-next'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

const spread = (c) => (Array.isArray(c) ? c : [c])

/** Flat config — ESLint 9 / eslint-config-next 16 native format. */
const config = [
  /* `.next-verify` is the escape-hatch dist dir a verification build
     writes to while a dev server holds `.next` (see next.config.ts's
     NEXT_DIST_DIR). Un-ignored, `eslint .` lints the compiled bundle:
     156 errors and 9,400 warnings from Turbopack's own output, which
     buries the handful that are actually about this repo's source. */
  /* Every dist dir, not two of them by name. `NEXT_DIST_DIR` takes an
     arbitrary value, so naming them one at a time guarantees the day
     someone builds to a third and `eslint .` reports twelve thousand
     errors out of compiled output — which has already happened once,
     with `.next-prod`. tsconfig's include list has the same shape of
     hole and the same fix. */
  { ignores: ['public/archipelago/**', '.next*/**', 'node_modules/**', 'out/**', '.qa/**', 'next-env.d.ts'] },
  ...spread(next),
  ...spread(nextCoreWebVitals),
  ...spread(nextTypeScript),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/no-unknown-property': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
  {
    /**
     * The render layer.
     *
     * `useFrame` and the Canvas2D draw loop are imperative escape
     * hatches that run outside React's render cycle by design:
     * mutating a retained buffer of instance matrices sixty times a
     * second is the entire point, and reallocating it would defeat
     * the optimisation these files exist to provide.
     *
     * The React Compiler's immutability rule doesn't model that, so
     * it is scoped off here — and only here. It stays on for every
     * component that actually participates in rendering.
     *
     * The compiler itself is NOT enabled (no `reactCompiler` in
     * next.config.ts), so nothing is being silently miscompiled. If
     * it is ever turned on, these two directories need `'use no
     * memo'` at the top of each file.
     */
    files: ['src/experience/**/*.tsx', 'src/components/project-visuals/**/*.tsx'],
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
    },
  },
]

export default config
