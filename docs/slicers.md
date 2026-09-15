# TinyMaker slicer bridge

The PC bridge converts a sliced file when necessary, checks its layer images,
uploads it, then waits until the printer has unpacked and verified the model.
Uploading alone does **not** start a print.

## Printer profile

Use **320 × 240 pixels, 40.8 × 30.6 mm**, with source layers at **0.05 mm**.
The included TinyMaker.ini is the PrusaSlicer profile. The same raster and
physical dimensions are required when setting up another slicer.

Exposure comes from the **printer's selected resin profile**, not the sliced
file. The bridge prints the active values before uploading. A printer profile
set to 0.10 mm uses alternate 0.05 mm source layers.

Conversion changes the file format. It cannot safely fix a file sliced for a
different screen resolution, plate size, orientation or exposure process.

## Install and send

Python 3.8 or newer is required. The bridge uses only Python's standard library.
Install [UVtools](https://github.com/sn4k3/UVtools) for CTB and other converted
formats; SL1 does not need it.

From the bridge folder:

    python tm_send.py "C:\Models\my-model.sl1" --printer 192.168.1.22
    python tm_send.py "C:\Models\my-model.ctb" --printer 192.168.1.22

In the firmware source tree, use python scripts/tm_send.py instead.

On Windows, you can right-click **Send-Model.ps1 → Run with PowerShell** to
choose a sliced file and enter the printer address. This launcher keeps existing
models by renaming duplicates and never starts a print. It requires Python
3.8+ and follows the computer's existing script-execution policy.

| Starting file | Route |
|---|---|
| PrusaSlicer SL1 | Send directly with the bridge. PrusaSlicer's separate OctoPrint upload support also exists. |
| Lychee Prusa SL1 export | Send with the bridge after configuring the TinyMaker dimensions. A native Lychee export has not yet been verified here. |
| Chitubox CTB | The bridge runs UVtools and checks the resulting SL1 before uploading. |
| PNG layer ZIP | Requires numbered consecutive layers and config.ini containing layerHeight = 0.05. Thumbnails alone are rejected. |

Default name conflicts stop without overwriting. Use --action rename to keep
both, or explicitly use --action replace to replace an existing model.
The final message identifies the name actually stored on the printer.

For a slicer's export folder:

    python tm_send.py --watch "C:\Models\Exports" --printer 192.168.1.22 --action rename

The watcher waits for a nonempty, stable file. It detects overwritten exports,
retries temporary printer failures, and reports files needing attention. If
delivery becomes uncertain after an upload, it asks you to inspect the printer
instead of blindly duplicating the model.

--uvtools PATH selects a specific UVtoolsCmd executable. --describe adds
source-slicer metadata to the name; exposure in that name is a label, **not**
the printer's actual exposure setting.

Use --check with an SL1/ZIP for a local validation without contacting the printer.
--wait-seconds sets the maximum wait for unpacking and confirmation (default 900).

--start is optional and explicitly requests a print after confirmed import.
It runs printer preflight and does not override resin warnings. For initial
setup, upload first and review the printer's preview and resin settings.

## Checks before success

- ZIP integrity, safe paths, numbered layers without gaps or duplicates.
- Every layer is a supported 320 × 240 PNG; maximum 1,200 source layers.
- Source layer height and any declared physical display dimensions agree.
- Printer SD card and web control are available; printer is not busy.
- The accepted upload becomes a newly imported model with the expected layer
  count and source layer height. HTTP 201 / "queued" alone is not completion.

An error preserves the source export. The bridge does not change model scale,
motor settings, resin profiles or firmware.

## What was actually tested

The local fixture is a cube sliced with PrusaSlicer **2.9.6** using the
TinyMaker profile: **235 layers at 320 × 240, 0.05 mm**. It was converted from
SL1 to Chitubox format and back through installed UVtoolsCmd, which reports
2.1.0+c581952afa9bab99542c3120735090f1c5cab480.

All layer bounds stayed identical. The CTB round trip changed some antialias
values by at most 1 on a 0–255 scale. This is a verified **format round trip**,
not a native Chitubox/Lychee export or a completed physical print.

The live CTB bridge upload also passed: the printer completed import of
Bridge_QA_Cube with all 235 layers and the correct layer height. Existing models
were preserved; no print was started. It was tested on 0.18.7, then the printer
was updated to 0.18.8 and its model list was verified again after reboot.
The packaged validation receipt records this result and exact source hashes.
Firmware 0.18.9 was also checked with a deliberately empty archive and a valid
235-layer archive: each returned its own matching failure or success receipt.
The new successful QA model was removed afterward; earlier models were preserved.
Automated tests cover conversion validation, delayed import, name conflicts,
renaming, rejected starts and watch recovery using a simulated printer.

Observed UVtools behavior: the converter can exit with code 1 after writing a
valid output. The bridge validates the produced file instead of accepting or
rejecting it solely on that code. When generating a CTB fixture, use the strict
encoder name Chitubox; the extension ctb is ambiguous between encoders.

This helper can be distributed separately from firmware. It does not install
UVtools on the ESP32, and it has not been published or submitted upstream by
this repair.
