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
 * WHAT THIS IS *NOT*. It is not a Mesh-Lite node, and it does not need to be.
 * Mesh-Lite is ESP-IDF only and wants to own AP+STA and station reconnection -
 * which WiFiManager already owns here, on a core 2.0.14 that is pinned because
 * Arduino_GFX 1.2.0 breaks above it.
 *
 * It is also unnecessary. The root's child-facing interface is a plain WPA2-PSK
 * SoftAP on an IoT-Bridge NAT netif, so an ordinary station joins it with the
 * normal password and is routed onto the shop LAN. Pointing WiFiManager at that
 * SSID puts this printer on the mesh as a leaf with no code at all. Being ON the
 * mesh and RUNNING the mesh are different jobs; see docs/shop-network.md,
 * including why the shop router is usually the better choice (the bridge's NAT
 * is one-way, and the dashboard lives on the wrong side of it).
 *
 * NO AIR REQUESTS. A resin printer uses no compressed air, so `/api/machine/air`
 * is deliberately not called. If the wash/cure station ever wants air, it asks
 * for its own - with its own token.
 *
 * WHEN IT SENDS. Every 10 s, exactly as the air station asks, INCLUDING during
 * a print - and without touching print timing, because the sending runs on the
 * other CPU core.
 *
 * Why a task and not the loop. The print loop does open network windows mid-
 * print (network_service_window(160) between layers), but 160 ms is the budget
 * and a blocking HTTP round trip to an unreachable host costs its full timeout.
 * Ten times over budget, on the same thread that drives UV exposure and Z
 * motion, is how you get banded layers.
 *
 * So the HTTP lives in its own FreeRTOS task pinned to core 0 - the core Arduino
 * does NOT run loop() on. It blocks there as long as it likes and the print loop
 * never waits for it. The two sides share only a small struct behind a mutex:
 * the print loop writes a state word (no allocation, no network), the task reads
 * it and reports. Nothing the task does can stall a layer.
 *
 * Core 0 also hosts the Wi-Fi driver, which is why this task is low priority and
 * sleeps between beats - it yields to the radio rather than competing with it.
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
// host/token are passed in, never read from the globals here: this runs on the
// shop task while the web handler may be rewriting those Strings on the other
// core, and a String reallocated under a reader is a crash, not a glitch.
static bool shopHttp(const char *method, const char *path, const String &body,
                     String &out, String &error,
                     const String &host, const String &token) {
  if (WiFi.status() != WL_CONNECTED) { error = "WiFi is not connected"; return false; }
  if (host.length() == 0) { error = "no air station address set"; return false; }

  String url = "http://" + host + path;
  HTTPClient http;
  WiFiClient net;
  if (!http.begin(net, url)) { error = "could not start the request"; return false; }

  // Both timeouts, deliberately short. This runs in the print loop's own
  // thread: a slow answer is a stalled printer, and the roster is not worth
  // one. Same lesson as the OTA check (auditas 08-22).
  http.setConnectTimeout(1500);
  http.setTimeout(1500);
  if (token.length()) http.addHeader("Authorization", "Bearer " + token);
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

// ---- Cross-core shared state ----------------------------------------------
//
// Touched by two threads: the print loop (writes the state word) and the shop
// task on core 0 (reads it, writes the result). Everything here is guarded -
// an Arduino String reallocated under a reader on the other core is a crash,
// not a glitch.
static SemaphoreHandle_t shopMux = nullptr;
static TaskHandle_t      shopTask = nullptr;
static char              shopWantState[8] = "idle";   // what we should be reporting
static volatile bool     shopStateDirty = false;      // send now, do not wait for the tick

#define SHOP_LOCK()   do { if (shopMux) xSemaphoreTake(shopMux, portMAX_DELAY); } while (0)
#define SHOP_UNLOCK() do { if (shopMux) xSemaphoreGive(shopMux); } while (0)

// Remembered so the dashboard can say what happened instead of looking healthy
// while nothing arrives (same reasoning as the #88 notify status).
bool     shopLastTried = false;
bool     shopLastOk    = false;
uint32_t shopLastAtMs  = 0;
char     shopLastReason[64] = {0};
char     shopLastState[8]   = {0};

// Called from the shop task. Locked: the dashboard reads these from the loop
// thread while building config JSON.
static void shopRemember(bool ok, const String &error, const char *state) {
  SHOP_LOCK();
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
  SHOP_UNLOCK();
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

// One locked copy per beat. Everything after this point works on the copies.
static void shopSnapshot(String &host, String &token, String &devId) {
  SHOP_LOCK();
  host  = shopHost;
  token = shopToken;
  devId = shopDeviceId;
  SHOP_UNLOCK();
}

// The writers. Settings form and backup restore go through here so the task
// never sees a String mid-reallocation.
void shopSetConfig(bool en, const String &host, const String &token,
                   const String &devId) {
  SHOP_LOCK();
  shopEnabled  = en;
  shopHost     = host;
  shopToken    = token;
  shopDeviceId = devId;
  SHOP_UNLOCK();
  shopForgetVerification();   // new address or new station = prove it again
}

static bool shopVerifyStation(const String &host, const String &token,
                              const String &devId, String &error) {
  // Re-check every 10 minutes: long enough to cost nothing, short enough that
  // a station swapped underneath us is noticed while the shop is still open.
  if (shopVerified && shopVerifiedAt && (uint32_t)(millis() - shopVerifiedAt) < 600000UL)
    return true;
  if (devId.length() == 0) {
    error = "no expected air station ID saved - pair the printer again";
    return false;
  }
  String out;
  // No token on this one - we do not yet know who is answering.
  if (!shopHttp("GET", "/api/info", "", out, error, host, "")) return false;
  String got = shopJsonStr(out, "device_id");
  if (got.length() == 0) { error = "that address is not an air station"; return false; }
  if (got != devId) {
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
  String host, token, devId;
  shopSnapshot(host, token, devId);
  if (token.length() == 0) { error = "not paired with the air station"; return false; }
  if (!shopVerifyStation(host, token, devId, error)) return false;  // identity BEFORE credential
  String out;
  String body = String("{\"state\":\"") + state + "\"}";
  bool ok = shopHttp("POST", "/api/machine/heartbeat", body, out, error, host, token);
  // A refused token means the pairing is gone or we are at the wrong station:
  // re-verify next time rather than retrying with a credential that failed.
  if (!ok) shopForgetVerification();
  return ok;
}

// ---- The only thing the print loop calls -----------------------------------
//
// Writes one word and returns. No network, no allocation, no waiting: safe to
// call from anywhere in the print flow, including between layers.
void shopReport(const char *state) {
  if (!shopEnabled) return;
  SHOP_LOCK();
  bool changed = strncmp(shopWantState, state, sizeof(shopWantState)) != 0;
  strncpy(shopWantState, state, sizeof(shopWantState) - 1);
  shopWantState[sizeof(shopWantState) - 1] = 0;
  SHOP_UNLOCK();
  // A state CHANGE is news - do not make the shop wait up to 10 s for it.
  if (changed) {
    shopStateDirty = true;
    if (shopTask) xTaskNotifyGive(shopTask);
  }
}

// Hooks called from the print flow. Named for the event, not the state, so the
// call sites read as what happened.
void shopNotifyPrintStarted()  { shopReport("busy"); }
void shopNotifyPrintFinished() { shopReport("idle"); }
void shopNotifyPrintCanceled() { shopReport("idle"); }
void shopNotifyFault()         { shopReport("fault"); }

// ---- The task, on core 0 ---------------------------------------------------
//
// Blocks freely: nothing on the print path waits for it.
static void shopTaskFn(void *) {
  // Let Wi-Fi and the first screen settle before the first beat.
  vTaskDelay(pdMS_TO_TICKS(5000));
  uint32_t failStreak = 0;
  for (;;) {
    // 10 s is the cadence the air station documents (presence goes stale at
    // 30 s). After repeated failures back off to 60 s: a compressor that is
    // switched off should not cost a connect attempt every 10 s all night.
    uint32_t waitMs = (failStreak >= 3) ? 60000 : 10000;
    // Wake early when the print flow reports a new state.
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(waitMs));

    if (!shopEnabled) { failStreak = 0; continue; }

    char state[8];
    SHOP_LOCK();
    strncpy(state, shopWantState, sizeof(state));
    state[sizeof(state) - 1] = 0;
    SHOP_UNLOCK();
    shopStateDirty = false;

    String error;
    bool ok = shopHeartbeat(state, error);
    shopRemember(ok, error, state);
    if (ok) failStreak = 0;
    else {
      if (failStreak < 1000) failStreak++;
      DBG("Shop heartbeat (%s) failed: %s\n", state, error.c_str());
    }
  }
}

// Started once from network_loop(). Creating it lazily keeps the task out of
// the network-free build and off boards where Shop Network was never turned on.
void shopLoop() {
  if (!shopEnabled || shopTask) return;
  if (!shopMux) shopMux = xSemaphoreCreateMutex();
  if (!shopMux) return;
  // Core 0: Arduino runs loop() on core 1, so nothing this task does can land
  // inside a layer. Priority 1 - below the Wi-Fi driver it shares the core with.
  xTaskCreatePinnedToCore(shopTaskFn, "tmshop", 4096, nullptr, 1, &shopTask, 0);
}

// Appended to configJson(). The token is never sent to the browser - only
// whether one is set, and its last 4 characters, so a person can tell two
// tokens apart without the page ever holding a credential.
String tinymakerShopConfigJson() {
  SHOP_LOCK();   // the shop task writes these from core 0
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
  SHOP_UNLOCK();
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
