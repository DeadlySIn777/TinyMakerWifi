# Sending a model from your slicer

The printer prints **PNG layer images**. An `.sl1` file is exactly that - a ZIP
full of PNGs plus a small `config.ini` - which is why `.sl1` and `.zip` are the
two things it takes, over the network or off the SD card.

Everything below is a consequence of that one fact.

## Which slicer can do what

| Slicer | Sends over the network | How |
|---|---|---|
| **PrusaSlicer** | yes, built in | Add a *Physical printer*, host `tinymaker.local`, type **OctoPrint**. Then **Send to printer**. Nothing else to install. |
| **Lychee Slicer** | yes, with the helper | Export as **Prusa SL1**, then `tm_send.py`. Or point the helper at Lychee's export folder and forget about it. |
| **Chitubox** | yes, with the helper | Chitubox writes `.ctb`, which the printer cannot read. The helper converts it first (UVtools) and uploads the result. |
| **UVtools** | yes | It already speaks `.sl1`. Export, then `tm_send.py` - or use its own tooling. |

## Why Chitubox needs a helper

Chitubox exports `.ctb` / `.photon` / `.pwmx`. Those are proprietary, the layer
data is run-length encoded, and the encoding changes between Chitubox versions.

Decoding them **on the printer** was considered and rejected: this is an
ESP32-WROOM with 4 MB of flash and no PSRAM, already running a web server, an
SD stack and a print loop inside one `loop()`. Adding a format that needs
chasing every time a vendor revises it is a permanent maintenance cost paid in
the one place we have no room - and it would put parsing of untrusted binary
right next to the print loop.

So the conversion happens on the PC, where UVtools already does it properly and
for free, and the printer keeps its one simple contract.

## The helper

[`scripts/tm_send.py`](../scripts/tm_send.py) - Python 3.8+, standard library
only, nothing to install.

```
python scripts/tm_send.py model.sl1                   send it
python scripts/tm_send.py model.ctb                   convert, then send
python scripts/tm_send.py model.ctb --start           send and start printing
python scripts/tm_send.py --watch "D:/Chitubox/out"   send anything exported there
```

`--watch` is the one worth setting up. Leave it running, slice in Chitubox as
you always do, hit export - and the model is on the printer before you have
walked over to it. Files are only picked up once they have stopped growing, so
a half-written export is never sent.

For `.ctb` and friends you also need [UVtools](https://github.com/sn4k3/UVtools)
(free, open source). `.sl1` and `.zip` need nothing at all.

### UVtools quirks, found by actually running it (v6.2.0)

Two things that cost time if you meet them cold:

- **`UVtoolsCmd` returns exit code 1 even when the conversion fully succeeds.**
  Verified: exit 1, and a valid 99 KB `.sl1` written next to it. So `tm_send.py`
  judges the result by the output FILE, not the exit code. `check_sl1()` still
  runs afterwards and rejects anything that is not a ZIP of PNG layers, so a
  silently wrong conversion cannot reach the printer.
- **`ctb` is an ambiguous target.** Two encoders claim that extension (Chitubox
  and CTBEncrypted), so `convert x.sl1 ctb out.ctb` fails and prints the list of
  32 encoders. Use the strict encoder name - `Chitubox`. This only matters going
  TOWARDS ctb; `sl1` is claimed by one encoder, which is the direction this tool
  uses.

Also worth knowing: a real `.sl1` needs **both** `config.ini` and
`prusaslicer.ini` inside it. UVtools refuses one without the other
("Malformed file: prusaslicer.ini is missing"). The printer is more forgiving -
it takes any ZIP of PNGs - so a bare archive that the printer prints happily can
still be unreadable to UVtools.

### Verified end to end

`.ctb` -> UVtools -> `.sl1` -> upload -> unpacked and printable on the machine.
The test article was a cube sliced by PrusaSlicer 2.9.6 with the TinyMaker
profile, converted to Chitubox format, then sent with
`tm_send.py --describe`.

### Useful flags

| Flag | What it does |
|---|---|
| `--printer HOST` | printer address; default `tinymaker.local`, use the IP if mDNS is unreliable on your network |
| `--start` | begin printing as soon as the upload finishes |
| `--action rename` | keep both when the name is already on the card (default is `replace`) |
| `--uvtools PATH` | point at `UVtoolsCmd` if it is not on `PATH` |
| `--describe` | name it `model_printer_layer_exposure_date`, so the printer's file list says what each model is |

### About `--describe`

The printer's file list shows names and nothing else, so `Tooth` three times
over tells you nothing about which one was 0.05 mm at 2.6 s. With `--describe`
the same file uploads as:

```
Tooth_SL1_005_26_2026_09_13_02_46_13
```

Layer height and exposure come from the `config.ini` inside the `.sl1`
(PrusaSlicer writes one; a bare ZIP of PNGs does not, and then the name simply
carries fewer facts). The date is the file's own modification time - when it was
sliced, which is the fact worth keeping, not when it happened to be uploaded.

**Why it looks like that and not like `0.05mm` or `2.6s`:** the printer keeps 40
characters and deletes everything that is not a letter, a digit, `-` or `_`
(`safeModelName`, [src/Import.ino:71](../src/Import.ino)). So `0.05` arrives as
`005` whatever you do, and anything past 40 characters is cut off the END -
which is where the date lives. The helper therefore shortens the MODEL name to
make room and keeps the reading intact, rather than letting the firmware cut the
timestamp off. It says so when it shortens one.

### What it will not do

It refuses before uploading if the archive is not a ZIP or has no PNG layers in
it. That check is cheap here and expensive on the printer, where a bad archive
is minutes of unpacking on the ESP32 before it fails with the user watching.

## Under the hood

The upload is a plain multipart POST to `/upload` (see [api.md](api.md)), the
same endpoint the dashboard and `curl` use:

```
curl -F "file=@model.sl1" -F "action=replace" http://tinymaker.local/upload
```

Requests that carry no `Origin` header are only allowed to change things if
they carry `X-TinyMaker` (the CSRF rule, issue #95). The helper sends it, which
is why `--start` works from a script while a random web page cannot do the same.

## What would remove the helper entirely

Chitubox and Lychee both speak the **Elegoo/Anycubic UDP discovery + upload
protocol** natively - a much simpler wire format than OctoPrint. If the firmware
answered that, both slicers would find the printer on the network by themselves
and their own Send button would light up, with no PC-side tool and no format
conversion for the ones that can already emit PNG layers.

That is firmware work in `Network.ino`, so it goes through the hardware gate.
Proposed, not scheduled - it belongs on the plan only if V puts it there.
