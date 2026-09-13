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

## But the printer CAN still join the mesh - as an ordinary station

This is the part worth knowing: **you do not need Mesh-Lite on a node to be a
leaf of the mesh.**

The root brings up its child-facing interface as a plain WPA2-PSK SoftAP
(`mesh_network.cpp`: `softap.ap.authmode = WIFI_AUTH_WPA2_PSK`) sitting on an
IoT-Bridge netif created with `esp_bridge_create_softap_netif(..., true, true)` -
that is a DHCP server plus NAT onto the shop LAN.

So any Wi-Fi station can associate to that SoftAP with the normal password, get
a lease, and be routed to the rest of the shop. That is exactly what the printer
is. **Point WiFiManager at the root's SoftAP SSID and password and the printer
is on the mesh** - no firmware change, no Mesh-Lite, no vendor bytes, no derived
AES key. Those belong to the mesh's own node-to-node layer, which a leaf that
only speaks IP never participates in.

What it does not get: re-parenting and range extension. It attaches to the root
and stays there. Your reference leaf nodes do not extend range either, so this
matches them.

### The catch worth checking: NAT is one-way

Behind the bridge's NAT, the printer can reach the compressor and the shop LAN,
but traffic cannot easily come back the other way. **The dashboard at
`tinymaker.local` may stop being reachable from your laptop**, because the
laptop sits on the router side of the NAT and the printer sits behind it.

That is a real trade, and it decides the setup:

| Where the printer sits | Join | Why |
|---|---|---|
| Shop Wi-Fi reaches it | **the shop router** | dashboard stays reachable from any device; the compressor is reachable all the same, same IP network |
| Shop Wi-Fi does not reach it | the root's SoftAP | connectivity at the cost of reaching the dashboard from the router side |

Prefer the router when you have the choice. The mesh is for coverage, and
coverage is the only thing it buys here.

## What is implemented

Everything in the protocol that does not require being a mesh node:

| Spec step | Status |
|---|---|
| 1. Confirm board and framework | done - see above |
| 2. Join mesh as a child | yes - as a plain station on the root's SoftAP; no Mesh-Lite needed (see above) |
| 3. Mesh encryption config | n/a - a leaf that only speaks IP never joins the node-to-node layer |
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

### Step 7, every 10 seconds - including mid-print

Real states are reported, not `unknown`:

| Printer | Sent |
|---|---|
| print started | `busy` |
| print finished / cancelled | `idle` |
| sitting idle | `idle` |

The beat is a true 10 s, during prints as well, and a state change is sent
immediately rather than waiting for the next tick. Presence never goes stale.

**It does not run on the print loop.** The print loop does open network windows
mid-print (`network_service_window(160)` between layers), but 160 ms is the
budget and a blocking HTTP round trip to an unreachable host costs its whole
timeout - ten times over, on the thread that also drives UV exposure and Z
motion.

So the HTTP lives in its own FreeRTOS task pinned to **core 0**, the core
Arduino does not run `loop()` on. It blocks there for as long as it likes and
nothing on the print path ever waits for it. The two sides share one small
struct behind a mutex: the print flow writes a state word - no allocation, no
network, safe from anywhere - and the task reads it and reports.

Two details that make it well-behaved: the task is low priority, because core 0
also hosts the Wi-Fi driver and it should yield to the radio rather than race
it; and after three consecutive failures the interval backs off to 60 s, so a
compressor that is switched off does not cost a connect attempt every 10 s all
night.

Config is read through one locked snapshot per beat. The settings form and
backup restore write through `shopSetConfig()` rather than touching the globals,
because an Arduino `String` reallocated under a reader on the other core is a
crash, not a glitch.

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
