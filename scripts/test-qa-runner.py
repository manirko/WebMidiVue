"""Prove timeout/failure reporting and immutable evidence without hardware/UI."""
import hashlib, json, os, pathlib, subprocess, sys, tempfile, signal, time

runner = pathlib.Path(__file__).with_name('run-biotron-qa.py')
with tempfile.TemporaryDirectory(prefix='biotron-runner-test-') as temporary:
 root = pathlib.Path(temporary)
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
  for name in ['test:mobile:owner','test:pwa:browser','test:firmware:browser','test:firmware:physical-cycle','test:quality:browser','test:windows:daw']:
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
 npm.write_text('#!/bin/sh\nsleep 5\n')
 interrupted = subprocess.Popen([sys.executable,str(runner),'--output',str(output)],env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 time.sleep(.25)
 interrupted.send_signal(signal.SIGINT)
 stdout, stderr = interrupted.communicate(timeout=15)
 assert interrupted.returncode == 130, stdout+stderr
 latest = max(output.iterdir(),key=lambda p:p.stat().st_mtime_ns)
 rows = [json.loads(line) for line in (latest/'tests.jsonl').read_text().splitlines()]
 assert len(rows) == 1 and rows[0]['result'] == 'INTERRUPTED', rows
 print('QA runner: strict incomplete gate and interruption stop; failure, timeout, skipped coverage and immutable checksummed evidence passed')
