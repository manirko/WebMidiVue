#!/usr/bin/env python3
"""Run repeatable software QA with durable JSONL and separate raw output files."""
import argparse, datetime, hashlib, json, os, pathlib, signal, subprocess, sys, uuid
ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ['test:firmware', 'test:settings-readback', 'test:midi-lifecycle', 'test:diagnostics', 'test:telemetry', 'test:navigation', 'test:compatibility', 'test:listeners', 'test:midi-timing', 'test:sound', 'test:architecture', 'test:legacy-selector', 'test:playtron-variants', 'test:scales-variants', 'test:touchme-variants', 'test:presets', 'test:service-worker-ready', 'test:midi-permission-cancel', 'test:release-evidence', 'test:preview-guard', 'test:sound:levels']
p = argparse.ArgumentParser()
p.add_argument('--output', required=True, type=pathlib.Path)
p.add_argument('--timeout', type=float, default=180)
a = p.parse_args()
if a.timeout <= 0: p.error('--timeout must be positive')
run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
a.output = a.output/run_id
a.output.mkdir(parents=True, exist_ok=False)
head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
status = subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)
(a.output/'run.json').write_text(json.dumps(dict(run_id=run_id,head=head,working_tree=status,timeout=a.timeout),indent=2))
print('Evidence:', a.output, flush=True)
failed = False
counts = {}
with (a.output/'tests.jsonl').open('x') as journal:
 for name in TESTS:
  at = datetime.datetime.now(datetime.timezone.utc).isoformat()
  if name in ('test:presets', 'test:sound:levels'):
   record = dict(at=at,run_id=run_id,head=head,test=name,result='NOT RUN',reason='Requires browser automation; execute through the active browser tool.')
   journal.write(json.dumps(record)+'\n'); journal.flush()
   print(name, record['result'], flush=True)
   counts['NOT RUN'] = counts.get('NOT RUN', 0)+1
   continue
  process = subprocess.Popen(['npm','run',name],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
  timed_out = False
  try:
   output, _ = process.communicate(timeout=a.timeout)
  except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
   timed_out = True
   os.killpg(process.pid, signal.SIGKILL)
   output, _ = process.communicate()
   output += '\n'+type(error).__name__+'\n'
  filename = name.replace(':','-')+'.log'
  (a.output/filename).write_text(output)
  record = dict(at=at,run_id=run_id,head=head,test=name,result='TIMEOUT' if timed_out else ('PASS' if process.returncode == 0 else 'FAIL'),exit_code=process.returncode,evidence=filename,sha256=hashlib.sha256((a.output/filename).read_bytes()).hexdigest())
  journal.write(json.dumps(record)+'\n'); journal.flush()
  print(name, record['result'], flush=True); failed |= timed_out or process.returncode != 0
  counts[record['result']] = counts.get(record['result'], 0)+1
(a.output/'summary.json').write_text(json.dumps(dict(run_id=run_id,counts=counts,software_checks_passed=not failed,coverage_complete=not failed and not counts.get('NOT RUN')),indent=2))
sys.exit(1 if failed else 0)
