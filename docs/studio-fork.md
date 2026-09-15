# DeadlySIn777 TinyMaker Studio

This is the 0.18.13 Studio development build of the DeadlySIn777 fork. The
upstream TinyMakerWifi project and its documentation remain credited in the
main README; its current release numbering is separate from this fork.

The browser includes keycap, model and measured pencil/stylus-topper tools,
Meshy artwork import/generation, editable Library products, color references,
socket-fit adjustment, and the browser resin slicer. AI artwork still needs
visual review and a fit sample: generation does not guarantee printable or
mechanically sound geometry.

In 0.18.13, new keycap generations can automatically check and adjust sculpture
size within the chosen height. The bounded search keeps the source artwork and
socket unchanged, and only accepts passing geometry, attachment and print-fit
checks. Review & improve artwork opens four views, with a local fit action and
focused corrections for a larger face, compact silhouette or sturdier details.
Local fitting chooses the largest passing size it tested; it is not a guarantee
of a global optimum or physical fit.

Revise with Meshy uses a rendered image of the current sculpture, without its
cap/socket, as the reference for an image revision and a new textured 3D model.
The confirmation states the two paid tasks. The original stays in Library; a
new candidate replaces it on screen only after saving and passing print checks.
Interrupted tasks remain recoverable, and uncertain submissions are not retried
automatically. No separate vision provider is used. Anatomy corrections are
instructions to Meshy, not a claim that firmware detects visual defects.

In 0.18.12, Library cards emphasize opening a design; details and secondary
actions expand on demand. The topper editor has compact fit and sculpt controls,
a plain socket fit-test export, and a view of the socket. A pending model import
cannot send the previous model by accident. Saved Models export preserved
texture data in a portable design backup alongside the printable STL.

In 0.18.11, the keycap Finish screen has one Send to slicer action, a compact
product summary, and expandable fit, print details, and export tools. Blocking
geometry warnings remain visible. The painting reference uses the model's UV
texture where present; texture data stays with the editable Library design.
Adding a Meshy texture to a saved Meshy preview is a separate user action.

Retained from 0.18.10:

- Monitor displays the large model/print viewer beside the SD list. Browsing
  saved models while an unsent slicer design is open uses a separate saved
  image, keeping that design in Create.
- Start confirms the selected model, checks the printer's preflight results,
  and keeps one pending attempt through dialogs and the low-resin retry.
  A lost network response is checked against the same active model; it never
  automatically resends Start.
- Library saves capture geometry and measurement data together. Late file
  reads, Library loads and generation recovery cannot overwrite a newer
  selection. Interrupted paid tasks remain available for recovery.
- Sculpted-keycap dimensions come from the actual assembled mesh. Off-center
  artwork is checked against neighboring-key space without changing the socket.

The earlier 0.18.9 release added exact upload-completion receipts. A successful
HTTP upload is not yet an imported model: the browser waits for the printer's
matching completion before releasing its prepared slice.

## PC slicer bridge

See [the bridge guide](slicers.md) for the Windows launcher, command-line tool,
and Chitubox/UVtools or SL1 workflows. The required raster is **320 × 240 px**
over **40.8 × 30.6 mm**. Exposure comes from the printer's resin profile.
Sending a model does not start a print.

## Firmware

Build with the pinned PlatformIO dependencies in `platformio.ini`. Use the OTA
binary with the printer's web updater while idle. The combined USB binary is
for recovery at address 0x0. Keep the selected resin's exposure settings and
verify the vat and plate before starting a physical print.

This build's automated checks cover software behavior and build compatibility.
They do not establish that every generated design will look good or print well.
