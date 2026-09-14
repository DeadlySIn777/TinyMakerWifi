/* The download proxy, against a real printer and a real server.
 *
 * WHY THIS EXISTS AS A SEPARATE SCRIPT. Every other test in this directory runs
 * the pure modules in node. This one cannot: /api/fetch is C++ on the device,
 * and the bug it was written for could not have been found any other way.
 *
 * That bug: the first version streamed http.getStreamPtr(), which is the RAW
 * SOCKET - so a response with Transfer-Encoding: chunked arrived with its
 * framing in the bytes, and the proxy copied it into the file. The result was
 * 15,426 bytes where the server sent 15,406, beginning with a hex chunk length
 * and ending with the terminating chunk. HTTP 200, plausible size, no error
 * anywhere: the GLB reader would have said "not a glTF file" and the blame
 * would have gone to Meshy. Nothing in the code looked wrong. It only fell out
 * of fetching the same file both ways and comparing the bytes.
 *
 * So that is what this does, and it is also the allowlist's regression test -
 * an SSRF check that is never exercised is a comment.
 *
 *   node scripts/dev/test_fetch_proxy.mjs 192.168.1.22
 *
 * Needs a printer on the network and an internet connection; skips cleanly with
 * a message if either is missing, because a test that fails for want of a WiFi
 * link teaches nobody anything.
 */

import { createHash } from 'node:crypto';

const host = process.argv[2] || '192.168.1.22';
const base = 'http://' + host;
let pass = 0, fail = 0, skipped = 0;

const ok = (name, good, detail) => {
  if (good) { pass++; console.log('  OK   ' + name + (detail ? ': ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ': ' + detail : '')); }
};

const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 32);

async function get(url, opts) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), (opts && opts.ms) || 60000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: (opts && opts.headers) || {} });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  } finally { clearTimeout(t); }
}

const OWN = { 'X-TinyMaker': '1' };

console.log('the download proxy, against ' + base);

// ---- is anything there? -----------------------------------------------------
let up = false;
try {
  const s = await get(base + '/api/status', { ms: 6000 });
  up = s.status === 200;
} catch (e) { /* handled below */ }
if (!up) {
  console.log('\n  SKIPPED - no printer answering at ' + host +
              '. Pass its address as the first argument.');
  process.exit(0);
}

// ---- the bytes have to survive the trip -------------------------------------
/* A public file on the allowlisted host, served CHUNKED - which is the whole
   point: an identity-encoded response would have passed the broken version. */
const PROBE = 'https://www.meshy.ai/favicon.ico';
let direct = null;
try { direct = await get(PROBE, { ms: 30000 }); } catch (e) { /* offline */ }

if (!direct || direct.status !== 200) {
  console.log('  SKIPPED - could not reach ' + PROBE + ' directly to compare against.');
  skipped++;
} else {
  const via = await get(base + '/api/fetch?u=' + encodeURIComponent(PROBE),
                        { headers: OWN, ms: 90000 });
  ok('the proxy answers 200', via.status === 200, String(via.status));
  ok('the same number of bytes come out', via.buf.length === direct.buf.length,
     via.buf.length + ' vs ' + direct.buf.length);
  ok('and they are the same bytes', sha(via.buf) === sha(direct.buf),
     sha(via.buf) + ' vs ' + sha(direct.buf));
  /* Named explicitly, because this is the shape the bug had. */
  const framing = via.buf.length > 2 && /^[0-9a-f]{1,6}\r\n/.test(via.buf.subarray(0, 8).toString('latin1'));
  ok('no chunk framing leaked into the body', !framing,
     framing ? 'starts with ' + via.buf.subarray(0, 8).toString('latin1').replace(/\r/g, '\\r').replace(/\n/g, '\\n') : 'clean');
}

// ---- the allowlist ----------------------------------------------------------
/* An SSRF guard that is never exercised is a comment. This endpoint sits INSIDE
   the network with the firewall already behind it, so every one of these is a
   place somebody could otherwise aim it. */
console.log('\nthe allowlist');
const shouldRefuse = [
  ['a lookalike in the query',   'https://evil.com/?x=meshy.ai'],
  ['a lookalike as a subdomain', 'https://meshy.ai.evil.com/x'],
  ['plain http',                 'http://assets.meshy.ai/x'],
  ['credentials in the authority', 'https://user:pass@assets.meshy.ai/x'],
  ['a private address',          'https://192.168.1.1/admin'],
  ['localhost',                  'https://127.0.0.1/'],
  ['a file URL',                 'file:///etc/passwd'],
  ['an empty authority',         'https:///etc/passwd'],
  ['a trailing dot',             'https://assets.meshy.ai./x'],
  /* THE PARSER DIFFERENTIAL. Every attack above is a variation on one idea - a
     lookalike hostname - and all nine passed while the endpoint was WIDE OPEN,
     because the real hole was two parsers reading one string differently.
     meshyUrlAllowed stopped the host at the first of '/', '?' or '#';
     HTTPClient stops the authority at '/' only and then drops everything before
     an '@' as userinfo. So "https://meshy.ai?@example.com/" looked like
     meshy.ai to the guard and was example.com to the fetcher. Demonstrated on
     the live device: 200, with Example Domain's HTML. Aimed at 192.168.1.1 it
     reached the gateway over TLS, from inside the network. */
  ['a query smuggling a second host',    'https://meshy.ai?@example.com/'],
  ['a fragment smuggling a second host', 'https://meshy.ai#@example.com/'],
  ['the same aimed at the gateway',      'https://meshy.ai?@192.168.1.1/'],
  ['the same with a port',               'https://meshy.ai?@192.168.1.1:443/'],
  ['userinfo before a real host',        'https://meshy.ai@example.com/'],
  ['a backslash instead of a slash',     'https://meshy.ai\@example.com/'],
];
for (const [name, u] of shouldRefuse) {
  let body = '', status = 0;
  try {
    const r = await get(base + '/api/fetch?u=' + encodeURIComponent(u), { headers: OWN, ms: 20000 });
    status = r.status; body = r.buf.toString('utf8').slice(0, 160);
  } catch (e) { body = 'threw: ' + e.message; }
  ok(name + ' is refused', status >= 400 && /error/.test(body), status + ' ' + body.slice(0, 70));
}

/* And the CSRF guard, which is what stops a page on another origin using this
   as a proxy through the owner's browser. */
let crossStatus = 0, crossBody = '';
try {
  const r = await get(base + '/api/fetch?u=' + encodeURIComponent(PROBE),
                      { headers: { Origin: 'http://evil.example', Host: host }, ms: 20000 });
  crossStatus = r.status; crossBody = r.buf.toString('utf8').slice(0, 120);
} catch (e) { crossBody = 'threw: ' + e.message; }
ok('a request from another origin is refused', crossStatus === 403,
   crossStatus + ' ' + crossBody.slice(0, 70));

// ---- and the printer is still standing --------------------------------------
const after = await get(base + '/api/status', { ms: 8000 });
let st = null;
try { st = JSON.parse(after.buf.toString('utf8')); } catch (e) {}
ok('the printer survived all of that', !!(st && st.ok), st ? ('heap ' + st.freeHeap + ', ' + st.state) : 'no status');
ok('and did not crash', !!(st && !st.lastCrash), st ? String(st.lastCrash) : '?');

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(fail ? 1 : 0);
