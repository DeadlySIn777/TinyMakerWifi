// Native unit tests for src/tm_pure.h - run on the PC, no board involved.
//
//   pio test -e native
//
// These cover the three decisions that are silent when they go wrong: whether
// an update is offered at all, what goes into a firmware URL, and which URLs
// are allowed to be flashed. CI runs this on every push (see build.yml), so a
// regression here shows up as a red check, not as a fleet that quietly stopped
// updating.

#include <unity.h>
#include "tm_pure.h"

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
  return UNITY_END();
}
