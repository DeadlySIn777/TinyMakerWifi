# TinyMaker resume: security and download validation

This review was performed on the resumed source copy while the printer was
printing. No printer connection, command, firmware upload, reboot, Meshy API
request, API key, or paid generation was used.

## Fixed and exercised

- The pure CSRF host check checked a port after modifying the host length.
  `tinymaker.local.:8080` could therefore pass. Port parsing now uses the
  original authority boundary. Inactive interface address `0.0.0.0` is refused.
- The Meshy allowlist inspected the authority but permitted CR/LF in the path.
  It now refuses request-line controls across the whole URL, malformed DNS
  labels, credentials and every explicit port except `443`. Signed query
  strings remain accepted. Redirects pass the same guard before each fetch.
- Firmware URL prefix checks now reject encoded path escapes, backslashes,
  query/fragment text and control characters. Decimal version parsing checks
  overflow before arithmetic, and a malformed release manifest reports an
  error rather than “up to date.”
- Busy state always blocks firmware updates, even if the update-menu screen
  value remains set. The flash operation and developer OTA loop recheck this.
- HTTPClient remains responsible for upstream dechunking. A tested stream
  adapter checks downstream socket writes and caps both known and unknown
  body lengths at 48 MiB. On an upstream failure or a short/oversized body it
  closes the incomplete response, so the browser cannot receive a successful
  truncated model. No entire model is buffered in RAM.
  Framing follows the WebServer's actual response headers: HTTP/1.0 receives
  raw close-delimited bytes and HTTP/1.1 receives chunk framing when needed.
- Model downloads now validate TLS certificates and hostnames against the
  five Amazon Trust Services roots. Unsynced clocks return a retry message;
  there is no insecure fallback. Firmware and slicer updates retain their
  separate trust store.

The first four added native regression groups failed against the resumed
source before fixes. They pass after the fixes, alongside the previous suite.

## Validation performed

- **26 native Unity test groups passed**, zero failures/ignored, compiled and
  executed using Visual Studio 2022 Build Tools MSVC. Includes the actual
  `TmFetchStream` implementation with a fake socket: binary bytes, chunk
  framing, unknown-length limit, short header/body/footer writes, disconnects,
  completion errors, advertised HTTP/1.0 versus HTTP/1.1 response framing, and
  the complete OTA busy/menu/web-control truth table.
- **1 offline Python trust-store test passed**: all five DER fingerprints
  match the publisher and the actual embedded PEM string parses as five CA
  certificates.
- TLS 1.2 handshakes to the public `assets.meshy.ai`, `api.meshy.ai` and
  `meshy.ai` hosts passed chain and hostname verification using **only** the
  embedded trust store. This was a transport check, not a successful AI design
  or printed-model claim.
- Existing GitHub CI runs the same native suite through `pio test -e native`.
  No CI service run was dispatched or claimed here. MSVC fallback:

  ```powershell
  ./scripts/tests/run_native_msvc.ps1 -UnitySource 'path/to/Unity/src'
  python -m unittest discover -s scripts/tests -p test_download_trust.py
  ```

The firmware build and browser feature checks are separate integration steps.
On-device RAM headroom, timing and actual Meshy model import still require an
idle device. The vendor HTTPClient's own chunk decoder is used; it was not
reimplemented or represented as covered by the adapter's fake-socket tests.

## Trust-store provenance

Amazon's official [trust repository](https://www.amazontrust.com/repository/)
publishes the certificate fingerprints and recommends including all five ATS
roots for custom trust stores. The existing installed CA bundle supplied bytes
whose DER fingerprints match those published values. The new header includes
attribution and the certificate-data license. PEM payload: **5,888 bytes**.

The installed Arduino ESP32 **2.0.14** `WiFiClientSecure` implementation supports
`setCACert()` with hostname verification. Its source and README were inspected
locally. The new model path uses that existing interface without upgrading the
core or introducing a global certificate-bundle lifecycle.

This is a scoped review, not a claim that every firmware security concern has
been eliminated. Unrelated legacy statistics and animation HTTPS paths still
have independent behavior outside the model-download/update fixes above.
