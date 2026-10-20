// Uçtan uca duman testi: derlemeyi sunar, gerçek bir tarayıcıda temel iş akışlarını dener.
// Kullanım: npm run build && npm test
import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';

const PORT = 4179;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
let failed = false;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    failed = true;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.sharp3d);
  const app = (fn, arg) => page.evaluate(fn, arg);
  const ws = () => app(() => {
    const w = sharp3d.workspace;
    return { bodies: w.result.bodies.map((b) => ({ id: b.id, faces: b.faceCount, edges: b.edgeCount, volume: b.volume, bounds: b.bounds })), statuses: w.result.statuses, features: w.design?.features.length };
  });
  // İşlem/değerlendirme bitene kadar bekle.
  const settle = async () => {
    await page.waitForFunction(() => document.querySelector('#busy').hidden);
    await page.waitForTimeout(150);
  };
  // Bir yüzün ya da kenarın ekrandaki yeri.
  const screenOf = (kind, body, index) => app(([kind, body, index]) => {
    const v = sharp3d.workspace.viewport;
    const b = v.bodies.get(body);
    let p;
    if (kind === 'face') p = v.faceInfo(body, index).center.clone();
    else {
      const r = b.data.edges.find((e) => e[2] === index);
      const mid = r[0] + Math.floor(r[1] / 2) - (Math.floor(r[1] / 2) % 2);
      const a = b.data.lines.slice(mid * 3, mid * 3 + 6);
      p = { x: (a[0] + a[3]) / 2, y: (a[1] + a[4]) / 2, z: (a[2] + a[5]) / 2 };
      p = new v.camera.position.constructor(p.x, p.y, p.z);
    }
    p.project(v.camera);
    const rect = v.dom.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }, [kind, body, index]);
  // Görünür ve kameraya bakan bir yüz bul (normal filtresiyle).
  const findFace = (body, normal) => app(([body, normal]) => {
    const v = sharp3d.workspace.viewport;
    const b = v.bodies.get(body);
    let best = null;
    for (const [, , idx] of b.data.faces) {
      const info = v.faceInfo(body, idx);
      const d = info.normal.x * normal[0] + info.normal.y * normal[1] + info.normal.z * normal[2];
      if (d > 0.99 && (!best || info.area > best.area)) best = { idx, area: info.area };
    }
    return best?.idx;
  }, [body, normal]);

  await step('çekirdek yüklenir ve proje ekranı açılır', async () => {
    await page.waitForFunction(() => document.querySelector('#kernel-loading').hidden, null, { timeout: 60000 });
    assert.ok(await page.isVisible('#new-design'));
  });

  await step('örnek tasarım açılır (6 adım, 1 gövde)', async () => {
    await page.click('#sample-design');
    await page.waitForFunction(() => sharp3d.workspace.result.bodies.length === 1, null, { timeout: 60000 });
    const s = await ws();
    assert.equal(s.features, 6);
    assert.ok(s.statuses.every((x) => x.ok));
    assert.ok(Math.abs(s.bodies[0].volume - 88114) < 50, `hacim ${s.bodies[0].volume}`);
  });

  await step('yeni tasarımda zemine dikdörtgen çizilip katılaştırılır', async () => {
    await page.click('#home-btn');
    await page.click('#new-design');
    await page.waitForFunction(() => sharp3d.workspace.design && !sharp3d.workspace.design.features.length);
    await page.keyboard.press('1');
    const box = await page.locator('#viewport canvas').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 80, cy - 20);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('#tool-panel:not([hidden])');
    // Ölçüleri panelden gir.
    const fields = page.locator('#op-fields input[type="number"]');
    await fields.nth(0).fill('30'); // mesafe
    await fields.nth(0).press('Tab');
    await fields.nth(1).fill('80'); // genişlik
    await fields.nth(1).press('Tab');
    await fields.nth(2).fill('50'); // uzunluk
    await fields.nth(2).press('Tab');
    await settle();
    await page.click('#op-apply');
    await settle();
    const s = await ws();
    assert.equal(s.bodies.length, 1);
    assert.ok(Math.abs(s.bodies[0].volume - 80 * 50 * 30) < 1, `hacim ${s.bodies[0].volume}`);
  });

  let body;
  await step('üst yüz seçilip Uzat ile 10 mm uzatılır', async () => {
    await page.keyboard.press('Escape');
    body = (await ws()).bodies[0].id;
    await page.keyboard.press('0');
    await page.keyboard.press('f');
    await page.waitForTimeout(500);
    const top = await findFace(body, [0, 0, 1]);
    const p = await screenOf('face', body, top);
    await page.mouse.click(p.x, p.y);
    assert.match(await page.textContent('#selection-info'), /1 yüz/);
    await page.click('#selection-actions button:has-text("Uzat")');
    const input = page.locator('#op-fields input[type="number"]').first();
    await input.fill('10');
    await input.press('Tab');
    await settle();
    await page.click('#op-apply');
    await settle();
    const s = await ws();
    assert.ok(Math.abs(s.bodies[0].bounds[1][2] - 40) < 1e-6, `üst ${s.bodies[0].bounds[1][2]}`);
  });

  await step('üst yüze daire çizilip 8 mm cep açılır', async () => {
    await page.keyboard.press('Escape');
    const before = (await ws()).bodies[0];
    const top = await findFace(body, [0, 0, 1]);
    const p = await screenOf('face', body, top);
    await page.keyboard.press('2');
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await page.mouse.move(p.x + 25, p.y, { steps: 4 });
    await page.mouse.click(p.x + 25, p.y);
    await page.waitForSelector('#tool-panel:not([hidden])');
    await page.selectOption('#op-fields select >> nth=1', 'cut');
    const fields = page.locator('#op-fields input[type="number"]');
    await fields.nth(0).fill('8');
    await fields.nth(0).press('Tab');
    await fields.nth(1).fill('20'); // çap
    await fields.nth(1).press('Tab');
    await settle();
    await page.click('#op-apply');
    await settle();
    const after = (await ws()).bodies[0];
    const expected = Math.PI * 10 * 10 * 8;
    assert.ok(Math.abs(before.volume - after.volume - expected) < 5, `fark ${before.volume - after.volume}, beklenen ${expected}`);
    // Bu adım sonraki testleri etkilemesin.
    await page.click('#undo');
    await settle();
  });

  await step('üst kenarlar seçilip 5 mm yuvarlatılır', async () => {
    const before = (await ws()).bodies[0];
    await page.keyboard.press('Escape');
    await page.click('#filter button[data-filter="edge"]');
    // Üst yüzün kenarlarından ikisini seç.
    const edges = await app((id) => {
      const b = sharp3d.workspace.viewport.bodies.get(id).data;
      const top = b.bounds[1][2];
      return b.edges.filter(([s, c]) => {
        const l = b.lines;
        return Math.abs(l[s * 3 + 2] - top) < 1e-3 && Math.abs(l[(s + c - 1) * 3 + 2] - top) < 1e-3;
      }).map((e) => e[2]);
    }, body);
    assert.ok(edges.length >= 2, `üst kenar sayısı ${edges.length}`);
    for (const [i, e] of edges.slice(0, 2).entries()) {
      const p = await screenOf('edge', body, e);
      if (i) await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      if (i) await page.keyboard.up('Shift');
    }
    assert.match(await page.textContent('#selection-info'), /2 kenar/);
    await page.keyboard.press('y');
    const input = page.locator('#op-fields input[type="number"]').first();
    await input.fill('5');
    await input.press('Tab');
    await settle();
    await page.click('#op-apply');
    await settle();
    await page.click('#filter button[data-filter="auto"]');
    const after = (await ws()).bodies[0];
    assert.ok(after.faces > before.faces, `yüz sayısı ${before.faces} -> ${after.faces}`);
    assert.ok(after.volume < before.volume);
  });

  await step('alt yüz açılarak kabuk (2 mm) yapılır', async () => {
    const before = (await ws()).bodies[0];
    await page.keyboard.press('Escape');
    const bottom = await findFace(body, [0, 0, -1]);
    await page.evaluate(([body, index]) => sharp3d.workspace.setSelection([{ kind: 'face', body, index }]), [body, bottom]);
    await page.click('#selection-actions button:has-text("Kabuk")');
    await settle();
    assert.equal(await page.textContent('#op-message'), '');
    await page.click('#op-apply');
    await settle();
    const after = (await ws()).bodies[0];
    assert.ok(after.volume < before.volume * 0.5, `hacim ${before.volume} -> ${after.volume}`);
    assert.ok(Math.abs(after.bounds[1][2] - before.bounds[1][2]) < 1e-6, 'kabuk içe doğru olmalı');
    assert.ok((await ws()).statuses.every((s) => s.ok));
  });

  await step('silindir eklenip gövdeden çıkarılır (boolean)', async () => {
    await page.keyboard.press('Escape');
    await page.click('[data-tool="op:cylinder"]');
    const inputs = page.locator('#op-fields input[type="number"]');
    for (const [i, v] of [[0, '20'], [1, '80'], [2, '0'], [3, '0'], [4, '-10']].entries()) {
      await inputs.nth(v[0]).fill(v[1]);
      await inputs.nth(v[0]).press('Tab');
      void i;
    }
    await settle();
    await page.click('#op-apply');
    await settle();
    const s = await ws();
    assert.equal(s.bodies.length, 2);
    const cyl = s.bodies.find((b) => b.id !== body).id;
    await page.evaluate(([a, b]) => sharp3d.workspace.setSelection([{ kind: 'body', body: a }, { kind: 'body', body: b }]), [body, cyl]);
    const before = s.bodies.find((b) => b.id === body).volume;
    await page.click('#selection-actions button:has-text("Çıkar")');
    await settle();
    await page.click('#op-apply');
    await settle();
    const after = await ws();
    assert.equal(after.bodies.length, 1);
    assert.ok(after.bodies[0].volume < before);
  });

  await step('gövde taşınır, aynalanır ve dizilir', async () => {
    await page.evaluate((b) => sharp3d.workspace.setSelection([{ kind: 'body', body: b }]), body);
    const x0 = (await ws()).bodies[0].bounds[0][0];
    await page.keyboard.press('t');
    const dx = page.locator('#op-fields input[type="number"]').first();
    await dx.fill('100');
    await dx.press('Tab');
    await page.click('#op-apply');
    await settle();
    let s = await ws();
    assert.ok(Math.abs(s.bodies[0].bounds[0][0] - x0 - 100) < 1e-6, `x ${x0} -> ${s.bodies[0].bounds[0][0]}`);

    await page.evaluate((b) => sharp3d.workspace.setSelection([{ kind: 'body', body: b }]), body);
    await page.click('#selection-actions button:has-text("Aynala")');
    await settle();
    await page.click('#op-apply');
    await settle();
    s = await ws();
    assert.equal(s.bodies.length, 2);

    await page.evaluate((b) => sharp3d.workspace.setSelection([{ kind: 'body', body: b }]), body);
    await page.click('#selection-actions button:has-text("Dizi")');
    await settle();
    await page.click('#op-apply');
    await settle();
    s = await ws();
    assert.equal(s.bodies.length, 4);
    assert.ok(s.statuses.every((x) => x.ok));
  });

  await step('geçmişten adım düzenlenir, geri al / yinele çalışır', async () => {
    // Uzat adımını (2. adım) 20 mm yap.
    await page.locator('#history-list .step-main').nth(1).click();
    const input = page.locator('#op-fields input[type="number"]').first();
    assert.equal(await input.inputValue(), '10');
    await input.fill('20');
    await input.press('Tab');
    await settle();
    await page.click('#op-apply');
    await settle();
    let s = await ws();
    assert.ok(s.statuses.every((x) => x.ok), JSON.stringify(s.statuses));
    assert.ok(Math.abs(s.bodies[0].bounds[1][2] - 50) < 1e-6, `üst ${s.bodies[0].bounds[1][2]}`);
    await page.click('#undo');
    await settle();
    s = await ws();
    assert.ok(Math.abs(s.bodies[0].bounds[1][2] - 40) < 1e-6);
    await page.click('#redo');
    await settle();
  });

  await step('ölçüm etiketi gösterir', async () => {
    await page.keyboard.press('m');
    const box = await page.locator('#viewport canvas').boundingBox();
    await page.mouse.click(box.x + 300, box.y + box.height - 80);
    await page.mouse.click(box.x + 600, box.y + box.height - 80);
    assert.match(await page.locator('.measure-label').first().textContent(), /mm$/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.measure-label:visible').count(), 0);
  });

  await step('STEP, STL, OBJ, GLB, PNG ve tasarım dosyası dışa aktarılır', async () => {
    for (const format of ['step', 'stl', 'obj', 'glb', 'png', 'project']) {
      await page.click('#export-btn');
      const [download] = await Promise.all([page.waitForEvent('download'), page.click(`#export-menu [data-format="${format}"]`)]);
      const name = download.suggestedFilename();
      assert.ok(name.endsWith(format === 'project' ? '.sharp3d.json' : `.${format}`), name);
      if (format === 'step') {
        const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
        assert.match(text, /^ISO-10303-21;/);
      }
    }
  });

  await step('teknik çizim ve görselleştirme sekmeleri çalışır', async () => {
    await page.click('#spaces [data-space="drawing"]');
    await page.waitForSelector('#drawing-svg svg', { timeout: 30000 });
    assert.ok(await page.locator('#drawing-svg path').count() > 10);
    await page.click('#spaces [data-space="visual"]');
    await page.click('.material:has-text("Alüminyum")');
    await page.click('#spaces [data-space="model"]');
  });

  await step('tasarım kaydedilir ve yeniden yüklemede geri gelir', async () => {
    const before = await ws();
    await page.waitForFunction(() => document.querySelector('#save-state').dataset.state === 'saved');
    await page.reload();
    await page.waitForFunction(() => sharp3d.workspace.result.bodies.length > 0, null, { timeout: 60000 });
    const after = await ws();
    assert.equal(after.features, before.features);
    assert.equal(after.bodies.length, before.bodies.length);
    await page.click('#home-btn');
    await page.waitForSelector('.design-card');
    assert.equal(await page.locator('.design-card').count(), 2);
    assert.ok(await page.locator('.design-card img').count() >= 1, 'küçük resim');
  });

  await step('STEP dosyası içe aktarılır', async () => {
    await page.locator('.design-card').first().click();
    await page.waitForFunction(() => sharp3d.workspace.design && sharp3d.workspace.result.bodies.length > 0, null, { timeout: 60000 });
    const ids = await app(() => sharp3d.workspace.result.bodies.map((b) => b.id));
    const { blob } = await app(async (ids) => {
      const r = await sharp3d.kernel.export(sharp3d.workspace.design.features, ids.slice(0, 1), 'step');
      return { blob: await r.blob.text() };
    }, ids);
    const count = ids.length;
    await page.setInputFiles('#import-file', { name: 'parca.step', mimeType: 'application/step', buffer: Buffer.from(blob) });
    await page.waitForFunction((n) => sharp3d.workspace.result.bodies.length === n + 1, count, { timeout: 60000 });
    assert.ok((await ws()).statuses.every((s) => s.ok));
  });

  await step('dar ekranda (telefon) arayüz açılır', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const size = await page.locator('#viewport canvas').boundingBox();
    assert.ok(size.width > 300 && size.height > 400, JSON.stringify(size));
    await page.click('#tools-toggle');
    assert.ok(await page.isVisible('[data-tool="op:box"]'));
  });

  await step('konsolda hata yok', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.httpServer.close();
}

if (failed) {
  console.log('\nDuman testi BAŞARISIZ');
  process.exit(1);
}
console.log('\nDuman testi başarılı');
