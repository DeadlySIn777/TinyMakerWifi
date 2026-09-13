/**
 * @file TinyMakerShop.ino
 * @brief Shop Network peer - the printer reports itself to the air station.
 *
 * WHAT THIS TALKS TO. The shop's compressor controller (the `smart_compressor`
 * ESP32-S3 air station) keeps a roster of paired machines. A machine pairs once,
 * is handed its own scoped token, and from then on says what it is doing. The
 * contract, taken from that controller's own API page:
 *
 *   Authorization: Bearer <MACHINE_TOKEN>
 *   POST /api/machine/heartbeat   {"state":"idle"}   idle | busy | fault | unknown
 *   GET  /api/machine/status                          this machine's readiness
 *   POST /api/machine/air         request / release   (not used here - see below)
 *
 * The identity is bound to the token, so we never send a machine id. A machine
 * token cannot arm, stop or change settings on the compressor: the worst a
 * stolen printer token can do is lie about whether a printer is busy.
 *
 * WHAT THIS IS *NOT*. It is not a Mesh-Lite node. The air station uses
 * espressif's Mesh-Lite to spread Wi-Fi across the shop, and that component is
 * ESP-IDF only - it wants to own AP+STA and station reconnection, which is
 * exactly what WiFiManager and the dashboard already own here, on a pinned
 * Arduino core 2.0.14. It also does not need porting: Mesh-Lite extends the
 * shop LAN, and this printer joins that LAN as an ordinary Wi-Fi client like
 * every other device. Being on the mesh and running the mesh are not the same
 * job.
 *
 * NO AIR REQUESTS. A resin printer uses no compressed air, so `/api/machine/air`
 * is deliberately not called. If the wash/cure station ever wants air, it asks
 * for its own - with its own token.
 *
 * WHEN IT SENDS - and the honest limit.
 * Heartbeats go out on state CHANGES (print started, finished, cancelled, dry
 * VAT) plus a slow idle tick, and every one of them is sent from a point where
 * the firmware already does network work safely.
 *
 * They do NOT go out every 10 s during a print, and that is on purpose:
 * network_loop() is dormant while printing (its own comment says so - the
 * exposure path only services network_service_http()), and the only way to beat
 * a 10 s drum mid-print would be to put a blocking request inside the layer
 * loop. On a single-threaded board that also drives UV exposure and Z motion,
 * that is how you get banded layers. The air station marks presence stale after
 * 30 s, so a printer mid-print will read "busy (stale)" rather than "busy".
 *
 * That trade is deliberate: a correct roster entry is not worth a ruined print.
 * Making it beat properly means finding the real inter-layer gap and measuring
 * layer timing on hardware before and after - a change that belongs behind the
 * hardware gate, not in the same commit as the feature.
 */

#ifndef ENABLE_NETWORK
#define ENABLE_NETWORK 1
#endif
#if ENABLE_NETWORK

#include <HTTPClient.h>

// Plain HTTP on purpose. The air station's API is local HTTP, and a TLS client
// here would cost heap in exactly the window where mid-print heap is already
// tight (see the notify path's preview-cache dance in TinyMakerTelegram.ino).
// The token therefore never leaves the LAN - do not point shopHost at anything
// off the local network.
static bool shopHttp(const char *method, const char *path, const String &body,
                     String &out, String &error, bool sendToken = true) {
  if (WiFi.status() != WL_CONNECTED) { error = "WiFi is not connected"; return false; }
  if (shopHost.length() == 0)        { error = "no air station address set"; return false; }
  if (sendToken && shopToken.length() == 0) {
    error = "not paired with the air station";
    return false;
  }

  String url = "http://" + shopHost + path;
  HTTPClient http;
  WiFiClient net;
  if (!http.begin(net, url)) { error = "could not start the request"; return false; }

  // Both timeouts, deliberately short. This runs in the print loop's own
  // thread: a slow answer is a stalled printer, and the roster is not worth
  // one. Same lesson as the OTA check (auditas 08-22).
  http.setConnectTimeout(1500);
  http.setTimeout(1500);
  if (sendToken) http.addHeader("Authorization", "Bearer " + shopToken);
  if (body.length()) http.addHeader("Content-Type", "application/json");

  int code = (strcmp(method, "GET") == 0) ? http.GET() : http.POST(body);
  if (code > 0) out = http.getString();
  http.end();

  if (code < 0) { error = "cannot reach the air station: " + http.errorToString(code); return false; }
  if (code == 401 || code == 403) {
    error = "the air station refused our token - pair the printer again";
    return false;
  }
  if (code < 200 || code >= 300) { error = "air station returned HTTP " + String(code); return false; }
  return true;
}

// Remembered so the dashboard can say what happened instead of looking healthy
// while nothing arrives (same reasoning as the #88 notify status).
bool     shopLastTried = false;
bool     shopLastOk    = false;
uint32_t shopLastAtMs  = 0;
char     shopLastReason[64] = {0};
char     shopLastState[8]   = {0};

static void shopRemember(bool ok, const String &error, const char *state) {
  shopLastTried = true;
  shopLastOk    = ok;
  shopLastAtMs  = millis();
  strncpy(shopLastState, state, sizeof(shopLastState) - 1);
  shopLastState[sizeof(shopLastState) - 1] = 0;
  if (ok) shopLastReason[0] = 0;
  else {
    strncpy(shopLastReason, error.c_str(), sizeof(shopLastReason) - 1);
    shopLastReason[sizeof(shopLastReason) - 1] = 0;
  }
}

// ---- Who are we actually talking to? --------------------------------------
//
// The token is a credential, and shopHost is a name a person typed. If that
// name ever resolves somewhere else - a re-used DHCP lease, an mDNS answer from
// the wrong box, a typo - sending the token first would hand it to a stranger.
//
// So: ask the UNAUTHENTICATED /api/info, which every air station answers with
// its own device_id, and only continue if it is the station we were paired
// with. Cached, because this runs before every heartbeat.
static bool shopVerified = false;
static uint32_t shopVerifiedAt = 0;

// Smallest thing that works on a flat, known JSON object - no parser, no heap
// spike. Returns "" when the key is absent.
static String shopJsonStr(const String &json, const char *key) {
  String needle = String("\"") + key + "\"";
  int k = json.indexOf(needle);
  if (k < 0) return "";
  int c = json.indexOf(':', k + needle.length());
  if (c < 0) return "";
  int q1 = json.indexOf('"', c);
  if (q1 < 0) return "";
  int q2 = json.indexOf('"', q1 + 1);
  if (q2 < 0) return "";
  return json.substring(q1 + 1, q2);
}

static void shopForgetVerification() { shopVerified = false; shopVerifiedAt = 0; }

static bool shopVerifyStation(String &error) {
  // Re-check every 10 minutes: long enough to cost nothing, short enough that
  // a station swapped underneath us is noticed while the shop is still open.
  if (shopVerified && shopVerifiedAt && (uint32_t)(millis() - shopVerifiedAt) < 600000UL)
    return true;
  if (shopDeviceId.length() == 0) {
    error = "no expected air station ID saved - pair the printer again";
    return false;
  }
  String out;
  if (!shopHttp("GET", "/api/info", "", out, error, /*sendToken=*/false)) return false;
  String got = shopJsonStr(out, "device_id");
  if (got.length() == 0) { error = "that address is not an air station"; return false; }
  if (got != shopDeviceId) {
    // Deliberately does NOT name the ID we expected - the message reaches a
    // browser, and the point is to not leak our side of the pairing.
    error = "a different air station answered - refusing to send our token";
    shopForgetVerification();
    return false;
  }
  shopVerified = true;
  shopVerifiedAt = millis();
  return true;
}

// state: "idle" | "busy" | "fault" | "unknown" - the air station accepts no
// others and answers 400 for anything else.
bool shopHeartbeat(const char *state, String &error) {
  if (!shopVerifyStation(error)) return false;   // identity BEFORE credential
  String out;
  String body = String("{\"state\":\"") + state + "\"}";
  bool ok = shopHttp("POST", "/api/machine/heartbeat", body, out, error);
  // A refused token means the pairing is gone or we are at the wrong station:
  // re-verify next time rather than retrying with a credential that failed.
  if (!ok) shopForgetVerification();
  return ok;
}

// Best-effort: a failure is remembered and then swallowed. A print must never
// stall because the compressor is off - exactly the rule the chat channels
// already follow.
void shopReport(const char *state) {
  if (!shopEnabled) return;
  String error;
  bool ok = shopHeartbeat(state, error);
  shopRemember(ok, error, state);
  if (!ok) DBG("Shop heartbeat (%s) failed: %s\n", state, error.c_str());
}

// Hooks called from the print flow. Named for the event, not the state, so the
// call sites read as what happened.
void shopNotifyPrintStarted()  { shopReport("busy"); }
void shopNotifyPrintFinished() { shopReport("idle"); }
void shopNotifyPrintCanceled() { shopReport("idle"); }
void shopNotifyFault()         { shopReport("fault"); }

// Idle tick from network_loop(). network_loop() does not run during a print, so
// this can never land inside a layer - that is the whole reason it lives here
// and not on a timer.
void shopLoop() {
  if (!shopEnabled || printerBusy()) return;
  static uint32_t last = 0;
  // 10 s is the cadence the air station documents; presence goes stale at 30 s.
  if (last != 0 && (uint32_t)(millis() - last) < 10000UL) return;
  last = millis();
  shopReport("idle");
}

// Appended to configJson(). The token is never sent to the browser - only
// whether one is set, and its last 4 characters, so a person can tell two
// tokens apart without the page ever holding a credential.
String tinymakerShopConfigJson() {
  String out = ",\"shopEnabled\":";
  out += shopEnabled ? "true" : "false";
  out += ",\"shopHost\":\"";
  out += jsonEscape(shopHost);
  out += "\",\"shopTokenSet\":";
  out += shopToken.length() > 0 ? "true" : "false";
  out += ",\"shopTokenTail\":\"";
  out += jsonEscape(shopToken.length() > 4 ? shopToken.substring(shopToken.length() - 4) : "");
  out += "\",\"shopLastOk\":";
  out += shopLastTried ? (shopLastOk ? "true" : "false") : "null";
  out += ",\"shopLastState\":\"";
  out += jsonEscape(shopLastState);
  out += "\",\"shopLastReason\":\"";
  out += jsonEscape(shopLastReason);
  out += "\",\"shopStationIdSet\":";
  out += shopDeviceId.length() > 0 ? "true" : "false";
  out += ",\"shopVerified\":";
  out += shopVerified ? "true" : "false";
  return out;
}

// POST /api/shop/test -> send one heartbeat with the saved settings and report
// what the air station said. Same gate as the other test buttons.
void handleApiShopTest() {
  if (rejectIfWebControlOff()) return;
  if (printerBusy()) {
    sendApiError(409, "printer busy");
    return;
  }
  String error;
  bool ok = shopHeartbeat("idle", error);
  shopRemember(ok, error, "idle");
  if (!ok) {
    sendApiError(502, error.c_str());
    return;
  }
  sendApiOk("\"message\":\"The air station answered - the printer is on the shop roster\"");
}

#endif
