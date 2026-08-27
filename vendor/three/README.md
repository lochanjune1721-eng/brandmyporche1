# three.js, vendored

`three@0.160.0`, copied from npm, MIT licensed (see `LICENSE`). Only the four modules this
site actually imports are here, plus the one addon `GLTFLoader` depends on.

It is vendored rather than pulled from a CDN so the car renders on a locked-down network,
so a CDN outage cannot take the auction down mid-bid, and so the version can never drift
under a live sale. To move versions, replace these files and re-run
`node tools/build-placements.mjs`.
