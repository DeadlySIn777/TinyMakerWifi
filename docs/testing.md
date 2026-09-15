# Studio regression tests

Run commands from the repository root. The tests below use synthetic geometry,
inert API adapters, or loopback HTTP servers. They do not connect to a printer,
generate paid artwork, move hardware, or start a physical print.

## Checks run by GitHub Actions

The `build` workflow runs on `codex/**` branches as well as the existing build
branches and pull requests. It uses Node 22, Python 3.11, and the Ubuntu runner's
C++ compiler. The Studio/bridge step has a five-minute timeout and runs these
commands before the existing PlatformIO native tests and firmware builds:

```sh
node scripts/dev/test_start_flow.cjs
node scripts/dev/test_api_start_retry.cjs
node scripts/dev/test_preflight_busy_native.cjs
node scripts/dev/test_model_library.mjs
node scripts/dev/test_finished_product_library.cjs
node scripts/dev/test_product_save_race.cjs
node scripts/dev/test_sculpt_dimensions.cjs
node scripts/dev/test_slicer_fit_gate.cjs
node scripts/dev/test_slicer_import_wait.cjs
node scripts/dev/test_topper_meshy.cjs
node scripts/dev/test_keycap_texture.cjs
node scripts/dev/test_texture_lifecycle.cjs
node scripts/dev/test_texture_backup.cjs
node scripts/dev/test_color_backup.cjs
node scripts/dev/test_includes.mjs
python -m unittest discover -s scripts/tests -p 'test_tm_send*.py' -v
```

These test commands need no external network service. Installing runtimes and
PlatformIO dependencies in the workflow still requires network access. The
preflight test compiles the production handler in an inert native harness;
set `CXX` on Unix if your compiler is not named `c++`. On Windows it uses MSVC
Build Tools 2022, or the `vcvars64.bat` path in `TINYMAKER_VCVARS`.

Browser checks and optional real-model checks are separate from this CI step.
A green CI result is not evidence that a particular generated model is sound
or that an actual print has been tested.

## Browser runtime

Install Node 22 and Python 3.11. Install Playwright in the checkout and its
Chromium runtime:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

The browser scripts default to `require('playwright')`, its bundled Chromium,
and `python` on `PATH`. Optional environment overrides are:

| Variable | Value |
| --- | --- |
| `TINYMAKER_PLAYWRIGHT` | Module name or absolute path to an installed Playwright package. |
| `CHROME_BIN` | Absolute path to a compatible Chrome/Chromium executable. Leave unset to use Playwright's Chromium. |
| `TINYMAKER_PYTHON` | Python executable for harnesses that assemble the page themselves. |
| `TINYMAKER_MESHY_GLB` | An existing local Meshy GLB for the two optional real-artwork browser checks. |
| `TINYMAKER_MESH_STL` | A local binary STL for the optional real-model mesh-health check. |
| `TINYMAKER_PREVIEW_FIXTURE` | Optional local image for `browser_monitor_preview.cjs`; otherwise it uses an embedded synthetic PNG. |

For example, PowerShell overrides use `$env:CHROME_BIN='C:/Program Files/Google/Chrome/Application/chrome.exe'`;
POSIX shells use `export CHROME_BIN=/path/to/chrome`. No credentials or user
models are included in the repository.

Prepare the synthetic flower/mascot inputs and local page assets:

```sh
node scripts/dev/test_artisan_reference_shapes.mjs
python -c "from pathlib import Path; import shutil; p=Path('.cache/preview/lib'); p.mkdir(parents=True, exist_ok=True); shutil.copyfile('web/lib/three-0.160.0.min.js', p/'three.js')"
python scripts/assemble_dashboard.py -o .cache/preview/index.html
```

The geometry script generates its own `research/artisan-capabilities` fixtures.
These generated files and browser screenshots are intentionally not committed.

For `browser_color_reference.cjs`, `browser_designer_feedback.cjs`,
`browser_product_workflow.cjs`, and the optional real-artwork checks, start this
server in a separate terminal:

```sh
python -m http.server 8794 --bind 127.0.0.1 --directory .cache/preview
```

Then run, for example:

```sh
node scripts/dev/browser_color_reference.cjs
node scripts/dev/browser_designer_feedback.cjs
node scripts/dev/browser_product_workflow.cjs
node scripts/dev/browser_start_flow.cjs
node scripts/dev/browser_library_recovery.cjs
node scripts/dev/test_keycap_color_browser.cjs
node scripts/dev/test_topper_draft_browser.cjs
node scripts/dev/browser_monitor_preview.cjs
```

The last five harnesses create their own inert page/server; they do not need
the server on 8794. `browser_start_flow.cjs` still uses the prepared local
Three.js asset. `browser_library_recovery.cjs` uses port 8796, which must be free.
Browser receipts go under `.cache`, with screenshots under `research/screenshots`.

The texture and Finish-screen checks also run without the preview server:

```sh
node scripts/dev/test_keycap_texture_browser.cjs
node scripts/dev/test_texture_guide_browser.cjs
node scripts/dev/test_keycap_review_browser.cjs
```

They test actual rendered texture pixels and the assembled UI with synthetic
models. The review harness checks desktop and phone layouts, editable fit,
saved STL geometry, sharing, painting-guide download, and blocked slicing.

## Pinned slicer integration checks

`browser_keycap_actions.cjs`, `test_send_transfer.cjs`, and
`test_slicer_import_receipt.cjs` use the real public 3.5.0 slicer JavaScript
modules. Cache these public assets once before running the tests. Download
each filename from `https://slibbinas.github.io/TinyMakerWifi/lib/` into
`.cache/browser-actions/modules/` and verify its SHA-256:

| Filename | SHA-256 |
| --- | --- |
| `slicer-wasm-3.5.0.js` | `1937f41fb27946fa1ffc4426313c24c90800b80930dc7b27b11e4cdfadbd875e` |
| `slicer-core-3.5.0.js` | `d280621b49687578a3a13a52b93af7c5954cf307b73635943e6a41e0de02c018` |

For example, this cross-platform Python command fetches and verifies the first
module; repeat with the second filename and digest from the table:

```sh
python -c "from pathlib import Path; import urllib.request, hashlib; n='slicer-wasm-3.5.0.js'; b=urllib.request.urlopen('https://slibbinas.github.io/TinyMakerWifi/lib/'+n, timeout=30).read(); assert hashlib.sha256(b).hexdigest()=='1937f41fb27946fa1ffc4426313c24c90800b80930dc7b27b11e4cdfadbd875e', 'Unexpected module contents'; p=Path('.cache/browser-actions/modules'); p.mkdir(parents=True, exist_ok=True); (p/n).write_bytes(b)"
```

With the local preview server running, run:

```sh
node scripts/dev/browser_keycap_actions.cjs
node scripts/dev/test_send_transfer.cjs
node scripts/dev/test_slicer_import_receipt.cjs
```

The receipt test hosts its own loopback server but reads the assembled preview
file. These checks exercise handoff/transfer and import completion using local
fixtures. They do not prove a full external slicer conversion or physical print.

## Optional existing-model checks

Set `TINYMAKER_MESHY_GLB` before running:

```sh
node scripts/dev/browser_artisan_quality.cjs
node scripts/dev/browser_designer_polish.cjs
```

Both report `SKIP` when no GLB path is supplied. Set `TINYMAKER_MESH_STL` before
`node scripts/dev/test_mesh_health.mjs` to also inspect a real STL; without it,
the synthetic defect tests still run and the real-model case reports `SKIP`.
A missing file at an explicitly supplied path fails instead of silently skipping.
Use a representative model for a release review and record its provenance;
arbitrary generated art may legitimately fail attachment or mesh-health checks.
