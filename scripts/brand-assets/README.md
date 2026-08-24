# brand-assets

One-off tooling for `docs/branding/IMAGE_ASSETS.md`. Run by hand, a handful of times.
**Never imported by an app.** `sharp` is a native module and must never appear in
`frontend/package.json` or `seller-app/package.json`.

## Setup (once)

    cd scripts/brand-assets && npm install

## Workflow

1. Generate the image (ChatGPT UI, or the API — see IMAGE_ASSETS.md §6.1 / §6.8).
2. Save the download as `docs/branding/masters/<ID>.png`, e.g. `IMG-BRAND-001.png`.
3. Run:

       node postprocess.mjs IMG-BRAND-001        # one asset
       node postprocess.mjs --all                # everything present in masters/

Outputs land where `manifest.mjs` says. Size caps are asserted; the run FAILS
LOUDLY if an output is over budget rather than shipping a fat asset silently.

## Chroma key

If the model returns an opaque background instead of transparency, regenerate asking
for a flat pure-magenta `#FF00FF` field (see IMAGE_ASSETS.md §6.8) and add `--key`:

    node postprocess.mjs IMG-BRAND-001 --key

Magenta is chosen because the global negative string already bans magenta from every
subject, so no subject pixel can collide with the key colour.
