"""Prove timeout/failure reporting and immutable evidence without hardware/UI."""
import hashlib, json, os, pathlib, subprocess, sys, tempfile

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
  assert by_name['test:presets']['result'] == 'NOT RUN'
  assert by_name['test:sound:levels']['result'] == 'NOT RUN'
  for row in rows:
   if 'evidence' in row:
    assert hashlib.sha256((run/row['evidence']).read_bytes()).hexdigest() == row['sha256']
  summary = json.loads((run/'summary.json').read_text())
  assert not summary['coverage_complete'] and not summary['software_checks_passed']
 print('QA runner: failure, timeout, skipped coverage and immutable checksummed evidence passed')
