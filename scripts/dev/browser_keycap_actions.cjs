/* Real assembled UI and the public version-pinned slicer module, served from
   a local cache. Fresh browser, no printer connection, writes, slicing or Meshy. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '../..');
const stl = require('../../web/parts/stl-read.js');
const origin = 'http://127.0.0.1:8794';
const cache = path.join(root, '.cache/browser-actions/modules');
const output = path.join(root, '.cache/browser-actions');
const modules = ['slicer-wasm-3.5.0.js', 'slicer-core-3.5.0.js'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const decodeSTL = bytes => stl.readSTL(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).positions;

(async () => {
  for (const name of modules) assert.ok(fs.existsSync(path.join(cache, name)), 'Missing exact pinned module cache: ' + name);
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    // Exercise the ordinary desktop PNG fallback. Headless Chrome advertises
    // an OS share sheet which has no window to complete in this test process.
    await context.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
    const page = await context.newPage(), errors = [], writes = [], loaded = [], blocked = [], checks = [], downloads = [];
    let moduleFailure = false;
    page.on('pageerror', e => errors.push(e.message));
    page.on('download', d => downloads.push(d.suggestedFilename()));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') { writes.push(url.href); return route.abort(); }
      if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
      if (url.pathname === '/api/status') return route.fulfill({ json: {
        ok: true, firmwareVersion: '0.18.8', firmwareBuild: 'local-action-test', state: 'Idle',
        busy: false, receiving: false, resumePending: false, webControl: true, slicerOn: true,
        sdReady: false, freeHeap: 170000, layerHeight: 0.05,
      } });
      if (url.pathname === '/api/lib/slicer') return route.fulfill({ json: { ok: true, complete: true, version: '3.5.0' } });
      const name = path.basename(url.pathname);
      if (url.pathname.startsWith('/lib/') && modules.includes(name)) {
        if (moduleFailure) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Test: slicer unavailable' });
        loaded.push(name);
        return route.fulfill({ path: path.join(cache, name), contentType: 'text/javascript' });
      }
      return route.continue();
    });
    const reveal = async selector => {
      const ancestors = await page.locator(selector).evaluate(el => {
        const all = [...document.querySelectorAll('#kcCard details')], list = [];
        for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) list.unshift(all.indexOf(p));
        return list;
      });
      for (const index of ancestors) await page.locator('#kcCard details').nth(index).locator(':scope > summary').click();
      assert.equal(await page.locator(selector).isVisible(), true, selector + ' must be reachable through its disclosure');
    };
    const download = async (selector, file) => {
      await reveal(selector);
      const event = page.waitForEvent('download', { timeout: 15000 });
      await page.locator(selector).click();
      const result = await event.catch(async e => {
        console.error('Download failed', selector, await page.evaluate(() => ({
          state: document.querySelector('#kcState')?.textContent, help: document.querySelector('#designerHelpBody')?.textContent,
          canShare: typeof navigator.canShare, share: typeof navigator.share,
          action: document.querySelector('#kcActionStatus')?.textContent,
        })), errors);
        throw e;
      });
      await result.saveAs(path.join(output, file));
      return fs.readFileSync(path.join(output, file));
    };
    const ready = () => page.waitForFunction(() => document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'), null, { timeout: 30000 });
    await page.goto(origin + '/#create');
    await page.locator('#kcBoard button').filter({ hasText: /^Esc$/ }).click();
    await page.locator('#kcSteps [data-step="3"]').click();
    await page.locator('#kcLegendOn').uncheck();
    await page.locator('#kcFile').setInputFiles(path.join(root, 'research/artisan-capabilities/flower-synthetic-input.stl'));
    await ready();
    await page.locator('#kcProductName').fill('Action QA flower');
    await page.locator('#kcSaveProduct').click();
    await page.waitForFunction(() => document.querySelector('#designerNoticeText').textContent.includes('Action QA flower'));
    const saved = await page.evaluate(async () => {
      const entries = await keycapLibrary.list(), record = await keycapLibrary.get(entries.find(r => r.name === 'Action QA flower').id);
      return { name: record.name, kind: record.kind, product: !!record.product };
    });
    assert.equal(saved.name, 'Action QA flower');
    checks.push('Imported actual fixture assembles, saves and names a Library product.');

    const imageByView = {};
    await reveal('#kcInspect');
    for (const name of ['perspective', 'front', 'side', 'back', 'bottom']) {
      const button = page.locator('#kcInspect [data-view="' + name + '"]');
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      imageByView[name] = await page.locator('#kcTop').evaluate(c => c.toDataURL());
    }
    assert.notEqual(imageByView.perspective, imageByView.front);
    assert.notEqual(imageByView.perspective, imageByView.bottom);
    await page.locator('#kcPose [data-pose="printed"]').click();
    const printed = await page.locator('#kcTop').evaluate(c => c.toDataURL());
    assert.notEqual(printed, imageByView.bottom);
    await page.locator('#kcPose [data-pose="made"]').click();
    await page.locator('#kcInspect [data-view="perspective"]').click();
    checks.push('All five inspection buttons work; Made and Printed change the actual rendered mesh.');

    await page.locator('#kcSteps [data-step="4"]').click();
    const productSTL = await download('#kcDownloadProduct', 'product.stl');
    assert.equal(productSTL.length, 84 + productSTL.readUInt32LE(80) * 50);
    assert.ok(productSTL.readUInt32LE(80) > 1000);
    if (await page.locator('#kcColorMode').count()) {
      await page.locator('#kcColorMode [data-color-mode="color"]').click();
      assert.equal(await page.locator('#kcColorOptions').isVisible(), true);
      await page.locator('#kcColorOptions summary').click();
      await page.locator('#kcBaseColor').fill('#ff4466'); await page.locator('#kcBaseColor').dispatchEvent('input');
      await page.locator('#kcArtColor').fill('#44ddcc'); await page.locator('#kcArtColor').dispatchEvent('input');
      await page.locator('#kcSaveProduct').click();
      await ready();
      const coloredSTL = await download('#kcDownloadProduct', 'colored-product.stl');
      assert.deepEqual(decodeSTL(coloredSTL), decodeSTL(productSTL), 'reference paint cannot change export geometry');
      checks.push('Color selection works and product STL geometry stays identical.');
    }
    await page.locator('#kcSteps [data-step="4"]').click();
    const paint = await download('#kcPaint', 'paint-guide.png');
    assert.equal(paint.subarray(1, 4).toString(), 'PNG');
    assert.ok(paint.readUInt32BE(16) >= 1000);
    const share = await download('#kcShare', 'share-card.png');
    assert.equal(share.subarray(1, 4).toString(), 'PNG');
    checks.push('Unlettered artisan Paint guide and Share both create valid PNG downloads.');

    // Drive only the OS share boundary. Product rendering, PNG creation,
    // promise handling, fallback download and user feedback remain real.
    await page.evaluate(() => {
      window.__nativeShareCalls = 0;
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: () => new Promise((resolve, reject) => {
        window.__nativeShareCalls++; window.__nativeShareResolve = resolve; window.__nativeShareReject = reject;
      }) });
    });
    const prior = await page.locator('#kcState').textContent(), beforeNative = downloads.length;
    await page.locator('#kcShare').click();
    await page.waitForFunction(() => window.__nativeShareCalls === 1);
    assert.equal(await page.locator('#kcState').textContent(), prior, 'pending native share cannot report completion');
    await page.evaluate(() => window.__nativeShareReject(new DOMException('Canceled', 'AbortError')));
    await page.waitForFunction(() => document.querySelector('#kcState').textContent === 'Sharing canceled.');
    assert.equal(downloads.length, beforeNative);
    await page.locator('#kcShare').click();
    await page.waitForFunction(() => window.__nativeShareCalls === 2);
    const fallbackEvent = page.waitForEvent('download');
    await page.evaluate(() => window.__nativeShareReject(new Error('OS sharing unavailable')));
    const fallback = await fallbackEvent;
    await fallback.saveAs(path.join(output, 'share-native-fallback.png'));
    await page.waitForFunction(() => document.querySelector('#kcState').textContent.includes('Sharing unavailable'));
    const afterFallback = downloads.length;
    await page.locator('#kcShare').click();
    await page.waitForFunction(() => window.__nativeShareCalls === 3);
    assert.doesNotMatch(await page.locator('#kcState').textContent(), /^Shared picture/);
    await page.evaluate(() => window.__nativeShareResolve());
    await page.waitForFunction(() => document.querySelector('#kcState').textContent.startsWith('Shared picture'));
    assert.equal(downloads.length, afterFallback);
    checks.push('Native Share reports success only after completion; Cancel is quiet and real failures fall back to a PNG.');

    await page.locator('#kcAdd').click();
    assert.match(await page.locator('#kcPlate').innerText(), /1.*plate/i);
    const plateSTL = await download('#kcStl', 'plate.stl'), expected = Array.from(decodeSTL(plateSTL));
    await page.locator('#kcClearPlate').click();
    assert.match(await page.locator('#kcPlate').innerText(), /cleared/i);
    checks.push('Add to plate, full-resolution STL export and Clear plate work.');

    // Observe, then call the genuine handoff function; the module and renderer
    // remain real. This records keepPose/noScale instead of replacing behavior.
    await page.evaluate(() => {
      const original = window.slicerLoadMesh; window.__actionHandoffs = [];
      window.slicerLoadMesh = function (positions, name, bytes, options) {
        const result = original.apply(this, arguments);
        window.__actionHandoffs.push({ options: { ...options }, triangles: positions.length / 9, name, bytes, result });
        return result;
      };
    });
    assert.equal(await page.locator('#kcSlice').isVisible(), false, 'legacy Send stays hidden');
    const visibleSends = await page.locator('#kcCard button').evaluateAll(buttons => buttons.filter(b => b.getClientRects().length && b.textContent.trim() === 'Send to slicer').map(b => b.id));
    assert.deepEqual(visibleSends, ['kcNext'], 'final review has one visible Send');
    for (const [index, selector] of ['#kcNext'].entries()) {
      await page.locator(selector).click();
      await page.waitForFunction(n => window.__actionHandoffs.length > n, index, { timeout: 30000 });
      await page.waitForFunction(() => window.slicerIsOpen && window.slicerIsOpen());
      const actual = await page.evaluate(() => ({
        source: window.__modUrl, version: window.slicerLoadedVer,
        handoff: window.__actionHandoffs.at(-1), geometry: Array.from(window.slicerLastGeometry() || []),
        scale: slicerTr.scale, rx: slicerTr.rx, rz: slicerTr.rz, noScale: slicerNoScale,
        visible: !!document.querySelector('#slicerCard').getClientRects().length,
      }));
      assert.equal(actual.version, '3.5.0-wasm'); assert.equal(actual.handoff.result, true);
      assert.deepEqual(actual.handoff.options, { keepPose: true, noScale: true });
      assert.equal(actual.scale, 1); assert.equal(actual.rx, 0); assert.equal(actual.rz, 0); assert.equal(actual.noScale, true);
      assert.equal(actual.visible, true); assert.deepEqual(actual.geometry, expected);
      checks.push(selector + ' opens the real 3.5.0 slicer with exact STL geometry, unchanged pose and scale.');
    }
    await page.screenshot({ path: path.join(output, 'slicer-handoff.png'), fullPage: true });
    // A fresh document cannot reuse the successfully loaded ES module. With
    // both SD/local and network unavailable the actual buttons must explain
    // the problem, instead of silently doing nothing or changing geometry.
    moduleFailure = true;
    await page.reload();
    await page.locator('.stStageBar .stSeg button[data-st="cap"]').click();
    await ready();
    await page.locator('#kcSteps [data-step="4"]').click();
    await page.locator('#kcNext').click();
    await page.waitForFunction(() => document.querySelector('#designerHelpDialog').open && document.querySelector('#designerHelpBody').textContent.includes('Could not load the slicer engine'));
    assert.match(await page.locator('#kcActionNote').innerText(), /internet connection.*SD card/);
    await page.screenshot({ path: path.join(output, 'slicer-unavailable-help.png') });
    checks.push('Unavailable engine produces a visible explanatory pop-up and persistent action error.');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    assert.ok(modules.every(name => loaded.includes(name)));
    const result = { passed: true, checks, errors, writes, blockedRemote: [...new Set(blocked)],
      source: 'Synthetic flower fixture; public TinyMaker slicer 3.5.0 adapter/core cached byte-for-byte.',
      modules: modules.map(name => ({ name, sha256: digest(fs.readFileSync(path.join(cache, name))) })),
      moduleLoad: 'Real ES modules', slicingExecuted: false, printStarted: false, generationStarted: false, printerContacted: false };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
