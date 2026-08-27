# Brand My 911

A site that sells the bodywork of a Porsche 911 as advertising space, one zone at a time, at a
fixed price, on a 3D car you can spin.

**82 panels. $135,000. That's the car.**

That line is the product. All 82 zones, at ask, add up to exactly $135,000 — the price of the
car, not a fundraising target somebody liked the sound of. It turns the progress bar into a
puzzle with a visible end, and it means no single price ever has to be defended on its own.

There is no side pot. An earlier cut carried six 8×7cm zones at $250 across the nose, ring-fenced
for running costs, on the theory that a board whose floor is $800 sits empty on day one. They
came out: at any camera distance a passer-by would actually use, they read as specks of dirt on
the bumper rather than as inventory, and their surface normals sat 45° off the bumper face because
that corner curls. Something too small to be read is too small to be sold. Losing them costs
$1,500 of running costs and buys back a claim that needs no asterisk — the sum of the board and
the price of the car are now the same number.

| Tier | Price | Zones | Subtotal |
|------|------:|------:|---------:|
| XXL  | $12,000 | 1  | $12,000 |
| XL   | $6,000  | 4  | $24,000 |
| L    | $3,000  | 10 | $30,000 |
| M    | $1,500  | 22 | $33,000 |
| S    | $800    | 45 | $36,000 |
| **Total** | | **82** | **$135,000** |

## Run it

Any static server; ES modules will not load over `file://`.

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

There are no build steps and no runtime dependencies — three.js is vendored in `vendor/three`.
Served this way the car, the board and the zone map all work; buying needs the API, which needs
`tools/dev-server.mjs` and the environment in `.env.example`.

```sh
node --test test/                 # the zone map's contract, including the $135,000 invariant
node tools/verify-zones.mjs       # every zone against the real model.glb, offline
node tools/build-placements.mjs   # re-bake placements after changing zones.js or model.glb
node tools/build-media.mjs        # regenerate media/index.html and media/zone-map.pdf
```

## How the zone map works

`zones.js` is the only place the map exists. It declares **rows** — a line across a panel, a
height, a probe direction — and the zones sitting on that line. Everything else is derived:

- `buildZones()` expands the rows into the flat 82-zone list, mirroring the left flank to the right.
- `tools/build-placements.mjs` fires each zone's probe ray at `model.glb`, fits a plane across
  the zone's own footprint, and writes the result to `placements.js`. That is `DEBUG_PICK` done
  82 times by machine, once, so no visitor pays for it.
- `viewer.js` reads the baked placement, cuts a real `DecalGeometry` out of the bodywork, and
  merges every zone on a panel into one buffer.

Coordinates are metres on the normalised car: **X** left −/right +, half-width ≈ 0.92 ·
**Y** ground 0, roof ≈ 1.29 · **Z** nose ≈ +2.25, tail ≈ −2.25. The viewer reproduces that
normalisation from the model's own bounding box, so the numbers in `zones.js` mean something.

To move a zone: edit its row in `zones.js`, then

```sh
node tools/build-placements.mjs && node tools/verify-zones.mjs && node --test test/
```

`verify-zones.mjs` samples each zone's real footprint on the mesh and fails if it hangs off the
bodywork, crosses a step, lands on glass it did not declare, touches a neighbour, or crosses a
keep-out — the number plates, the door handles, the wheel arches, the lights, the grilles and
the shut lines. Both checks pass today; keep them that way.

## Rendering 82 zones without it turning to noise

The geometry is the easy half. Four rules keep the car readable, all recomputed when the camera
changes rather than every frame:

1. **Panel focus.** The panel you are looking at renders at full opacity; every other panel
   sits back at 0.52 — quieter, but never invisible. In free spin, whichever panel most faces
   the camera wins.
2. **Labels decay by size, but never lose the size.** Above 58px of projected height a zone
   shows its tier, its centimetres and its price; above 24px, tier and centimetres; below
   that, the centimetres alone. Nothing is hover-only: a bidder should never have to touch a
   zone, or open the media kit, to find out how big it is.
3. **Zoom promotes.** Leaning in past 2.4m gives every zone in the focused panel one level
   back. That is how a crowded row stays readable without cluttering the wide shot.
4. **Hover and sold always win.** A hovered zone jumps to full. A sold zone shows its logo at
   full opacity in every view, because sold inventory is the best advertising the board has.

Markers are near-black plates with a white dashed border, not translucent grey: on silver
paint a grey plate disappears. A first visit lands on the whole car, turning slowly, rather
than on a detail.

Cost control: one merged `BufferGeometry` and one `ShaderMaterial` per panel, so 82 zones cost
six draw calls. Detail level is a UV rewrite into a shared label atlas; opacity is a per-vertex
float. Neither rebuilds geometry. There is no shadow map — a real one means drawing the whole
650k-triangle car twice per frame — and a painted contact shadow stands in. If frames still run
long, `pacePixels` lowers the render resolution rather than dropping zones, and restores it when
the pressure comes off.

## Layout

```
index.html          the auction
media/              media kit + zone-map.pdf   (generated — do not hand-edit)
zones.js            THE MAP. rows, tiers, keep-outs. every number here is load-bearing
placements.js       where each zone lands on model.glb (generated)
zone-frame.js       probe → surface → decal frame. shared by the viewer and the verifier
zone-atlas.js       every label, baked into one texture
viewer.js           three.js stage, decals, focus, decay, hover
app.js              buying, the 82-row board, the modal
config.js           keys, dates, the things you change without touching code
api/notify.js       outbid email (Resend)
tools/              mesh reader, offline raycaster, generators
test/               node --test
vendor/three/       three.js 0.160.0, MIT
```

## When something is not working

`GET /api/health` tells you what is configured and whether it works, without printing a
secret. It checks that Supabase accepts the service key and that the `purchases` table exists,
and it asks PayPal for a token — and if PayPal refuses, it quietly tries the *other*
environment and tells you if your credentials belong there instead.

That last one catches the most common failure by far:

```
PayPal auth failed: Client Authentication failed
```

means the key pair is not valid for the environment `PAYPAL_ENV` names. In order of likelihood:

1. **Live credentials with `PAYPAL_ENV=sandbox`, or the reverse.** They are separate key pairs
   from separate dashboards and neither works against the other. `/api/health` will name it.
2. **A trailing newline or space** from pasting into Vercel. The code trims now, but check the
   `warning` field in `/api/health` — it flags whitespace it had to strip.
3. **Client ID and Secret from different apps.** They only work as a pair.
4. **Account password used as the secret.** The secret is generated *under the app*, in the
   developer dashboard — it is not your PayPal login.

## Going live

1. Put your Supabase URL and anon key in `config.js`. Create a `bids` table and a `place_bid`
   RPC that validates the raise server-side — the client is not the referee.
2. Set `RESEND_API_KEY` for outbid emails (`api/notify.js`). Without it the endpoint no-ops.
3. Set `paypal.paypalMe`, and `endsAt` to the real close.
4. Replace the reach numbers in `config.js` and `tools/build-media.mjs` with ones you will
   actually honour, then re-run `node tools/build-media.mjs`. Every number on `/media` is a
   promise, so do not put one there you cannot keep.

Porsche® and 911® are trademarks of Dr. Ing. h.c. F. Porsche AG. This project is not
affiliated with Porsche. The 3D model is CC0 (Sketchfab).
