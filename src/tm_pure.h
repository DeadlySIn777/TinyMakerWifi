// Pure helpers: no Arduino, no WiFi, no SD - just strings and numbers.
//
// WHY THEY LIVE HERE. These three decide things that are expensive to get
// wrong and impossible to notice:
//
//   tmCmpSemver       whether a printer ever sees an update again
//   tmVersionLooksValid  what gets pasted into a URL the printer will fetch
//   tmUrlUnderBase    whether a firmware image is allowed to be flashed
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

// Compare two "MAJOR.MINOR.PATCH" strings. >0 if a>b, <0 if a<b, 0 if equal.
// Tolerates a leading "v"/"V" (e.g. a version.txt copied from a git tag name) -
// without this, "v0.8.0" would parse as 0.0.0 and silently report "Up to date".
inline int tmCmpSemver(const char *a, const char *b) {
  if (!a || !b) return 0;
  if (*a == 'v' || *a == 'V') a++;
  if (*b == 'v' || *b == 'V') b++;
  int va[3] = {0, 0, 0}, vb[3] = {0, 0, 0};
  sscanf(a, "%d.%d.%d", &va[0], &va[1], &va[2]);
  sscanf(b, "%d.%d.%d", &vb[0], &vb[1], &vb[2]);
  for (int i = 0; i < 3; i++) if (va[i] != vb[i]) return va[i] - vb[i];
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
  for (size_t i = 0; i < n; i++) {
    char c = v[i];
    if (!((c >= '0' && c <= '9') || c == '.')) return false;
  }
  int a, b, c; char tail;
  return sscanf(v, "%d.%d.%d%c", &a, &b, &c, &tail) == 3;
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
  // Nothing may climb back out of the directory we just pinned it to.
  if (strstr(url + lb, "..") != NULL) return false;
  return url[lb] != '\0';                                 // and name a file
}

#endif  // TM_PURE_H
