"""Packet safety and Windows path contract; these are not actual Windows acceptance."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import zipfile

spec=importlib.util.spec_from_file_location('tester',Path(__file__).with_name('tester.py'))
tester=importlib.util.module_from_spec(spec);spec.loader.exec_module(tester)

class PacketTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='biotron-packet-test-')
  self.root=Path(self.temp.name)
  runtime=self.root/'runtime';runtime.mkdir()
  (runtime/'index.html').write_text('<!doctype html><title>exact</title>')
  (runtime/'app.js').write_text('window.fixture=true')
  (runtime/'release-evidence.json').write_text(json.dumps({'source_commit':tester.WEB_COMMIT}))
  (runtime/'firmware').mkdir()
  source=Path(__file__).resolve().parent/'runtime/firmware/biotron-1.10.10-internal.uf2'
  if not source.is_file():source=Path(__file__).resolve().parents[2]/'beta-assets/firmware/biotron-1.10.10-internal.uf2'
  (runtime/'firmware/biotron-1.10.10-internal.uf2').write_bytes(source.read_bytes())
  (runtime/'firmware/biotron-1.10.9-clean.uf2').write_bytes(source.with_name('biotron-1.10.9-clean.uf2').read_bytes())
  self.manifest={'web_commit':tester.WEB_COMMIT,'files':{x.relative_to(self.root).as_posix():tester.digest(x) for x in runtime.rglob('*') if x.is_file()}}
  tester.write_json(self.root/'packet-manifest.json',self.manifest)
 def tearDown(self):self.temp.cleanup()
 def test_hash_change_stops_packet(self):
  tester.verify(self.root)
  (self.root/'runtime/app.js').write_text('changed')
  with self.assertRaisesRegex(ValueError,'changed'):tester.verify(self.root)
 def test_extra_runtime_file_and_wrong_identity_stop(self):
  (self.root/'runtime/private.txt').write_text('private')
  with self.assertRaisesRegex(ValueError,'inventory'):tester.verify(self.root)
  (self.root/'runtime/private.txt').unlink()
  self.manifest['web_commit']='another'
  tester.write_json(self.root/'packet-manifest.json',self.manifest)
  with self.assertRaisesRegex(ValueError,'commit'):tester.verify(self.root)
 def test_stale_runtime_metadata_cannot_pass_rehashed_manifest(self):
  file=self.root/'runtime/release-evidence.json'
  file.write_text(json.dumps({'source_commit':'4bcc0d85c9f736a7e4defdc5192081d1d580432a'}))
  self.manifest['files']['runtime/release-evidence.json']=tester.digest(file)
  tester.write_json(self.root/'packet-manifest.json',self.manifest)
  with self.assertRaisesRegex(ValueError,'metadata differs'):tester.verify(self.root)
 def test_altered_rollback_cannot_pass_with_rehashed_manifest(self):
  file=self.root/'runtime/firmware/biotron-1.10.9-clean.uf2';file.write_bytes(b'other image')
  self.manifest['files']['runtime/firmware/biotron-1.10.9-clean.uf2']=tester.digest(file)
  tester.write_json(self.root/'packet-manifest.json',self.manifest)
  with self.assertRaisesRegex(ValueError,'Rollback'):tester.verify(self.root)
 def test_paths_cannot_escape_on_either_os(self):
  for name in ['../secret','/secret','C:/secret','..\\secret','runtime/../../secret']:
   with self.subTest(name=name),self.assertRaises(ValueError):tester.safe_file(self.root,name)
 def test_windows_both_browsers_and_space_paths(self):
  env={'ProgramFiles':'C:/Program Files','ProgramFiles(x86)':'C:/Program Files (x86)','LOCALAPPDATA':'C:/Users/Test/AppData/Local'}
  for name,tail in [('chrome','Google/Chrome/Application/chrome.exe'),('edge','Microsoft/Edge/Application/msedge.exe')]:
   candidates=tester.browser_candidates(name,env,'win32')
   self.assertIn(str(Path(env['ProgramFiles'])/tail),candidates)
   self.assertIn(str(Path(env['ProgramFiles(x86)'])/tail),candidates)
   self.assertIn(str(Path(env['LOCALAPPDATA'])/tail),candidates)
  self.assertEqual(tester.browser_candidates('edge',{'EDGE_PATH':'D:/Special Browser/edge.exe'},'win32')[0],'D:/Special Browser/edge.exe')
 def test_server_whitelist_telemetry_and_private_files(self):
  run=tester.new_run(self.root,'server')
  (self.root/'results/private.txt').write_text('private')
  server=tester.make_server(self.root,self.manifest,0,run)
  threading.Thread(target=server.serve_forever,daemon=True).start()
  origin='http://127.0.0.1:'+str(server.server_address[1])
  try:
   with urllib.request.urlopen(origin+'/') as response:
    self.assertEqual(response.read(),(self.root/'runtime/index.html').read_bytes())
    self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
   for relative in ['/packet-manifest.json','/tester.py','/results/private.txt','/%2e%2e/tester.py','/runtime/index.html','/.tester-profiles/Default/Cookies']:
    with self.subTest(relative=relative),self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(origin+relative)
    self.assertEqual(error.exception.code,404)
    error.exception.close()
   with self.assertRaises(urllib.error.HTTPError) as error:
    urllib.request.urlopen(urllib.request.Request(origin+'/api/telemetry',data=b'{"note":"must not be stored"}',headers={'Content-Type':'application/json'}))
   self.assertEqual(error.exception.code,503)
   error.exception.close()
   self.assertNotIn('must not be stored',(run/'http.jsonl').read_text())
   self.assertEqual(server.server_address[0],'127.0.0.1')
   (self.root/'runtime/app.js').write_text('changed after startup')
   with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(origin+'/app.js')
   self.assertEqual(error.exception.code,409)
   error.exception.close()
  finally:server.shutdown();server.server_close()
 def test_bundle_does_not_copy_browser_profiles_or_programs(self):
  run=tester.new_run(self.root,'manual')
  tester.write_json(run/'observation.json',{'reported_result':'NOT_RUN'})
  profile=self.root/'.tester-profiles';profile.mkdir();(profile/'Cookies').write_text('private')
  output=tester.export_results(self.root)
  with zipfile.ZipFile(output) as archive:
   self.assertFalse(any('Cookies' in name for name in archive.namelist()))
   data=json.loads(archive.read('result-manifest.json'))
   self.assertEqual(data['status'],'UNREVIEWED_OPERATOR_EVIDENCE')
   self.assertFalse(data['customer_release'])
  (run/'dangerous.exe').write_text('unexpected')
  with self.assertRaisesRegex(ValueError,'Unexpected'):tester.export_results(self.root)
 def test_new_attempt_never_overwrites_first_failure(self):
  first=tester.new_run(self.root,'failure');tester.write_json(first/'first-fault.json',{'error':'first'})
  second=tester.new_run(self.root,'retry')
  self.assertNotEqual(first,second)
  self.assertEqual(json.loads((first/'first-fault.json').read_text())['error'],'first')

if __name__=='__main__':unittest.main()
