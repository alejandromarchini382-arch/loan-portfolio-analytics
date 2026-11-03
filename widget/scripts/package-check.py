"""Inspect the official release artifact; no package is synthesized or renamed into an MPK."""
import hashlib,json,shutil
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
pkg=json.loads((ROOT/'package.json').read_text())
name=f"{pkg['packagePath']}.{pkg['widgetName']}.mpk"
artifact=ROOT/'dist'/pkg['version']/name
with ZipFile(artifact) as z:
    assert z.testzip() is None
    entries=z.namelist()
    package=ET.fromstring(z.read('package.xml'))
    assert package.find('.//{http://www.mendix.com/clientModule/1.0/}clientModule').attrib['version']==pkg['version']
    widget=ET.fromstring(z.read('AxisLoanPortfolio.xml'))
    assert widget.attrib['pluginWidget']=='true' and widget.attrib['supportedPlatform']=='Web'
    assert widget.attrib['offlineCapable']=='false'
    for suffix in ['AxisLoanPortfolio.js','AxisLoanPortfolio.mjs','AxisLoanPortfolio.css','AxisLoanPortfolio.editorConfig.js','AxisLoanPortfolio.editorPreview.js']:
        assert any(e.endswith(suffix) for e in entries),suffix
    assert not any(e.endswith(('.map','.env','.spec.ts','.spec.tsx')) for e in entries)
    runtime=b'\n'.join(z.read(e) for e in entries if e.endswith(('.js','.mjs')))
    assert b'/api/v1/portfolio' in runtime and b'Idempotency-Key' in runtime
    assert b'test-only-token' not in runtime
    print('Widget ID:',widget.attrib['id'])
    print('Entries:',len(entries))
release=ROOT/'releases'/name;release.parent.mkdir(exist_ok=True);shutil.copyfile(artifact,release)
result={'artifact':'releases/'+name,'bytes':release.stat().st_size,'sha256':hashlib.sha256(release.read_bytes()).hexdigest(),'archiveValidated':True,'studioProImport':'NOT RUN','mendixRuntime':'NOT RUN','trustedMendixAuthentication':'NOT RUN'}
(ROOT/'package-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
