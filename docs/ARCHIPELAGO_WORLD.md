# /world · Archipiélago

`/world` renders the authored Archipelago from HelloWorld. The same-origin player lives in `public/archipelago`; its physics, driving controls, terrain, car/plane mode and World2 activities are copied byte-for-byte from HelloWorld. The route does not depend on a localhost editor server.

To update after editing and saving the world, run this **from HelloWorld**:

```sh
npm run publish:player -- ../Portfolio/public/archipelago
node tests/release.mjs ../Portfolio/public/archipelago
```

Commit the HelloWorld source before publishing, then commit the generated package in Portfolio. Do not patch the copied runtime manually. `release.json` records the source revision and hashes for all files, including the losslessly compressed world save. Models and source notices are shipped with the package.

The player starts in DRIVE, disables editor writes and keeps Escape within the game. Map, controls, achievements and a return link remain available. The React route provides an accessible text alternative. Static runtime files are excluded from React ESLint rules; their source is validated in HelloWorld.

Verified: production Next.js build, route lint, published-file hashes, world save/load, brush undo/redo, incremental terrain, World2 handling parity, Projects + lab interactions, tiled plaza, and six shoreline drives in both directions.
