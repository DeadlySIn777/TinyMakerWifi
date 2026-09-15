// Native unit tests for src/tm_pure.h - run on the PC, no board involved.
//
//   pio test -e native
//
// These cover the decisions that are silent when they go wrong: whether an
// update is offered at all, what goes into a firmware URL, which URLs are
// allowed to be flashed, whether /api/fetch can be aimed off meshy.ai, and
// whether a request really came from the printer's own page. CI runs this on
// every push (see build.yml), so a regression here shows up as a red check,
// not as a fleet that quietly stopped updating - or as an open proxy.
//
// The last two were written inside Network.ino, where the only way to exercise
// them was to flash a board and point a suite at it over the network. That
// suite exists (scripts/dev/test_fetch_proxy.mjs, 27 checks, 15 of them SSRF
// attempts) and it is good, but it needs a printer, a LAN and an internet
// connection - so it does not run in CI, and it did not run before the
// parser-differential SSRF shipped. Now the logic lives in tm_pure.h and the
// cases below run on every push, for free, on a PC.

#include <unity.h>
#include "tm_pure.h"
#include "tm_fetch_stream.h"
#include <string>

// Unity declares these extern and the linker wants them even when they do
// nothing. Leaving them out is the classic "tests compile, then fail to link".
void setUp(void) {}
void tearDown(void) {}

// ---------------------------------------------------------------- semver ---

void test_semver_ordering(void) {
  TEST_ASSERT_TRUE(tmCmpSemver("0.17.2", "0.17.1") > 0);
  TEST_ASSERT_TRUE(tmCmpSemver("0.17.1", "0.17.2") < 0);
  TEST_ASSERT_EQUAL_INT(0, tmCmpSemver("0.17.2", "0.17.2"));
  TEST_ASSERT_TRUE(tmCmpSemver("1.0.0", "0.99.99") > 0);
  TEST_ASSERT_TRUE(tmCmpSemver("0.18.0", "0.9.0") > 0);   // not string order
}

// The bug this was written for: a version.txt pasted from a git tag.
void test_semver_tolerates_v_prefix(void) {
  TEST_ASSERT_EQUAL_INT(0, tmCmpSemver("v0.17.2", "0.17.2"));
  TEST_ASSERT_EQUAL_INT(0, tmCmpSemver("V0.17.2", "v0.17.2"));
  TEST_ASSERT_TRUE(tmCmpSemver("v0.18.0", "0.17.2") > 0);
}

void test_semver_short_and_junk(void) {
  TEST_ASSERT_EQUAL_INT(0, tmCmpSemver("", ""));
  TEST_ASSERT_TRUE(tmCmpSemver("0.17", "0.17.0") == 0);   // missing patch = 0
  TEST_ASSERT_EQUAL_INT(0, tmCmpSemver(NULL, "1.0.0"));   // never crash
}

// --------------------------------------------------------------- version ---

void test_version_accepts_real_releases(void) {
  TEST_ASSERT_TRUE(tmVersionLooksValid("0.17.2"));
  TEST_ASSERT_TRUE(tmVersionLooksValid("1.0.0"));
  TEST_ASSERT_TRUE(tmVersionLooksValid("10.20.30"));
}

// Everything here would otherwise end up inside a URL the printer fetches.
void test_version_rejects_anything_else(void) {
  TEST_ASSERT_FALSE(tmVersionLooksValid(""));
  TEST_ASSERT_FALSE(tmVersionLooksValid(NULL));
  TEST_ASSERT_FALSE(tmVersionLooksValid("0.17"));          // not three parts
  TEST_ASSERT_FALSE(tmVersionLooksValid("0.17.2.1"));      // four
  TEST_ASSERT_FALSE(tmVersionLooksValid("v0.17.2"));       // 'v' is not a digit
  TEST_ASSERT_FALSE(tmVersionLooksValid("../../evil"));    // path climbing
  TEST_ASSERT_FALSE(tmVersionLooksValid("0.17.2/../x"));
  TEST_ASSERT_FALSE(tmVersionLooksValid("0.17.2?x=1"));    // query string
  TEST_ASSERT_FALSE(tmVersionLooksValid("0.17.2 "));       // trailing space
  TEST_ASSERT_FALSE(tmVersionLooksValid("999999999999999999"));
}

// ------------------------------------------------------------------- url ---

static const char *BASE = "https://slibbinas.github.io/TinyMakerWifi/";

void test_url_accepts_our_own_releases(void) {
  TEST_ASSERT_TRUE(tmUrlUnderBase(
      "https://slibbinas.github.io/TinyMakerWifi/firmware.bin", BASE));
  TEST_ASSERT_TRUE(tmUrlUnderBase(
      "https://slibbinas.github.io/TinyMakerWifi/firmware-0.17.2.bin", BASE));
}

// This is the finding the whole change exists for: line 2 of version.txt used
// to be flashed unchecked, so a forged file could send the printer anywhere.
void test_url_rejects_somewhere_else(void) {
  TEST_ASSERT_FALSE(tmUrlUnderBase("http://attacker.example/evil.bin", BASE));
  TEST_ASSERT_FALSE(tmUrlUnderBase("https://attacker.example/evil.bin", BASE));
  TEST_ASSERT_FALSE(tmUrlUnderBase(
      "http://slibbinas.github.io/TinyMakerWifi/firmware.bin", BASE));  // plain http
  TEST_ASSERT_FALSE(tmUrlUnderBase(
      "https://slibbinas.github.io.evil.example/x.bin", BASE));         // lookalike host
  TEST_ASSERT_FALSE(tmUrlUnderBase(
      "https://slibbinas.github.io/OtherRepo/firmware.bin", BASE));     // wrong directory
  TEST_ASSERT_FALSE(tmUrlUnderBase(BASE, BASE));                        // names no file
  TEST_ASSERT_FALSE(tmUrlUnderBase(NULL, BASE));
}

void test_url_rejects_climbing_out(void) {
  TEST_ASSERT_FALSE(tmUrlUnderBase(
      "https://slibbinas.github.io/TinyMakerWifi/../../evil.bin", BASE));
  TEST_ASSERT_FALSE(tmUrlUnderBase(
      "https://slibbinas.github.io/TinyMakerWifi/a/../../../evil.bin", BASE));
}

void test_url_rejects_a_bad_base(void) {
  // A base that is not https, or not a directory, must never match anything.
  TEST_ASSERT_FALSE(tmUrlUnderBase("http://x/y.bin", "http://x/"));
  TEST_ASSERT_FALSE(tmUrlUnderBase(
      "https://slibbinas.github.io/TinyMakerWifiEXTRA/f.bin",
      "https://slibbinas.github.io/TinyMakerWifi"));   // no trailing slash
}

// ---------------------------------------------------------------------------


// ------------------------------------------------------------------ SSRF ---
//
// Fourteen of these are the exact URLs a real printer refused on 2026-09-14,
// copied from scripts/dev/test_fetch_proxy.mjs so the two suites cannot drift.
// The parser-differential pair is the one that matters most: it SHIPPED, it
// returned Example Domain's HTML through the printer, and the same trick aimed
// at 192.168.1.1 reached the gateway over TLS from inside the network.

void test_ssrf_refuses_lookalikes(void) {
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://evil.com/?x=meshy.ai"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai.evil.com/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://notmeshy.ai/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("http://assets.meshy.ai/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("file:///etc/passwd"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://192.168.1.1/admin"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://127.0.0.1/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https:///etc/passwd"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed(NULL));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed(""));
}

void test_ssrf_refuses_the_parser_differential(void) {
  // The one that was live. meshyUrlAllowed stopped the host at the first of
  // '/', '?' or '#'; HTTPClient stops the authority at '/' only and then drops
  // everything before an '@' as userinfo. One string, two hosts.
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai?@example.com/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai#@example.com/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai?@192.168.1.1/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai?@192.168.1.1:443/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai@example.com/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://user:pass@assets.meshy.ai/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai\\@example.com/"));
  // Anything whitespace can be read two ways by two parsers. Refuse it.
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai @evil.com/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai\t@evil.com/"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://meshy.ai\n@evil.com/"));
}

void test_ssrf_allows_what_it_must(void) {
  // An allowlist that refuses everything passes every test above. These are
  // the URLs the product cannot work without.
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://assets.meshy.ai/x.glb"));
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://api.meshy.ai/v2/text-to-3d"));
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://meshy.ai/"));
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://www.meshy.ai/favicon.ico"));
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://assets.meshy.ai"));          // no path
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://assets.meshy.ai:443/x.glb"));
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://ASSETS.MESHY.AI/x"));        // case
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://www.meshy.ai./favicon.ico")); // trailing dot
}

void test_trailing_dot_is_normalised_not_refused(void) {
  // The guard ignores a trailing dot on purpose - same host in DNS - but lwIP's
  // resolver will not take one, so an approved URL came back 502 every time.
  char out[128];
  TEST_ASSERT_TRUE(tmNormaliseHostDots("https://www.meshy.ai./favicon.ico", out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("https://www.meshy.ai/favicon.ico", out);
  TEST_ASSERT_TRUE(tmNormaliseHostDots("https://assets.meshy.ai.:443/x", out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("https://assets.meshy.ai:443/x", out);
  // Nothing to do, so it says so and the caller keeps the original.
  TEST_ASSERT_FALSE(tmNormaliseHostDots("https://assets.meshy.ai/x", out, sizeof(out)));
  // It may never turn a refused URL into an allowed one: it only ever removes
  // dots from the host, and it runs AFTER the check in any case.
  TEST_ASSERT_FALSE(tmNormaliseHostDots("https://evil.com/x", out, sizeof(out)));
  // And it refuses rather than truncating when the buffer is too small.
  char tiny[8];
  TEST_ASSERT_FALSE(tmNormaliseHostDots("https://www.meshy.ai./x", tiny, sizeof(tiny)));
}

// ------------------------------------------------------------------ CSRF ---

void test_host_is_ours_accepts_our_own_names(void) {
  const char *sta = "192.168.1.22", *ap = "192.168.4.1";
  TEST_ASSERT_TRUE(tmHostIsOurs("192.168.1.22", sta, ap));
  TEST_ASSERT_TRUE(tmHostIsOurs("192.168.1.22:80", sta, ap));
  TEST_ASSERT_TRUE(tmHostIsOurs("192.168.4.1", sta, ap));
  TEST_ASSERT_TRUE(tmHostIsOurs("tinymaker.local", sta, ap));
  TEST_ASSERT_TRUE(tmHostIsOurs("TinyMaker.Local", sta, ap));
  TEST_ASSERT_TRUE(tmHostIsOurs("tinymaker.local.", sta, ap));
  TEST_ASSERT_TRUE(tmHostIsOurs("tinymaker", sta, ap));
  TEST_ASSERT_TRUE(tmHostIsOurs("localhost", sta, ap));
}

void test_host_is_ours_refuses_a_rebound_name(void) {
  // THE ATTACK. Origin and Host agree perfectly - that is what rebinding does -
  // and the name is not ours.
  const char *sta = "192.168.1.22", *ap = "192.168.4.1";
  TEST_ASSERT_FALSE(tmHostIsOurs("printer.evil.com", sta, ap));
  TEST_ASSERT_FALSE(tmHostIsOurs("tinymaker.local.evil.com", sta, ap));
  TEST_ASSERT_FALSE(tmHostIsOurs("192.168.1.23", sta, ap));       // the neighbour
  TEST_ASSERT_FALSE(tmHostIsOurs("192.168.1.22:8080", sta, ap));  // our IP, not our port
  TEST_ASSERT_FALSE(tmHostIsOurs("", sta, ap));
  TEST_ASSERT_FALSE(tmHostIsOurs(".", sta, ap));
  TEST_ASSERT_FALSE(tmHostIsOurs(NULL, sta, ap));
  // An interface that is down contributes no name.
  TEST_ASSERT_FALSE(tmHostIsOurs("192.168.4.1", sta, ""));
  TEST_ASSERT_FALSE(tmHostIsOurs("192.168.1.22", NULL, NULL));
}

void test_host_port_checked_before_host_normalisation(void) {
  TEST_ASSERT_FALSE(tmHostIsOurs("tinymaker.local.:8080", "", ""));
  TEST_ASSERT_FALSE(tmHostIsOurs("tinymaker.local..:443", "", ""));
  TEST_ASSERT_FALSE(tmHostIsOurs("tinymaker.local :8080", "", ""));
  TEST_ASSERT_FALSE(tmHostIsOurs("tinymaker.local:", "", ""));
  TEST_ASSERT_FALSE(tmHostIsOurs("tinymaker.local:80/path", "", ""));
  TEST_ASSERT_FALSE(tmHostIsOurs("0.0.0.0", "0.0.0.0", "0.0.0.0"));
  TEST_ASSERT_TRUE(tmHostIsOurs("tinymaker.local.:80", "", ""));
  TEST_ASSERT_TRUE(tmHostIsOurs("  TinyMaker.Local:80\t", "", ""));
}

void test_ssrf_refuses_request_line_injection_and_bad_authority(void) {
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://assets.meshy.ai/x\r\nHost: evil.com"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://assets.meshy.ai/a b"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://assets.meshy.ai:443:80/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://assets.meshy.ai:garbage/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://assets.meshy.ai:80/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://assets.meshy.ai:/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://.meshy.ai/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://assets..meshy.ai/x"));
  TEST_ASSERT_FALSE(tmMeshyUrlAllowed("https://%61ssets.meshy.ai/x"));
  TEST_ASSERT_TRUE(tmMeshyUrlAllowed("https://assets.meshy.ai/path/model.glb?signature=a%2Bb&expires=123"));
}

void test_firmware_url_refuses_encoded_and_header_escapes(void) {
  TEST_ASSERT_FALSE(tmUrlUnderBase("https://slibbinas.github.io/TinyMakerWifi/%2e%2e/elsewhere.bin", BASE));
  TEST_ASSERT_FALSE(tmUrlUnderBase("https://slibbinas.github.io/TinyMakerWifi/a\\..\\elsewhere.bin", BASE));
  TEST_ASSERT_FALSE(tmUrlUnderBase("https://slibbinas.github.io/TinyMakerWifi/firmware.bin\r\nHost: evil.com", BASE));
  TEST_ASSERT_FALSE(tmUrlUnderBase("https://slibbinas.github.io/TinyMakerWifi/?redirect=other", BASE));
}

void test_version_numeric_overflow_refused(void) {
  TEST_ASSERT_FALSE(tmVersionLooksValid("99999999999.1.1"));
  TEST_ASSERT_FALSE(tmVersionLooksValid("2147483648.0.0"));
  TEST_ASSERT_TRUE(tmVersionLooksValid("2147483647.0.0"));
  TEST_ASSERT_TRUE(tmCmpSemver("2147483647.0.0", "0.0.0") > 0);
  TEST_ASSERT_EQUAL_INT(0, tmCmpSemver("999999999999999999.0.0", "0.0.0"));
}

void test_update_busy_wins_for_every_menu_and_web_state(void) {
  for (int menu = 0; menu < 2; menu++) {
    for (int web = 0; web < 2; web++) {
      TEST_ASSERT_FALSE(tmOtaAllowed(true, menu != 0, web != 0));
      TEST_ASSERT_EQUAL(menu || web, tmOtaAllowed(false, menu != 0, web != 0));
    }
  }
}

void test_tls_waits_for_a_real_clock(void) {
  TEST_ASSERT_FALSE(tmTlsClockReady(0));
  TEST_ASSERT_FALSE(tmTlsClockReady(-1));
  TEST_ASSERT_FALSE(tmTlsClockReady(1699999999LL));
  TEST_ASSERT_TRUE(tmTlsClockReady(1700000000LL));
  TEST_ASSERT_TRUE(tmTlsClockReady(2200000000LL));
}

// Fake socket, real forwarding adapter: test exact bytes and short writes,
// including framing failures that WebServer::sendContent cannot report.
struct NativeStream {
  virtual ~NativeStream() {}
  virtual size_t write(uint8_t) = 0;
  virtual size_t write(const uint8_t *, size_t) = 0;
  virtual int available() = 0;
  virtual int read() = 0;
  virtual int peek() = 0;
  virtual void flush() = 0;
  bool error = false;
  void setWriteError() { error = true; }
};
struct SocketState {
  std::string bytes;
  bool alive = true;
  unsigned calls = 0;
  unsigned shortAt = 0;
};
struct NativeClient {
  SocketState *s;
  bool connected() { return s->alive; }
  void stop() { s->alive = false; }
  size_t write(const uint8_t *buf, size_t n) {
    s->calls++;
    if (!s->alive) return 0;
    size_t count = s->calls == s->shortAt ? n - 1 : n;
    s->bytes.append((const char *)buf, count);
    return count;
  }
};
typedef TmFetchStream<NativeStream, NativeClient> NativeFetchStream;

struct NativeResponseServerBase {
  SocketState socket;
  explicit NativeResponseServerBase(uint16_t) {}
  NativeClient client() { return NativeClient{&socket}; }
  void advertiseChunked(bool chunked) { _chunked = chunked; }
 protected:
  bool _chunked = false;
};

void test_fetch_uses_advertised_framing_for_unknown_length_body(void) {
  // Real adapter and real accessor, with the core's already-chosen header
  // state supplied by the fixture. Do not infer framing from body length:
  // both cases have an unknown length, but HTTP/1.0 must receive raw bytes.
  const uint8_t body[] = {'g', 'l', 'T', 'F', 0, 255};
  TmResponseServer<NativeResponseServerBase> http10(80);
  http10.advertiseChunked(false);
  NativeFetchStream raw(http10, 20);
  TEST_ASSERT_EQUAL_UINT(sizeof(body), raw.write(body, sizeof(body)));
  TEST_ASSERT_TRUE(raw.complete(sizeof(body), -1));
  TEST_ASSERT_EQUAL_UINT(sizeof(body), http10.socket.bytes.size());
  TEST_ASSERT_EQUAL_MEMORY(body, http10.socket.bytes.data(), sizeof(body));

  TmResponseServer<NativeResponseServerBase> http11(80);
  http11.advertiseChunked(true);
  NativeFetchStream chunks(http11, 20);
  TEST_ASSERT_EQUAL_UINT(sizeof(body), chunks.write(body, sizeof(body)));
  TEST_ASSERT_TRUE(chunks.complete(sizeof(body), -1));
  std::string expected = std::string("6\r\n") +
                         std::string((const char *)body, sizeof(body)) + "\r\n";
  TEST_ASSERT_EQUAL_UINT(expected.size(), http11.socket.bytes.size());
  TEST_ASSERT_EQUAL_MEMORY(expected.data(), http11.socket.bytes.data(), expected.size());
}

void test_fetch_known_length_preserves_binary_and_detects_truncation(void) {
  SocketState s;
  NativeFetchStream out(NativeClient{&s}, false, 20);
  const uint8_t body[] = {'g', 'l', 'T', 'F', 0, 255};
  TEST_ASSERT_EQUAL_UINT(6, out.write(body, sizeof(body)));
  TEST_ASSERT_EQUAL_UINT(6, s.bytes.size());
  TEST_ASSERT_EQUAL_MEMORY(body, s.bytes.data(), sizeof(body));
  TEST_ASSERT_TRUE(out.complete(6, 6));
  TEST_ASSERT_FALSE(out.complete(-1, 6));
  TEST_ASSERT_FALSE(out.complete(6, 8));
  TEST_ASSERT_FALSE(out.complete(5, 6));
}

void test_fetch_chunked_frames_only_decoded_payload(void) {
  SocketState s;
  NativeFetchStream out(NativeClient{&s}, true, 20);
  TEST_ASSERT_EQUAL_UINT(4, out.write((const uint8_t *)"glTF", 4));
  TEST_ASSERT_EQUAL_UINT(1, out.write((uint8_t)'!'));
  TEST_ASSERT_EQUAL_STRING("4\r\nglTF\r\n1\r\n!\r\n", s.bytes.c_str());
  TEST_ASSERT_TRUE(out.complete(5, -1));
  TEST_ASSERT_EQUAL_UINT(5, out.written);
  // Final zero chunk belongs to the caller ONLY after complete() succeeds.
  TEST_ASSERT_TRUE(s.bytes.find("0\r\n\r\n") == std::string::npos);
}

void test_fetch_unknown_length_enforces_limit_and_latches_failure(void) {
  SocketState s;
  NativeFetchStream out(NativeClient{&s}, true, 4);
  TEST_ASSERT_EQUAL_UINT(4, out.write((const uint8_t *)"glTF", 4));
  TEST_ASSERT_TRUE(out.complete(4, -1));
  TEST_ASSERT_EQUAL_UINT(0, out.write((uint8_t)'!'));
  TEST_ASSERT_TRUE(out.failed);
  TEST_ASSERT_TRUE(out.error);
  TEST_ASSERT_FALSE(s.alive);
  TEST_ASSERT_FALSE(out.complete(4, -1));
  unsigned calls = s.calls;
  TEST_ASSERT_EQUAL_UINT(0, out.write((const uint8_t *)"retry", 5));
  TEST_ASSERT_EQUAL_UINT(calls, s.calls);
}

void test_fetch_stops_on_short_header_body_or_footer_write(void) {
  for (unsigned step = 1; step <= 3; step++) {
    SocketState s;
    s.shortAt = step;
    NativeFetchStream out(NativeClient{&s}, true, 20);
    TEST_ASSERT_EQUAL_UINT(0, out.write((const uint8_t *)"glTF", 4));
    TEST_ASSERT_FALSE(s.alive);
    TEST_ASSERT_TRUE(out.failed);
    TEST_ASSERT_FALSE(out.complete(4, -1));
  }
  SocketState disconnected;
  disconnected.alive = false;
  NativeFetchStream out(NativeClient{&disconnected}, false, 20);
  TEST_ASSERT_EQUAL_UINT(0, out.write((uint8_t)'x'));
  TEST_ASSERT_TRUE(out.failed);
  TEST_ASSERT_EQUAL_UINT(0, disconnected.calls);
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_semver_ordering);
  RUN_TEST(test_semver_tolerates_v_prefix);
  RUN_TEST(test_semver_short_and_junk);
  RUN_TEST(test_version_accepts_real_releases);
  RUN_TEST(test_version_rejects_anything_else);
  RUN_TEST(test_url_accepts_our_own_releases);
  RUN_TEST(test_url_rejects_somewhere_else);
  RUN_TEST(test_url_rejects_climbing_out);
  RUN_TEST(test_url_rejects_a_bad_base);
  RUN_TEST(test_ssrf_refuses_lookalikes);
  RUN_TEST(test_ssrf_refuses_the_parser_differential);
  RUN_TEST(test_ssrf_allows_what_it_must);
  RUN_TEST(test_trailing_dot_is_normalised_not_refused);
  RUN_TEST(test_host_is_ours_accepts_our_own_names);
  RUN_TEST(test_host_is_ours_refuses_a_rebound_name);
  RUN_TEST(test_host_port_checked_before_host_normalisation);
  RUN_TEST(test_ssrf_refuses_request_line_injection_and_bad_authority);
  RUN_TEST(test_firmware_url_refuses_encoded_and_header_escapes);
  RUN_TEST(test_version_numeric_overflow_refused);
  RUN_TEST(test_update_busy_wins_for_every_menu_and_web_state);
  RUN_TEST(test_tls_waits_for_a_real_clock);
  RUN_TEST(test_fetch_uses_advertised_framing_for_unknown_length_body);
  RUN_TEST(test_fetch_known_length_preserves_binary_and_detects_truncation);
  RUN_TEST(test_fetch_chunked_frames_only_decoded_payload);
  RUN_TEST(test_fetch_unknown_length_enforces_limit_and_latches_failure);
  RUN_TEST(test_fetch_stops_on_short_header_body_or_footer_write);
  return UNITY_END();
}
