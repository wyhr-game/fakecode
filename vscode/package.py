import hashlib, io, json, os, zipfile

ROOT = r"D:\fakecode_me"
NAME = "xiaogong-engine"
VER = json.load(io.open(os.path.join(ROOT, "package.json"), encoding="utf-8"))["version"]
OUT = os.path.join(ROOT, "%s-%s.vsix" % (NAME, VER))

FILES = [
    "package.json",
    "extension.js",
    "src/engine.js",
    "src/render.js",
    "src/ui.js",
    "src/panel.js",
    "sample/ledger.py",
    "sample/report.py",
    "sample/cli.py",
    "sample/test_ledger.py",
    "README.md",
    "CHANGELOG.md",
    "LICENSE.md",
]

MANIFEST = '''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="%(name)s" Version="%(ver)s" Publisher="wyhr" />
    <DisplayName>魈公引擎</DisplayName>
    <Description xml:space="preserve">把代码按人的节奏重放一遍：选一个本地代码目录，它开始在编辑器里从头写代码。只读、不联网、不生成代码。</Description>
    <Tags>typing,demo,fake,code,moyu</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.75.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="https://github.com/wyhr-game/fakecode" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.md</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.md" Addressable="true" />
  </Assets>
</PackageManifest>
''' % {"name": NAME, "ver": VER}

CT = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
'''

if os.path.exists(OUT):
    os.remove(OUT)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", CT)
    z.writestr("extension.vsixmanifest", MANIFEST)
    for rel in FILES:
        src = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.exists(src):
            raise SystemExit("  缺文件: " + rel)
        with io.open(src, "r", encoding="utf-8", newline="") as fh:
            z.writestr("extension/" + rel, fh.read())

print("  ✓ %s  %.1f KB" % (os.path.basename(OUT), os.path.getsize(OUT)/1024))
with open(OUT, "rb") as fh:
    print("  sha256:", hashlib.sha256(fh.read()).hexdigest()[:16])
