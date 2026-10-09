"""Packet safety and Windows path contract; these are not actual Windows acceptance."""
import importlib.util
import subprocess
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock
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
  # Synthetic bytes exercise verification; never claim a real UF2/platform result.
  fixtures={'biotron-1.10.11-internal.uf2':b'test-only candidate', 'biotron-1.10.10-internal.uf2':b'test-only frozen', 'biotron-1.10.9-clean.uf2':b'test-only rollback'}
  for name,body in fixtures.items():(runtime/'firmware'/name).write_bytes(body)
  patch=mock.patch.multiple(tester,WEB_COMMIT='1'*40,UF2_SHA=tester.digest(runtime/'firmware/biotron-1.10.11-internal.uf2'),FROZEN_SHA=tester.digest(runtime/'firmware/biotron-1.10.10-internal.uf2'),ROLLBACK_SHA=tester.digest(runtime/'firmware/biotron-1.10.9-clean.uf2'))
  patch.start();self.addCleanup(patch.stop)
  (runtime/'release-evidence.json').write_text(json.dumps({'source_commit':tester.WEB_COMMIT}))
  self.manifest={'web_commit':tester.WEB_COMMIT,'firmware_version':tester.FIRMWARE_VERSION,'firmware_source_commit':tester.FIRMWARE_SOURCE,'files':{x.relative_to(self.root).as_posix():tester.digest(x) for x in runtime.rglob('*') if x.is_file()}}
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
 def test_unassembled_web_and_wrong_firmware_identity_stop(self):
  with mock.patch.object(tester,'WEB_COMMIT','PACKAGING_PENDING_WEB_COMMIT'),self.assertRaisesRegex(ValueError,'not frozen'):tester.verify(self.root)
  self.manifest['firmware_version']='1.10.10'
  tester.write_json(self.root/'packet-manifest.json',self.manifest)
  with self.assertRaisesRegex(ValueError,'Firmware identity'):tester.verify(self.root)
 def test_altered_candidate_and_frozen_cannot_pass_rehashed_manifest(self):
  for name,message in [('biotron-1.10.11-internal.uf2','Firmware hash'),('biotron-1.10.10-internal.uf2','Frozen')]:
   file=self.root/'runtime'/'firmware'/name;original=file.read_bytes();file.write_bytes(b'changed')
   self.manifest['files']['runtime/firmware/'+name]=tester.digest(file);tester.write_json(self.root/'packet-manifest.json',self.manifest)
   with self.subTest(name=name),self.assertRaisesRegex(ValueError,message):tester.verify(self.root)
   file.write_bytes(original);self.manifest['files']['runtime/firmware/'+name]=tester.digest(file)
 def test_case_inventory_keeps_physical_cue_gate(self):
  self.assertEqual(len(tester.CASES),14)
  self.assertIn('FB44',tester.CASES['W14'])
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
 def run_capture_fixture(self, mode):
  # Execute the real JS launcher with deterministic browser/time adapters.
  # No actual browser, MIDI, audio graph, network or permissions in this oracle.
  script=r"""
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const [source,root,mode]=process.argv.slice(1);let clock=0,index=0,exit;
const config={root,run:root,origin:'http://fixture',profile:root,executable:'fixture',smoke:true,web_commit:'fixture',seconds:30};
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
const locator={waitFor:async()=>{},click:async()=>{},count:async()=>6,locator:()=>locator};
const page={setDefaultTimeout(){},on(){},goto:async()=>{},isClosed:()=>false,screenshot:async()=>{},locator:()=>locator,
 getByLabel:()=>({...locator,count:async()=>1}),getByRole:(role,args)=>({...locator,count:async()=>args.name==='Calibration sounds'?0:1}),
 evaluate:async()=>{index++;let audio=[];
  if(mode==='late' && index>=3)audio=[{id:0,state:'running',time:(index-3)/10}];
  if(mode==='frozen')audio=[{id:0,state:'running',time:1}];
  if(mode==='suspended')audio=[{id:0,state:'suspended',time:index/10}];
  if(mode==='writeoverrun')audio=[{id:0,state:'running',time:index/10}];
  if(mode==='different')audio=[{id:index,state:'running',time:index/10}];
  if(mode==='stopped')audio=[{id:0,state:index<=2?'running':'suspended',time:Math.min(index,2)/10}];
  if(mode==='overrun' && index>=9){if(index===10)clock+=4000;audio=[{id:0,state:'running',time:index-9}];}
  return {audio};}};
const context={addInitScript:async()=>{},pages:()=>[page],newCDPSession:async()=>({send:async name=>name==='Performance.getMetrics'?{metrics:[]}:{} }),tracing:{start:async()=>{},stop:async()=>{}},close:async()=>{}};
const fixtureFs={...fs,appendFileSync(file,data){fs.appendFileSync(file,data);if(mode==='writeoverrun' && index===3)clock+=11000;}};
const sandbox={require:name=>name==='node:fs'?fixtureFs:name==='node:path'?path:name==='node:perf_hooks'?{performance:{now:()=>clock}}:{chromium:{launchPersistentContext:async()=>context}},
 process:{argv:['node','capture',path.join(root,'config.json')],on(){},exit:code=>{exit=code}},console:{log(){}},
 fetch:async()=>({ok:true,json:async()=>({source_commit:'fixture'})}),AbortSignal:{timeout(){}},WeakRef,
 setTimeout:(fn,ms)=>{if(ms===1000)queueMicrotask(()=>{clock+=ms;fn()});return 1},clearTimeout(){}};
vm.runInNewContext(fs.readFileSync(source,'utf8'),sandbox,{filename:source});
setImmediate(()=>{if(exit===undefined)throw Error('Launcher did not complete');process.stdout.write(JSON.stringify({exit,summary:JSON.parse(fs.readFileSync(path.join(root,'capture-summary.json'),'utf8')),samples:index})+'\n')});
"""
  result=subprocess.run(['node','-e',script,str(Path(__file__).with_name('capture-browser.cjs')),tempfile.mkdtemp(prefix='capture-fixture-',dir=self.root),mode],capture_output=True,text=True,timeout=10,check=True)
  return json.loads(result.stdout)
 def test_smoke_waits_for_delayed_real_clock(self):
  result=self.run_capture_fixture('late')
  self.assertEqual(result['exit'],0)
  self.assertEqual(result['summary']['status'],'SMOKE_PASS_NOT_PHYSICAL_ACCEPTANCE')
  self.assertGreaterEqual(result['samples'],4)
  self.assertLessEqual(result['samples'],10)
 def test_smoke_rejects_absent_frozen_or_foreign_clocks(self):
  for mode in ['missing','frozen','suspended','different','stopped','overrun','writeoverrun']:
   with self.subTest(mode=mode):
    result=self.run_capture_fixture(mode)
    self.assertEqual(result['exit'],1)
    self.assertEqual(result['summary']['status'],'CAPTURE_FAULT')
    self.assertLessEqual(result['samples'],10)

 def test_new_attempt_never_overwrites_first_failure(self):
  first=tester.new_run(self.root,'failure');tester.write_json(first/'first-fault.json',{'error':'first'})
  second=tester.new_run(self.root,'retry')
  self.assertNotEqual(first,second)
  self.assertEqual(json.loads((first/'first-fault.json').read_text())['error'],'first')

 def test_unlisted_autonomous_code_is_rejected(self):
  for directory in ['automation','vendor']:
   extra=self.root/directory/'unexpected.js';extra.parent.mkdir();extra.write_text('unexpected')
   with self.subTest(directory=directory),self.assertRaisesRegex(ValueError,'inventory changed'):tester.verify(self.root)
   extra.unlink()

 def autonomous_fixture(self, run, mode):
  (self.root/'automation/scripts').mkdir(parents=True,exist_ok=True)
  (self.root/'automation/scripts/test-audition-browser.js').write_text('// command fixture only')
  (self.root/'automation/scripts/test-sound-browser.js').write_text('// settings fixture only')
  def execute(command, **kwargs):
   if command[-1]=='--settings-only':
    observed=run/'settings'
    if mode=='settings_timeout':raise subprocess.TimeoutExpired(command,600)
    if mode=='settings_fail':return subprocess.CompletedProcess(command,1)
    tester.write_json(observed/'settings-matrix.json',{'rows':[{'field':str(i),'status':'PASS'} for i in range(25 if mode=='settings_early' else 26)]})
    tester.write_json(observed/'settings-boundaries.json',[{'status':'PASS'} for i in range(17)])
    return subprocess.CompletedProcess(command,0)
   observed=run/'browser';observed.mkdir()
   tester.write_json(observed/'progress.json',[{'stage':'PASS'}])
   tester.write_json(observed/'keyboard-observations.json',[{'bank':'fixture','id':str(i)} for i in range(43 if mode=='pass' or mode.startswith('settings_') else 42)])
   if mode=='timeout':raise subprocess.TimeoutExpired(command,600)
   if mode=='fail':tester.write_json(observed/'failure.json',{'error':'original product fault'})
   return subprocess.CompletedProcess(command,1 if mode=='fail' else 0)
  return execute

 def test_autonomous_command_keeps_browser_identity_and_local_fixture(self):
  for browser in ['chrome','edge']:
   run=tester.new_run(self.root,'auto-'+browser)
   with mock.patch.object(tester.subprocess,'run',side_effect=self.autonomous_fixture(run,'pass')) as call:
    tester.run_autotest(self.root,run,browser,'C:/Browser With Spaces/app.exe','node')
   args,kwargs=call.call_args_list[0]
   self.assertEqual(call.call_count,2)
   self.assertEqual(call.call_args_list[1].args[0], ['node',str(self.root/'automation/scripts/test-sound-browser.js'),'--settings-only'])
   self.assertEqual(call.call_args_list[1].kwargs['env']['BIOTRON_TEST_EVIDENCE_DIR'],str(run/'settings'))
   self.assertEqual(args[0],['node',str(self.root/'automation/scripts/test-audition-browser.js')])
   self.assertEqual(kwargs['cwd'],self.root/'automation')
   self.assertEqual(kwargs['timeout'],600)
   self.assertEqual(kwargs['env']['BIOTRON_QA_BROWSER'],'msedge' if browser=='edge' else 'chrome')
   self.assertEqual(kwargs['env']['EDGE_PATH' if browser=='edge' else 'CHROME_PATH'],'C:/Browser With Spaces/app.exe')
   self.assertEqual(kwargs['env']['BIOTRON_QA_DIST_ROOT'],str(self.root/'runtime'))
   summary=json.loads((run/'autotest-summary.json').read_text())
   self.assertEqual(summary['status'],'PASS_SOFTWARE_ONLY')
   self.assertFalse(summary['customer_release'])
   self.assertEqual(summary['physical_windows_result'],'NOT_RUN')

 def test_autonomous_failure_timeout_or_early_exit_cannot_pass(self):
  for mode in ['fail','timeout','early','settings_fail','settings_timeout','settings_early']:
   run=tester.new_run(self.root,'auto-'+mode)
   with mock.patch.object(tester.subprocess,'run',side_effect=self.autonomous_fixture(run,mode)):
    with self.subTest(mode=mode),self.assertRaises(ValueError):tester.run_autotest(self.root,run,'chrome','fixture','node')
   self.assertEqual(json.loads((run/'autotest-summary.json').read_text())['status'],'FAIL')
   self.assertTrue((run/'first-autotest-fault.json').is_file())
   if mode=='fail':self.assertEqual(json.loads((run/'browser/failure.json').read_text())['error'],'original product fault')

 def test_autonomous_missing_evidence_cannot_pass(self):
  run=tester.new_run(self.root,'auto-missing');self.autonomous_fixture(run,'pass')
  with mock.patch.object(tester.subprocess,'run',return_value=subprocess.CompletedProcess([],0)):
   with self.assertRaisesRegex(ValueError,'missing or incomplete'):tester.run_autotest(self.root,run,'chrome','fixture','node')

 def test_autonomous_interruption_and_launch_error_save_nonpass(self):
  for error,status,cleanup in [(KeyboardInterrupt(),'INTERRUPTED','NOT_CONFIRMED'),(OSError('injected execution failure'),'FAIL','NOT_CONFIRMED')]:
   run=tester.new_run(self.root,'auto-exception');self.autonomous_fixture(run,'pass')
   with mock.patch.object(tester.subprocess,'run',side_effect=error),self.assertRaises(ValueError):
    tester.run_autotest(self.root,run,'chrome','fixture','node')
   summary=json.loads((run/'autotest-summary.json').read_text())
   self.assertEqual(summary['status'],status)
   self.assertEqual(summary['cleanup'],cleanup)
   self.assertFalse(summary['customer_release'])
   fault=json.loads((run/'first-autotest-fault.json').read_text())
   self.assertNotIn('Close only its test window',fault['message'])
   if cleanup=='NOT_CONFIRMED':self.assertIn('Stop further autotest/capture',fault['message'])

if __name__=='__main__':unittest.main()
