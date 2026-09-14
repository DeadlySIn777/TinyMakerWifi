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
import net from 'node:net';

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
  /* NOT HERE. Network.ino:3012 strips a trailing dot on purpose - it is the
     same host in DNS - so this URL is ALLOWED, and asserting it is refused
     asserted the opposite of the guard's own intent. It only ever passed
     because the assertion below accepts any >= 400 with "error" in the body,
     and a real fetch of that URL returns 502 with an error in it: a network
     failure reading as a security pass. Both halves of that are fixed: the
     case moves to the allowed list, and the assertion checks the status the
     guard actually produces. */
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
  /* ⚠️ THE EXACT STATUS AND THE EXACT SENTENCE. `status >= 400 && /error/` is
     satisfied by a 502 from a DNS failure, a 504 from a timeout, and a 500
     from a crash - so a URL the guard happily forwarded could still "pass"
     this test as long as the far end was unreachable. That is a security
     check that tells you the network is down. The guard answers 403 with one
     specific sentence; require that. */
  ok(name + ' is refused by the allowlist',
     status === 403 && /only https URLs on meshy\.ai/.test(body),
     status + ' ' + body.slice(0, 70));
}

/* And the other direction, which nothing tested: a URL the guard is MEANT to
   pass has to reach the far end. An allowlist that refuses everything also
   passes every test above. */
{
  const u = 'https://www.meshy.ai./favicon.ico';       // trailing dot, same host
  let status = 0, len = 0;
  try {
    const r = await get(base + '/api/fetch?u=' + encodeURIComponent(u), { headers: OWN, ms: 60000 });
    status = r.status; len = r.buf.length;
  } catch (e) { /* reported by the assertion */ }
  ok('a trailing dot is ALLOWED, as Network.ino:3012 intends', status === 200 && len > 0,
     status + ', ' + len + ' bytes');
}

/* ---- DNS REBINDING ------------------------------------------------------
   requestFromOwnUi used to compare Origin against Host and stop there, and both
   of those headers come out of the SAME request - so the attacker supplies both
   and they agree. Register printer.evil.com with a one-second TTL, get the owner
   to open it, let the record rebind to the printer's LAN address, and every POST
   on this box is reachable from a page the owner merely visited: start a print,
   move the Z axis, delete a file, flash the firmware.

   The comparison is now against names the printer actually answers to. These
   four cases are the whole of that rule: our own address yes, our own mDNS name
   yes, somebody else's name no - however well Origin and Host agree about it. */
console.log('\nDNS rebinding');
{
  const u = encodeURIComponent(PROBE);

  /* ⚠️ WRITTEN BY HAND, because fetch() CANNOT SEND A Host HEADER - undici
     treats it as forbidden, exactly as a browser does, and drops it silently.
     A rebinding victim's browser sends Host: printer.evil.com because that is
     the name it resolved, so a test that cannot send one cannot reproduce the
     attack: with the real Host attached, Origin no longer matches it, and the
     request is refused by the OLD rule while appearing to confirm the new one.
     Raw bytes, and the guard gets the request it would really see. */
  const raw = (headers, path) => new Promise((resolve) => {
    const sock = net.connect(80, host);
    let buf = Buffer.alloc(0);
    const done = (r) => { try { sock.destroy(); } catch (e) {} resolve(r); };
    const t = setTimeout(() => done({ status: 0, body: 'timed out', len: 0 }), 60000);
    sock.on('connect', () => {
      const lines = ['GET ' + path + ' HTTP/1.1'];
      Object.keys(headers).forEach((k) => lines.push(k + ': ' + headers[k]));
      lines.push('Connection: close', '', '');
      sock.write(lines.join('\r\n'));
    });
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); });
    sock.on('error', (e) => { clearTimeout(t); done({ status: 0, body: 'error ' + e.message, len: 0 }); });
    sock.on('close', () => {
      clearTimeout(t);
      const head = buf.indexOf('\r\n\r\n');
      const status = parseInt((buf.toString('latin1', 0, 40).split(' ')[1] || '0'), 10) || 0;
      const body = head >= 0 ? buf.subarray(head + 4) : Buffer.alloc(0);
      done({ status, body: body.toString('utf8').slice(0, 90), len: body.length });
    });
  });

  const own = await raw({ Host: host, Origin: 'http://' + host }, '/api/fetch?u=' + u);
  ok('the printer\'s own address is accepted', own.status === 200 && own.len > 1000,
     own.status + ', ' + own.len + ' bytes');

  const mdns = await raw({ Host: 'tinymaker.local', Origin: 'http://tinymaker.local' },
                         '/api/fetch?u=' + u);
  ok('and so is tinymaker.local', mdns.status === 200 && mdns.len > 1000,
     mdns.status + ', ' + mdns.len + ' bytes');

  /* THE ATTACK ITSELF. Origin and Host agree perfectly - that is the whole
     point of rebinding - and the name is not ours. Before the fix: 200. */
  const rebound = await raw({ Host: 'printer.evil.com', Origin: 'http://printer.evil.com' },
                            '/api/fetch?u=' + u);
  ok('a rebound name is refused even though Origin matches Host',
     rebound.status === 403, rebound.status + ' ' + rebound.body.slice(0, 60));

  /* And the header-only door, which a rebound page can also walk through: it is
     same-origin as far as the browser is concerned, so it may set X-TinyMaker. */
  const reboundHdr = await raw({ Host: 'printer.evil.com', 'X-TinyMaker': '1' },
                               '/api/fetch?u=' + u);
  ok('and the custom header alone does not save it either',
     reboundHdr.status === 403, reboundHdr.status + ' ' + reboundHdr.body.slice(0, 60));

  /* A tool with no Host at all is not a browser and cannot be a rebinding
     victim - it still gets through on the header, which is how this very suite
     and the dashboard's own /api/fetch call reach the printer. */
  const tool = await raw({ 'X-TinyMaker': '1' }, '/api/fetch?u=' + u);
  ok('a Host-less tool still gets through on the header',
     tool.status === 200 && tool.len > 1000, tool.status + ', ' + tool.len + ' bytes');
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
