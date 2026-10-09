"""Prove timeout/failure reporting and immutable evidence without hardware/UI."""
import hashlib, json, os, pathlib, subprocess, sys, tempfile, signal, time, shutil

runner = pathlib.Path(__file__).with_name('run-biotron-qa.py')
with tempfile.TemporaryDirectory(prefix='biotron-runner-test-') as temporary:
 root = pathlib.Path(temporary)
 # Required heap measurements must fail closed instead of replacing missing
 # metrics with zero and reporting a false no-leak result.
 browser=(runner.parent/'test-sound-browser.js').read_text()
 start=browser.index('function requiredMetric(list, name) {')
 end=browser.index('\n}\n',start)+2
 metric_test="const assert=require('node:assert/strict');\n"+browser[start:end]+r"""
 assert.equal(requiredMetric([{name:'JSHeapUsedSize',value:1024}],'JSHeapUsedSize'),1024);
 for(const value of [undefined,0,-1,NaN,Infinity]) assert.throws(()=>requiredMetric(value===undefined?[]:[{name:'JSHeapUsedSize',value}],'JSHeapUsedSize'),/Missing\/invalid/);
 """
 checked=subprocess.run(['node','-'],input=metric_test,capture_output=True,text=True,timeout=5)
 assert checked.returncode==0,checked.stderr
 # The real browser-bench generator must reject stale/ambiguous boundaries,
 # rather than silently copying the remaining Node launcher into browser JS.
 marker='// browser-qa:sound-body:start'
 end='// browser-qa:sound-body:end'
 sound=(runner.parent/'test-sound-elementary.js').read_text()
 for name,broken in [('missing',sound.replace(marker,'')),('duplicate',sound.replace(marker,marker+'\n'+marker)),('reversed',sound.replace(marker,'__swap__').replace(end,marker).replace('__swap__',end))]:
  fixture=root/name/'scripts';fixture.mkdir(parents=True)
  shutil.copyfile(runner.parent/'build-browser-qa-harness.py',fixture/'build-browser-qa-harness.py')
  shutil.copyfile(runner.parent/'test-presets-idb.js',fixture/'test-presets-idb.js')
  (fixture/'test-sound-elementary.js').write_text(broken)
  checked=subprocess.run([sys.executable,str(fixture/'build-browser-qa-harness.py'),'--output',str(root/name/'output')],capture_output=True,text=True,timeout=5)
  assert checked.returncode!=0 and 'source boundar' in checked.stderr.lower(),name+checked.stderr
  assert not (root/name/'output/entry.mjs').exists(),name
 # Exercise the real level-test launcher under the runner's hard-stop mode.
 # Its build files must stay outside the checkout even when exit hooks cannot run.
 fixture = root/'interrupted-levels'; (fixture/'scripts').mkdir(parents=True)
 launcher = fixture/'scripts/test-sound-elementary.js'; launcher.write_text(sound)
 scratch = root/'level-scratch'; scratch.mkdir()
 stub_bin = root/'interrupt-bin'; stub_bin.mkdir()
 ready = root/'interrupt-ready.json'
 npx = stub_bin/'npx'
 npx.write_text('#!'+sys.executable+'\nimport json,os,sys,time\nfrom pathlib import Path\nPath(os.environ["BIOTRON_LEVEL_READY"]).write_text(json.dumps(sys.argv[1:]))\ntime.sleep(60)\n')
 npx.chmod(0o700)
 environment = dict(os.environ, PATH=str(stub_bin)+os.pathsep+os.environ['PATH'],
  NODE_PATH=str(runner.parent.parent/'node_modules'), TMPDIR=str(scratch), BIOTRON_LEVEL_READY=str(ready))
 before = {str(p.relative_to(fixture)):hashlib.sha256(p.read_bytes()).hexdigest() for p in fixture.rglob('*') if p.is_file()}
 process = subprocess.Popen(['node',str(launcher)],env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,text=True)
 try:
  deadline=time.monotonic()+10
  while not ready.exists() and process.poll() is None and time.monotonic()<deadline: time.sleep(.02)
  assert ready.exists(), 'Real level-test launcher never reached bundler'
 finally:
  if process.poll() is None: os.killpg(process.pid,signal.SIGKILL)
  stdout,stderr=process.communicate(timeout=5)
 assert process.returncode == -signal.SIGKILL, stdout+stderr
 arguments=json.loads(ready.read_text())
 entry=pathlib.Path(arguments[2]); bundle=pathlib.Path(next(a.split('=',1)[1] for a in arguments if a.startswith('--outfile=')))
 assert entry.is_absolute() and bundle.is_absolute() and not entry.is_relative_to(fixture) and not bundle.is_relative_to(fixture), 'Hard stop leaves sound-test build files in checkout'
 after={str(p.relative_to(fixture)):hashlib.sha256(p.read_bytes()).hexdigest() for p in fixture.rglob('*') if p.is_file()}
 assert after==before, 'Hard stop changed the checkout inventory'
 assert entry.exists(), 'Interruption fixture did not exercise an actual generated entry'
 print('Level-test hard-stop: real launcher leaves checkout unchanged')
 binaries = root/'bin'; binaries.mkdir()
 git = binaries/'git'
 git.write_text('#!/bin/sh\ncase "$1" in rev-parse) echo fixture-head;; status) echo " M fixture";; esac\n')
 npm = binaries/'npm'
 npm.write_text('#!/bin/sh\ncase "$2" in test:firmware) echo first-failure; exit 7;; test:midi-lifecycle) sleep 5;; *) echo fixture-pass;; esac\n')
 for executable in (git, npm): executable.chmod(0o700)
 environment = dict(os.environ, PATH=str(binaries)+os.pathsep+os.environ['PATH'])
 output = root/'evidence'
 for attempt in range(2):
  result = subprocess.run([sys.executable,str(runner),'--output',str(output),'--timeout','0.2'],env=environment,capture_output=True,text=True,timeout=15)
  assert result.returncode == 1, result.stdout+result.stderr
 runs = sorted(output.iterdir())
 assert len(runs) == 2
 for run in runs:
  rows = [json.loads(line) for line in (run/'tests.jsonl').read_text().splitlines()]
  by_name = {row['test']:row for row in rows}
  assert by_name['test:firmware']['result'] == 'FAIL'
  assert by_name['test:firmware']['exit_code'] == 7
  assert by_name['test:midi-lifecycle']['result'] == 'TIMEOUT'
  assert by_name['test:presets']['result'] == 'PASS'
  assert by_name['test:sound:levels']['result'] == 'PASS'
  for name in ['test:audio:realtime','test:mobile:owner','test:pwa:browser','test:firmware:browser','test:firmware:physical-cycle','test:quality:browser','test:windows:daw']:
   assert by_name[name]['result'] == 'NOT RUN', name
  for row in rows:
   if 'evidence' in row:
    assert hashlib.sha256((run/row['evidence']).read_bytes()).hexdigest() == row['sha256']
  summary = json.loads((run/'summary.json').read_text())
  assert not summary['coverage_complete'] and not summary['software_checks_passed']
 npm.write_text('#!/bin/sh\necho fixture-pass\n')
 strict = subprocess.run([sys.executable,str(runner),'--output',str(output),'--require-complete'],env=environment,capture_output=True,text=True,timeout=15)
 assert strict.returncode == 2, strict.stdout+strict.stderr
 latest = max(output.iterdir(),key=lambda p:p.stat().st_mtime_ns)
 strict_rows = [json.loads(line) for line in (latest/'tests.jsonl').read_text().splitlines()]
 owner_mobile = next(row for row in strict_rows if row['test']=='test:mobile:owner')
 assert owner_mobile['result']=='NOT RUN'
 assert not json.loads((latest/'summary.json').read_text())['coverage_complete']
 # Soak uses the existing browser lane, records its arguments and reserves
 # duration + startup time even when the ordinary lane timeout is smaller.
 soak = subprocess.run([sys.executable,str(runner),'--output',str(output),'--browser','--soak-seconds','600','--timeout','0.2'],env=environment,capture_output=True,text=True,timeout=15)
 assert soak.returncode == 0, soak.stdout+soak.stderr
 latest = max(output.iterdir(),key=lambda p:p.stat().st_mtime_ns)
 rows = [json.loads(line) for line in (latest/'tests.jsonl').read_text().splitlines()]
 row = next(row for row in rows if row['test']=='test:sound:soak')
 assert row['result']=='PASS' and row['timeout']==780 and row['duration_seconds']>=0
 assert row['command'][:4]==['npm','run','test:sound:browser','--']
 assert '--soak-seconds=600' in row['command']
 assert row['command'][-1]=='--soak-report='+str(latest/'soak.json')
 assert next(row for row in rows if row['test']=='test:audio:load')['result']=='PASS'
 assert next(row for row in rows if row['test']=='test:ui-performance')['result']=='PASS'
 assert next(row for row in rows if row['test']=='test:lint')['result']=='PASS'
 for arguments in [['--soak-seconds','600'],['--browser','--soak-seconds','-1'],['--browser','--soak-seconds','28801'],['--timeout','nan'],['--timeout','inf']]:
  invalid = subprocess.run([sys.executable,str(runner),'--output',str(output),*arguments],env=environment,capture_output=True,text=True,timeout=5)
  assert invalid.returncode==2 and 'error:' in invalid.stderr, arguments
 npm.write_text('#!/bin/sh\ncase "$2" in test:ui-performance) echo fixture-inconclusive; exit 2;; *) echo fixture-pass;; esac\n')
 inconclusive = subprocess.run([sys.executable,str(runner),'--output',str(output),'--browser'],env=environment,capture_output=True,text=True,timeout=15)
 assert inconclusive.returncode == 1, inconclusive.stdout+inconclusive.stderr
 latest = max(output.iterdir(),key=lambda p:p.stat().st_mtime_ns)
 rows = [json.loads(line) for line in (latest/'tests.jsonl').read_text().splitlines()]
 assert next(row for row in rows if row['test']=='test:ui-performance')['result']=='INCONCLUSIVE'
 assert not json.loads((latest/'summary.json').read_text())['software_checks_passed']
 npm.write_text('#!/bin/sh\nsleep 5\n')
 interrupted = subprocess.Popen([sys.executable,str(runner),'--output',str(output)],env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 time.sleep(.25)
 interrupted.send_signal(signal.SIGINT)
 stdout, stderr = interrupted.communicate(timeout=15)
 assert interrupted.returncode == 130, stdout+stderr
 latest = max(output.iterdir(),key=lambda p:p.stat().st_mtime_ns)
 rows = [json.loads(line) for line in (latest/'tests.jsonl').read_text().splitlines()]
 assert len(rows) == 1 and rows[0]['result'] == 'INTERRUPTED', rows
 print('QA runner: source-boundary controls; soak timeout/arguments, invalid options, browser skip, strict incomplete gate, interruption, failure, timeout and immutable checksummed evidence passed')
