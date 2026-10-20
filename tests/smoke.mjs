// Uçtan uca duman testi: derlemeyi sunar, gerçek bir tarayıcıda temel iş akışlarını dener.
// Kullanım: npm run build && npm test
import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4179/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
let failed = false;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed = true;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.sharp3d);
  const app = (fn, arg) => page.evaluate(fn, arg);

  await step('varsayılan sahne yüklenir', async () => {
    assert.equal(await app(() => sharp3d.world.children.length), 2);
  });

  await step('dikdörtgen çizimi gövde oluşturur', async () => {
    await page.click('[data-tool="rect"]');
    const box = await page.locator('#viewport canvas').boundingBox();
    // Zeminde boş bir alana sürükleyerek çiz.
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.85;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y + 40, { steps: 5 });
    await page.mouse.up();
    const result = await app(() => {
      const o = sharp3d.selection[0];
      return o && { sketch: !!o.userData.sketch, count: sharp3d.world.children.length };
    });
    assert.deepEqual(result, { sketch: true, count: 3 });
  });

  await step('yükseklik değişir ve geri alınır', async () => {
    const heights = await app(() => {
      const o = sharp3d.selection[0];
      const h = () => { o.geometry.computeBoundingBox(); return +o.geometry.boundingBox.max.z.toFixed(3); };
      const before = h();
      sharp3d.setExtrudeDepth(o, 1.2);
      const after = h();
      sharp3d.history.undo();
      return [before, after, h()];
    });
    assert.deepEqual(heights, [0.5, 1.2, 0.5]);
  });

  await step('daire ve çokgen çizilir (tıkla-tıkla)', async () => {
    const box = await page.locator('#viewport canvas').boundingBox();
    const cx = box.x + box.width * 0.7;
    const cy = box.y + box.height * 0.8;
    await page.keyboard.press('2');
    await page.mouse.click(cx, cy);
    await page.mouse.move(cx + 40, cy, { steps: 3 });
    await page.mouse.click(cx + 40, cy);
    await page.keyboard.press('3');
    for (const [dx, dy] of [[-200, -20], [-120, -20], [-160, 40]]) {
      await page.mouse.move(cx + dx, cy + dy);
      await page.mouse.click(cx + dx, cy + dy);
    }
    await page.keyboard.press('Enter');
    assert.equal(await app(() => sharp3d.world.children.length), 5);
  });

  await step('boolean çıkarma hacmi azaltır', async () => {
    const r = await app(() => {
      const { world, createPrimitive, addObjects, setSelection, runBoolean } = sharp3d;
      const a = createPrimitive('box');
      a.position.set(0, 0.5, 3);
      const b = createPrimitive('cylinder');
      b.scale.set(0.5, 2, 0.5);
      b.position.set(0, 0.5, 3);
      addObjects([a, b]);
      setSelection([a, b]);
      const before = world.children.length;
      runBoolean('subtract');
      const result = sharp3d.selection[0];
      const text = [...document.querySelectorAll('#props label')].find((l) => l.textContent.startsWith('Hacim'))?.textContent;
      return { before, after: world.children.length, name: result?.name, text };
    });
    assert.equal(r.after, r.before - 1);
    assert.match(r.name, /^Fark/);
    // 100 mm küp (1.000.000 mm³) eksi Ø50 mm delik (~196.350 mm³) ≈ 803.650 mm³
    const volume = Number(r.text.replace(/[^\d,]/g, '').replace(',', '.'));
    assert.ok(volume > 795000 && volume < 812000, r.text);
  });

  await step('birleştirme ve kesiştirme çalışır', async () => {
    const counts = await app(() => {
      const { createPrimitive, addObjects, setSelection, runBoolean } = sharp3d;
      const out = [];
      for (const op of ['union', 'intersect']) {
        const a = createPrimitive('box');
        const b = createPrimitive('sphere');
        a.position.set(4, 0.5, 0);
        b.position.set(4.4, 0.7, 0);
        addObjects([a, b]);
        setSelection([a, b]);
        runBoolean(op);
        out.push(sharp3d.selection[0].geometry.attributes.position.count > 0);
      }
      return out;
    });
    assert.deepEqual(counts, [true, true]);
  });

  await step('birim değişimi panelde görünür', async () => {
    await page.selectOption('#unit', 'cm');
    assert.match(await page.textContent('#props'), /cm/);
    await page.selectOption('#unit', 'mm');
  });

  await step('ölçüm aracı etiket gösterir', async () => {
    await page.keyboard.press('m');
    const box = await page.locator('#viewport canvas').boundingBox();
    await page.mouse.click(box.x + 200, box.y + box.height - 60);
    await page.mouse.click(box.x + 400, box.y + box.height - 60);
    const text = await page.locator('.measure-label').first().textContent();
    assert.match(text, /mm$/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.measure-label:visible').count(), 0);
  });

  await step('STL, OBJ, GLB ve proje dışa aktarımı', async () => {
    for (const format of ['stl', 'obj', 'glb']) {
      await page.selectOption('#export-format', format);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
      assert.ok(download.suggestedFilename().endsWith(`.${format}`));
    }
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
    assert.ok(download.suggestedFilename().endsWith('.json'));
  });

  await step('sahne yeniden yüklemede geri gelir', async () => {
    const before = await app(() => sharp3d.world.children.map((o) => o.name));
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForFunction(() => window.sharp3d);
    const after = await app(() => sharp3d.world.children.map((o) => [o.name, !!o.userData.sketch]));
    assert.deepEqual(after.map((a) => a[0]), before);
    assert.ok(after.some((a) => a[1]), 'çizim parametreleri korunmalı');
  });

  await step('proje dosyası açılır', async () => {
    const data = await app(() => sharp3d.serialize());
    await page.setInputFiles('#project-file', {
      name: 'test.sharp3d.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
    });
    await page.waitForTimeout(300);
    assert.equal(await app(() => sharp3d.world.children.length), data.objects.length);
  });

  await step('dar ekranda (telefon) arayüz açılır', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const size = await page.locator('#viewport canvas').boundingBox();
    assert.ok(size.width > 300 && size.height > 300);
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
