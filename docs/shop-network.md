# Shop Network - the printer on the air station's roster

The shop's compressor controller (the `smart_compressor` Air Station) keeps a
roster of paired machines. This makes the TinyMaker printer one of them: it
pairs once, then says what it is doing.

## Step 1 first: can this board run ESP-Mesh-Lite?

**No.** This was checked before anything was written, and the answer decides the
whole shape of the integration.

| | Air Station (reference) | TinyMaker printer |
|---|---|---|
| Chip | ESP32-**S3** | ESP32-**WROOM-32E** (classic, Xtensa LX6) |
| Framework | ESP-IDF 5.5.4 | Arduino core **2.0.14** (IDF 4.4 underneath) |
| Flash | - | 4 MB, app partition 1.9 MB, **76.9 % already used** |
| PSRAM | - | none |

ESP-Mesh-Lite 1.0.2 is an ESP-IDF component and needs IDF 5.x. This project is
pinned to `espressif32@6.5.0` and [CLAUDE.md](../CLAUDE.md) forbids moving off
it, because the vendored `Arduino_GFX` 1.2.0 that drives the display does not
work on core 3.x. So Mesh-Lite cannot be compiled into this firmware without
replacing the display stack first.

There is a second, independent blocker. Mesh-Lite wants to own the AP+STA
interfaces and station reconnection. In this firmware that job already belongs
to WiFiManager and the dashboard's captive portal. Two owners of the Wi-Fi
driver is not a configuration problem, it is a rewrite.

## Why that turns out not to matter

From the shop diagram:

```
Shop router ─── Laptop / phone
     ├───────── Le Potato
Compressor ESP32 — mesh root + command gateway
     ├── TinyMaker printer
     └── Other ESP32 nodes
```

Mesh-Lite carries **normal IP traffic**. It is a way to extend Wi-Fi coverage,
not a separate protocol the API rides on. The compressor's root is itself on the
shop router, so every machine on the mesh and every machine on the router are on
the same IP network.

That means the printer does not need to *run* the mesh to *talk to* the
compressor. It joins the shop Wi-Fi as an ordinary client and reaches
`/api/machine/heartbeat` over plain IP, exactly like the laptop does. Being on
the mesh and running the mesh are different jobs.

**The one thing this gives up: range.** A leaf node exists to get coverage where
the router does not reach. If the printer sits somewhere the shop Wi-Fi is weak,
this approach does not help - and the fix is a repeater or an access point, not
firmware. Where the printer stands is a question about your shop, not about the
code.

## What is implemented

Everything in the protocol that does not require being a mesh node:

| Spec step | Status |
|---|---|
| 1. Confirm board and framework | done - see above |
| 2. Join mesh as a child | **not possible on this chip/framework** |
| 3. Mesh encryption config | n/a - follows from 2 |
| 4. One Wi-Fi/event-loop init | unchanged; HTTP stays off the motion path |
| 5. Own pairing identity | done - host, expected station ID, own token |
| 6. Discover and verify | done, adapted - see below |
| 7. Report real state | done - real states, not `unknown` |
| 8. Air requests | deliberately none - a resin printer uses no air |

### Step 6, adapted

`esp_mesh_lite_get_root_ip()` does not exist here, so the address is configured
instead of discovered. The important half of that step is kept exactly as
specified: **the compressor's identity is verified before the token is sent.**

Before any authenticated request, the printer calls the unauthenticated
`GET /api/info` and compares `device_id` against the one saved at pairing. A
mismatch refuses the exchange and the token is never transmitted. The result is
cached for 10 minutes and thrown away whenever a request is refused.

This matters more here than on a mesh node: a typed hostname can drift onto
another box through a re-used DHCP lease or a stray mDNS answer, and without the
check the printer would hand its credential to whatever answered.

### Step 7, and its honest limit

Real states are reported, not `unknown`:

| Printer | Sent |
|---|---|
| print started | `busy` |
| print finished / cancelled | `idle` |
| sitting idle | `idle` (slow tick) |

**Heartbeats do not go out every 10 s during a print.** `network_loop()` is
dormant while printing - the exposure path only services
`network_service_http()` - so the only way to beat that drum mid-print is to put
a blocking HTTP request inside the layer loop, on a single-threaded board that
is simultaneously driving UV exposure and Z motion. That is how you get banded
layers.

Since the station marks presence stale after 30 s, a printer mid-print shows as
**busy but stale**. That is the wrong-looking answer for the right reason: a
correct roster entry is not worth a ruined print.

Fixing it properly means finding the real inter-layer gap and measuring layer
timing on hardware before and after. That is a separate change behind the
hardware gate, not a line in this one.

## Setting it up

1. On the compressor, pair a machine named **TinyMaker**. Copy the token it
   shows once, and the station's `device_id` from its info page.
2. On the printer: **Settings → Shop Network**. Enter the station's address
   (`air.local` or its IP), the `device_id`, and the token. Turn it on.
3. Press **Test**. It sends one `idle` heartbeat and reports what came back.

Never install the administrator token on the printer. A machine token cannot
arm, stop or reconfigure the compressor - the worst a stolen printer token can
do is lie about whether a printer is busy.

## Security notes

- **Plain HTTP, LAN only.** The station's API is local HTTP; a TLS client would
  cost heap in exactly the window where mid-print heap is already tight. Do not
  point `shopHost` at anything off the local network - the token would cross it
  in clear text.
- **The token is never echoed to the browser.** The dashboard sees only whether
  one is set plus its last four characters, the same rule the Discord webhook
  and MQTT password follow.
- **Identity before credential**, as above.
- The mesh password and the API token are separate secrets. This firmware holds
  only the API token, because it does not join the mesh.

## Not done

No relay control (`air-relay.v1`). The printer exposes no remotely switchable
outputs, and joining a roster does not by itself expose its buttons or sensors -
each one needs its own API surface and dashboard support. Joining, pairing and
truthful online status first, as the spec says.
