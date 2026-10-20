// electron-builder afterPack kancası: Windows .exe dosyasına simge ve sürüm bilgisi yazar.
// rcedit (Wine gerektirir) yerine saf JavaScript olan resedit kullanılır; böylece kurulum
// dosyası Linux ve macOS üzerinde de derlenebilir.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const [info] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (info) {
    const parts = version.split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 4) parts.push(0);
    info.setFileVersion(...parts);
    info.setProductVersion(...parts);
    for (const t of info.getAllLanguagesForStringValues()) {
      info.setStringValues(t, {
        FileDescription: 'Sharp3D',
        ProductName: 'Sharp3D',
        CompanyName: 'Sharp3D',
        LegalCopyright: 'Sharp3D',
        OriginalFilename: `${productFilename}.exe`,
        InternalName: productFilename,
        FileVersion: version,
        ProductVersion: version,
      });
    }
    info.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • simge ve sürüm bilgisi yazıldı: ${path.basename(exePath)}`);
};
