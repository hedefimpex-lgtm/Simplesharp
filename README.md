# Sharp3D

Tarayıcıda çalışan, gerçek bir CAD çekirdeğine (OpenCascade) dayalı 3B modelleme aracı. İş akışı ve arayüz düzeni Shapr3D'nin modelleme yaklaşımını örnek alır: çiz, katılaştır, yüzü it/çek, kenarı yuvarla. Kurulum gerektirmez; masaüstü, tablet ve telefonda güncel bir tarayıcıda açılır.

> Shapr3D kapalı kaynaklı bir uygulamadır; Sharp3D onun kodunu, simgelerini ya da varlıklarını içermez. Bağımsız olarak yazılmış açık kaynak bir web uygulamasıdır.

## Arayüz

```
┌ Üst çubuk: Projeler · tasarım adı · kayıt durumu │ Modelleme | Görselleştirme | Teknik çizim │ Geri/İleri · Dışa aktar · Ayarlar ┐
├──────────────┬───────────────────────────────────────────────────────┬────────────────┤
│ Öğeler       │ 3B görünüm                          görünüm küpü ▣    │ Araç menüsü    │
│ (gövdeler,   │                 ┌ Araç paneli (parametreler,        │  Çizim         │
│  renk, göster│                 │  canlı önizleme, Uygula/İptal)    │  Katılar       │
│  /gizle, ad) │  ↑ sürüklenebilir uzatma oku                        │  Modelleme     │
│              │ [Otomatik|Gövde|Yüz|Kenar]   [seçim · öneri işlemleri]│  Birleştirme   │
│              │                                                       │  Dönüştür      │
│              │                                                       │  Araçlar       │
├──────────────┴───────────────────────────────────────────────────────┴────────────────┤
│ Geçmiş: 1 Kutu · 2 Uzat · 3 Yuvarla · …  (tıkla → düzenle, × → sil; hatalı adım kırmızı)    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Proje ekranı:** küçük resimli tasarım galerisi; yeni tasarım, örnek tasarım, STEP/STL/tasarım dosyasından açma, yeniden adlandırma, çoğaltma, indirme, silme.
- **Seçime duyarlı öneriler:** yüz seçince *Uzat / Kabuk*, kenar seçince *Yuvarla / Pah*, gövde seçince *Taşı / Ölçekle / Aynala / Dizi / Çoğalt / Sil*, iki gövde seçince *Birleştir / Çıkar / Kesiştir*.
- **Parametrik geçmiş:** her işlem geçmişe adım olarak eklenir; eski bir adımın değeri değiştirildiğinde sonraki adımlar yeniden hesaplanır.
- Dar ekranlarda öğeler ve araç menüsü yandan açılan çekmecelere dönüşür.

## Özellikler

| Grup | İşlemler |
| --- | --- |
| Çizim | Dikdörtgen (köşe yarıçaplı), daire, çokgen — zemine ya da herhangi bir yüze. Çizerken ölçü yazılabilir (`40x20`, çap `30`, kenar `25`). |
| Katılaştırma | Katılaştır (yeni gövde / gövdeye ekle / gövdeden çıkar / kesişim), eksen etrafında döndür (revolve) |
| Katılar | Kutu, silindir, küre, koni, simit |
| Modelleme | Uzat (yüzü it/çek, oklu tutamaçla), yuvarla (fillet), pah (chamfer), kabuk (shell) |
| Birleştirme | Birleştir, çıkar, kesiştir |
| Dönüştür | Taşı / döndür (3B tutamaç ya da sayı), ölçekle, aynala, doğrusal dizi, çoğalt |
| Ölçüm | İki nokta arası mesafe; seçili yüz alanı, gövde hacmi |
| Görselleştirme | Malzeme kütüphanesi (plastik, metal, cam, ahşap…), ışık, arka plan, gölge, PNG |
| Teknik çizim | A4 paftada ön / üst / sağ görünüş, gizli kenarlar, başlık bloğu, standart ölçek; SVG ve yazdır/PDF |
| Dosya | Dışa: **STEP**, STL (mm), OBJ, GLB, PNG, tasarım dosyası. İçe: **STEP**, STL |

Birimler: mm, cm, m, inç (model her zaman mm'dir). Tasarımlar tarayıcıda (IndexedDB) otomatik kaydedilir.

## Mimari

```
src/
  main.js            giriş, yönlendirme (#/ proje ekranı, #/d/<id> tasarım)
  home.js            proje ekranı
  workspace.js       çalışma alanı: menüler, paneller, seçim, işlem akışı
  ops.js             işlem tanımları (alanlar, seçim gereksinimi, özellik üretimi)
  design.js          tasarım belgesi, gövde bilgileri, geri al/yinele
  viewport.js        three.js görünümü, yüz/kenar seçimi, görünüm küpü, tutamaç
  sketch.js          çizim aracı
  measure.js         ölçüm aracı
  store.js           IndexedDB
  kernel/worker.js   Web Worker içinde OpenCascade (replicad), artımlı değerlendirme
  kernel/features.js özellik geçmişi → katı model
  kernel/client.js   Worker ile iletişim
```

Belge, sırayla uygulanan **özelliklerden** oluşur (`primitive`, `extrude`, `revolve`, `pushpull`, `fillet`, `chamfer`, `shell`, `boolean`, `transform`, `mirror`, `pattern`, `import`…). Çekirdek, değişmeyen ilk adımların sonucunu önbellekte tutar; yalnızca değişen adımdan sonrası yeniden hesaplanır.

## Kurulum

```bash
npm install
npm run dev      # geliştirme sunucusu (http://localhost:5173)
npm run build    # dist/ klasörüne üretim derlemesi
npm run preview  # derlemeyi önizle
npm test         # derleme üzerinde uçtan uca tarayıcı testleri (önce: npx playwright install chromium)
```

`dist/` statik dosyalardan oluşur ve göreli yollar kullanır; herhangi bir statik sunucuya ya da alt dizine kopyalanabilir. Geometri çekirdeği (~23 MB WebAssembly, sıkıştırılmış ~7 MB) ilk açılışta indirilir ve tarayıcı önbelleğinde kalır.

### GitHub Pages ile yayınlama

`.github/workflows/deploy.yml` her `main` gönderiminde derler, test eder ve GitHub Pages'e yayınlar. Bir kez depo ayarlarından **Settings → Pages → Source: GitHub Actions** seçilmelidir.

## Kısayollar

| Tuş | İşlem |
| --- | --- |
| 1 / 2 / 3 | Dikdörtgen / Daire / Çokgen çiz |
| U · Y · T | Uzat · Yuvarla · Taşı |
| M | Ölç |
| Enter / Esc | Uygula / İptal (Esc ayrıca seçimi kaldırır) |
| Çift tık | Gövdenin tamamını seç |
| Shift + tık | Seçime ekle / çıkar |
| F | Sığdır |
| 0 / 7 / 8 / 9 | İzometrik / Üst / Ön / Sağ görünüm |
| Delete | Seçili gövdeleri sil |
| Ctrl+Z / Ctrl+Y | Geri al / Yinele |
| Ctrl+D · Ctrl+A | Çoğalt · Tümünü seç |

Fare: sol tık sürükle döndürür, sağ tık sürükle kaydırır, tekerlek yakınlaştırır. Dokunmatikte tek parmak döndürür, iki parmak kaydırır/yakınlaştırır.

## Lisanslar

- [three.js](https://github.com/mrdoob/three.js) — MIT
- [replicad](https://github.com/sgenoud/replicad) — MIT
- [replicad-opencascadejs](https://github.com/sgenoud/replicad) / [OpenCascade](https://dev.opencascade.org) — LGPL-2.1 (OCCT istisnasıyla). Çekirdek, değiştirilmeden ayrı bir `.wasm` dosyası olarak yüklenir ve başka bir derlemeyle değiştirilebilir.
- [Lucide](https://lucide.dev) simgeleri — ISC
