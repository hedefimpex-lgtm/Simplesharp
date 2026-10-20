# Sharp3D

Tarayıcıda çalışan, hafif bir 3D sahne editörü. [three.js](https://threejs.org) ve [Vite](https://vitejs.dev) ile yazıldı.

## Özellikler

- Primitif ekleme: küp, küre, silindir, koni, simit, düzlem
- Tıklayarak seçme, taşı / döndür / ölçekle araçları ve ızgaraya yaslama
- Sahne ağacı ve özellik paneli (ad, görünürlük, konum, dönüş, ölçek, renk, pürüzlülük, metaliklik, opaklık)
- Geri al / yinele
- GLB, GLTF, OBJ ve STL içe aktarma (dosya seçici veya sürükle-bırak)
- GLB olarak dışa aktarma ve PNG ekran görüntüsü
- Gölgeler, tel kafes görünümü, arka plan rengi
- Sahne tarayıcıda (localStorage) otomatik kaydedilir

## Kurulum

```bash
npm install
npm run dev      # geliştirme sunucusu
npm run build    # dist/ klasörüne üretim derlemesi
npm run preview  # derlemeyi önizle
```

## Kısayollar

| Tuş | İşlem |
| --- | --- |
| W / E / R | Taşı / Döndür / Ölçekle |
| S | Izgaraya yaslamayı aç/kapat |
| F | Seçime odaklan (seçim yoksa tüm sahne) |
| Delete | Seçili nesneyi sil |
| Esc | Seçimi kaldır |
| Ctrl+Z / Ctrl+Y | Geri al / Yinele |
| Ctrl+D | Çoğalt |

Fare: sol tık sürükle döndürür, sağ tık sürükle kaydırır, tekerlek yakınlaştırır.
