// Pure helpers: no Arduino, no WiFi, no SD - just strings and numbers.
//
// WHY THEY LIVE HERE. These decide things that are expensive to get wrong and
// impossible to notice:
//
//   tmCmpSemver       whether a printer ever sees an update again
//   tmVersionLooksValid  what gets pasted into a URL the printer will fetch
//   tmUrlUnderBase    whether a firmware image is allowed to be flashed
//   tmMeshyUrlAllowed whether /api/fetch can be aimed off meshy.ai
//   tmHostIsOurs      whether a request really came from this printer's page
//
// Inside a .ino they can only be checked by flashing a board and watching.
// Here they compile on a PC, so `pio test -e native` runs them on every push
// and CI catches a regression before it reaches anyone's printer. That is the
// whole reason for the file - keep it free of Arduino types so it stays that
// way.
//
// Tests: test/test_pure/test_main.cpp

#ifndef TM_PURE_H
#define TM_PURE_H

#include <stdio.h>
#include <string.h>
#include <limits.h>

// Decimal parsing with a bound checked BEFORE multiplication. sscanf("%d")
// has undefined behaviour for an out-of-range component supplied by a URL or
// remote version file. Missing trailing components are only for comparisons.
inline bool tmParseVersion(const char *v, int parts[3], bool allowShort) {
  if (!v || !*v) return false;
  for (int i = 0; i < 3; i++) {
    if (*v < '0' || *v > '9') return false;
    int value = 0;
    while (*v >= '0' && *v <= '9') {
      int digit = *v++ - '0';
      if (value > (INT_MAX - digit) / 10) return false;
      value = value * 10 + digit;
    }
    parts[i] = value;
    if (!*v) return i == 2 || allowShort;
    if (i == 2 || *v++ != '.') return false;
  }
  return false;
}

// Compare two "MAJOR.MINOR.PATCH" strings. >0 if a>b, <0 if a<b, 0 if equal.
// Tolerates a leading "v"/"V" (e.g. a version.txt copied from a git tag name) -
// without this, "v0.8.0" would parse as 0.0.0 and silently report "Up to date".
inline int tmCmpSemver(const char *a, const char *b) {
  if (!a || !b) return 0;
  if (*a == 'v' || *a == 'V') a++;
  if (*b == 'v' || *b == 'V') b++;
  int va[3] = {0, 0, 0}, vb[3] = {0, 0, 0};
  if (!tmParseVersion(a, va, true) || !tmParseVersion(b, vb, true)) return 0;
  for (int i = 0; i < 3; i++) if (va[i] != vb[i]) return va[i] > vb[i] ? 1 : -1;
  return 0;
}

// Is this string safe to paste into "firmware-<X>.bin"? Exactly three numbers
// and two dots, nothing else - no slashes, no dots that could climb a path, no
// query string. The URL is built from it, so this is the only thing standing
// between a request argument and the address the printer fetches.
inline bool tmVersionLooksValid(const char *v) {
  if (!v || !*v) return false;
  size_t n = strlen(v);
  if (n > 15) return false;                  // 5.5.5 digits is already absurd
  int parts[3] = {0, 0, 0};
  return tmParseVersion(v, parts, false);
}

// Does `url` sit under `base`? Used to decide whether a firmware image may be
// flashed. Deliberately strict and deliberately dumb: a prefix match on an
// https:// base, no parsing, no normalising, nothing clever that could be
// talked out of a "no".
inline bool tmUrlUnderBase(const char *url, const char *base) {
  if (!url || !base) return false;
  if (strncmp(base, "https://", 8) != 0) return false;   // never trust an http base
  size_t lb = strlen(base);
  if (lb == 0 || base[lb - 1] != '/') return false;       // a base is a directory
  if (strncmp(url, base, lb) != 0) return false;
  // Only ordinary release paths. Percent-encoded dots/slashes and backslashes
  // may be normalised by the HTTP server after our literal prefix check.
  for (const char *p = url + lb; *p; p++) {
    unsigned char c = (unsigned char)*p;
    if (c <= 32 || c >= 127 || c == '%' || c == '\\' || c == '?' || c == '#') return false;
  }
  // Nothing may climb back out of the directory we just pinned it to.
  if (strstr(url + lb, "..") != NULL) return false;
  return url[lb] != '\0';                                 // and name a file
}


// ---------------------------------------------------------------- SSRF ---
//
// May /api/fetch be pointed at this URL? The printer sits INSIDE the network
// with the firewall already behind it, so every "no" here is a place somebody
// would otherwise be able to aim it.
//
// THE AUTHORITY ENDS AT '/' AND NOWHERE ELSE, because that is where
// HTTPClient::beginInternal ends it. The first version of this stopped at the
// first of '/', '?' or '#' instead, and that one difference was a live SSRF:
//
//     https://meshy.ai?@example.com/
//
// The checker read the host as "meshy.ai" - no '@' in that slice, so the
// credentials guard never fired - and allowed it. HTTPClient read the authority
// as "meshy.ai?@example.com", discarded "meshy.ai?" as userinfo, and connected
// to example.com. Demonstrated on a real device: that URL returned Example
// Domain's HTML, and the same trick aimed at 192.168.1.1 reached the gateway
// over TLS, from inside the network.
//
// Two parsers reading one string and disagreeing is the bug class that defeats
// allowlists. So there is ONE parse, it matches the fetcher's, and anything
// ambiguous is REFUSED rather than interpreted.
inline bool tmMeshyUrlAllowed(const char *url) {
  if (!url) return false;
  if (strncmp(url, "https://", 8) != 0) return false;
  // HTTPClient writes the path into its request line. Check the WHOLE URL,
  // otherwise a permitted host can smuggle additional headers via CR/LF.
  for (const char *p = url; *p; p++) {
    unsigned char c = (unsigned char)*p;
    if (c <= 32 || c >= 127 || c == '\\') return false;
  }

  const char *a = url + 8;                       // start of the authority
  size_t alen = 0;
  while (a[alen] && a[alen] != '/') alen++;      // ...and it ends at '/', only
  if (alen == 0) return false;                   // https:///path
  if (alen > 255) return false;                  // no legal host is this long

  // An '@' is credentials - HTTPClient would drop everything before it, so the
  // host is not the one this string appears to name. A '?' or '#' inside the
  // authority can only mean the two readings differ. Refuse all three, and
  // every whitespace or backslash that could be read two ways as well.
  for (size_t i = 0; i < alen; i++) {
    char c = a[i];
    if (c == '@' || c == '?' || c == '#') return false;
    if (c == ' ' || c == '\\' || c == '\t' || c == '\r' || c == '\n') return false;
  }

  size_t hlen = 0;                               // host = authority minus :port
  while (hlen < alen && a[hlen] != ':') hlen++;
  // This endpoint only needs public HTTPS. Refuse arbitrary services and
  // malformed port strings instead of relying on HTTPClient's atoi parser.
  if (hlen < alen && (alen - hlen != 4 || strncmp(a + hlen, ":443", 4) != 0)) return false;
  char host[256];
  if (hlen == 0 || hlen >= sizeof(host)) return false;
  for (size_t i = 0; i < hlen; i++) {
    char c = a[i];
    host[i] = (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
  }
  host[hlen] = '\0';
  while (hlen > 0 && host[hlen - 1] == '.') host[--hlen] = '\0';   // trailing dot
  if (hlen == 0) return false;
  size_t label = 0;
  for (size_t i = 0; i < hlen; i++) {
    char c = host[i];
    if (c == '.') {
      if (label == 0 || host[i - 1] == '-') return false;
      label = 0;
    } else {
      if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
      if ((label == 0 && c == '-') || ++label > 63) return false;
    }
  }
  if (label == 0 || host[hlen - 1] == '-') return false;

  if (strcmp(host, "meshy.ai") == 0) return true;
  // endsWith(".meshy.ai") - the leading dot matters: without it
  // "notmeshy.ai" passes.
  const char *suffix = ".meshy.ai";
  size_t sl = strlen(suffix);
  return hlen > sl && strcmp(host + (hlen - sl), suffix) == 0;
}

// The same URL with any trailing dot on the host removed. The guard above
// deliberately ignores a trailing dot - "assets.meshy.ai." is the same host in
// DNS - but lwIP's resolver will not take one, so a URL the guard had just
// approved came back 502 every time. Normalising is a SPELLING fix applied
// AFTER the check, never before it: it can never turn a refused URL into an
// allowed one. Writes at most `cap` bytes including the terminator; returns
// false if it would not fit, in which case the caller uses the original.
inline bool tmNormaliseHostDots(const char *url, char *out, size_t cap) {
  if (!url || !out || cap == 0) return false;
  if (strncmp(url, "https://", 8) != 0) return false;
  const char *a = url + 8;
  size_t alen = 0;
  while (a[alen] && a[alen] != '/') alen++;
  size_t hlen = 0;
  while (hlen < alen && a[hlen] != ':') hlen++;
  size_t trimmed = hlen;
  while (trimmed > 0 && a[trimmed - 1] == '.') trimmed--;
  if (trimmed == hlen) return false;                  // nothing to do
  size_t need = 8 + trimmed + (alen - hlen) + strlen(a + alen) + 1;
  if (need > cap) return false;
  size_t o = 0;
  memcpy(out + o, "https://", 8); o += 8;
  memcpy(out + o, a, trimmed);    o += trimmed;       // host, dots trimmed
  memcpy(out + o, a + hlen, alen - hlen); o += alen - hlen;   // :port
  strcpy(out + o, a + alen);                          // path and the rest
  return true;
}

// --------------------------------------------------------------- CSRF ---
//
// Is this authority one of the printer's OWN names?
//
// WITHOUT THIS THE WHOLE CSRF GATE FALLS TO DNS REBINDING. requestFromOwnUi
// used to test Origin == Host and stop there - and BOTH of those headers come
// out of the same request, so an attacker supplies both and they agree.
// Register printer.evil.com with a one-second TTL, get the owner to open
// http://printer.evil.com/, let the record rebind to the LAN address, and every
// POST on this box is reachable from a page the owner merely visited: start a
// print, move the Z axis, delete a file, flash the firmware.
//
// The fix is to compare against something the request cannot choose. `sta` and
// `ap` are the printer's own addresses, passed in so this stays free of WiFi
// types; either may be null or empty when that interface is down.
inline bool tmHostIsOurs(const char *authority, const char *sta, const char *ap) {
  if (!authority) return false;
  char h[256];
  // Trim only the header's surrounding whitespace. The raw host boundary
  // must remain separate from its normalised length: trimming a trailing dot
  // before checking authority[n] used to skip :8080 altogether.
  while (*authority == ' ' || *authority == '\t') authority++;
  size_t length = strlen(authority);
  while (length && (authority[length - 1] == ' ' || authority[length - 1] == '\t')) length--;
  if (!length || length >= sizeof(h)) return false;
  size_t hostEnd = 0;
  while (hostEnd < length && authority[hostEnd] != ':') hostEnd++;
  if (hostEnd < length && (length - hostEnd != 3 || strncmp(authority + hostEnd, ":80", 3) != 0)) return false;
  size_t n = 0;
  while (n < hostEnd) {
    char c = authority[n];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '.' || c == '-')) return false;
    h[n] = (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
    n++;
  }
  h[n] = '\0';
  while (n > 0 && h[n - 1] == '.') h[--n] = '\0';
  if (n == 0) return false;

  if (strcmp(h, "tinymaker.local") == 0) return true;
  if (strcmp(h, "tinymaker") == 0) return true;
  if (strcmp(h, "localhost") == 0) return true;
  if (strcmp(h, "127.0.0.1") == 0) return true;
  if (sta && *sta && strcmp(sta, "0.0.0.0") != 0 && strcmp(h, sta) == 0) return true;
  if (ap  && *ap  && strcmp(ap, "0.0.0.0") != 0 && strcmp(h, ap)  == 0) return true;
  return false;
}

// A menu value can be stale during homing/exposure/other machine work.
// Busy ALWAYS wins, regardless of the screen or web-control setting.
inline bool tmOtaAllowed(bool busy, bool updateMenu, bool webControl) {
  return !busy && (updateMenu || webControl);
}

// SNTP starts asynchronously. Do not mislabel a pre-sync certificate rejection
// as a broken download or weaken verification to make it succeed.
inline bool tmTlsClockReady(long long epoch) { return epoch >= 1700000000LL; }

#endif  // TM_PURE_H
