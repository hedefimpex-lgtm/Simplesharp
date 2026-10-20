# Sharp3D

Tarayıcıda çalışan, **çiz → katılaştır** iş akışına dayalı hafif bir 3D modelleme aracı. Shapr3D'nin temel modelleme yaklaşımından esinlenmiştir; kurulum gerektirmez, Windows/macOS/Linux/iPad/Android'de güncel bir tarayıcıda açılır. [three.js](https://threejs.org), [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) ve [Vite](https://vitejs.dev) ile yazıldı.

> Shapr3D kapalı kaynaklı, yerel (Windows MSIX / macOS / iPadOS) bir uygulamadır ve Parasolid çekirdeğini kullanır; doğrudan web'e taşınamaz. Sharp3D, o iş akışının tarayıcıda çalışan bağımsız bir uygulamasıdır ve Shapr3D koduyla ilgisi yoktur.

## Özellikler

- **Çizim:** dikdörtgen, daire ve çokgen; zemine ya da herhangi bir katının yüzeyine çizilir. Çizim bitince 50 mm yüksekliğinde gövdeye dönüşür; yükseklik Özellikler panelinden değiştirilebilir (negatif değer ters yöne katılaştırır).
- **Boolean:** birleştir, çıkar, kesiştir (Shift + tık ile çoklu seçim; ilk seçilen ana gövdedir).
- **Ölçüm:** iki noktaya tıklayarak mesafe; panelde boyut (mm/cm/m/inç) ve hacim.
- **Hazır katılar:** küp, küre, silindir, koni, simit, düzlem.
- Taşı / döndür / ölçekle, ızgaraya yaslama (10 mm / 15°), standart görünümler (izometrik, üst, ön, sağ).
- Geri al / yinele (100 adım), çoğaltma, sahne ağacı.
- **Dışa aktarma:** STL (mm, Z-yukarı — 3B yazıcılar için), OBJ (mm), GLB (metre). Seçim varsa yalnızca seçili nesneler aktarılır.
- **İçe aktarma:** STL, OBJ, GLB/GLTF (dosya seçici veya sürükle-bırak).
- **Proje dosyası** (`.sharp3d.json`): sahnenin düzenlenebilir hâlini kaydedip açma; ayrıca tarayıcıya otomatik kayıt.
- Kenar çizgileri, gölgeler, tel kafes görünümü, PNG ekran görüntüsü.

### Kararlılık

- WebGL yoksa ya da grafik bağlamı kaybolursa açıklayıcı mesaj gösterilir; bağlam geri gelince çizim devam eder.
- Beklenmeyen hatalar uygulamayı durdurmaz, köşede bildirim olarak gösterilir.
- Otomatik kayıt tarayıcı kotasını aşarsa uyarılır; sekme kapanırken bekleyen kayıt hemen yazılır.
- Her derleme gerçek bir tarayıcıda uçtan uca duman testinden geçer (`npm test`).

## Kurulum

```bash
npm install
npm run dev      # geliştirme sunucusu (http://localhost:5173)
npm run build    # dist/ klasörüne üretim derlemesi
npm run preview  # derlemeyi önizle
npm test         # derleme üzerinde tarayıcı testleri (önce: npx playwright install chromium)
```

`dist/` klasörü statik dosyalardan oluşur ve göreli yollar kullanır; herhangi bir statik sunucuya ya da alt dizine kopyalanabilir.

### GitHub Pages ile yayınlama

`.github/workflows/deploy.yml` her `main` gönderiminde derler, test eder ve GitHub Pages'e yayınlar. Bir kez depo ayarlarından **Settings → Pages → Source: GitHub Actions** seçilmelidir.

## Kısayollar

| Tuş | İşlem |
| --- | --- |
| 1 / 2 / 3 | Dikdörtgen / Daire / Çokgen çiz |
| M | Ölç |
| Enter | Çokgeni kapat |
| Esc | Çizimi / aracı iptal et, seçimi kaldır |
| W / E / R | Taşı / Döndür / Ölçekle |
| S | Izgaraya yaslamayı aç/kapat |
| F | Seçime odaklan (seçim yoksa tüm sahne) |
| 0 / 7 / 8 / 9 | İzometrik / Üst / Ön / Sağ görünüm |
| Delete | Seçili nesneleri sil |
| Ctrl+Z / Ctrl+Y | Geri al / Yinele |
| Ctrl+D | Çoğalt |
| Ctrl+A | Tümünü seç |
| Ctrl+S / Ctrl+O | Projeyi kaydet / aç |

Fare: sol tık sürükle döndürür, sağ tık sürükle kaydırır, tekerlek yakınlaştırır. Çizim araçlarındayken sol tık çizer; kamera sağ tık ve tekerlekle kullanılır. Dokunmatik ekranda iki parmak kaydırır ve yakınlaştırır.

Ölçek: 1 ızgara hücresi = 100 mm.
