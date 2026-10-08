#!/usr/bin/env python3
"""Run repeatable software QA with durable JSONL and separate raw output files."""
import argparse, datetime, hashlib, json, math, os, pathlib, signal, subprocess, sys, time, uuid
ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ['test:auditions', 'test:auditions:render', 'test:qa-runner', 'test:audio-qa', 'test:audio:system-output', 'test:audio:physical-output', 'test:garden', 'test:firmware', 'test:settings-readback', 'test:midi-lifecycle', 'test:diagnostics', 'test:telemetry', 'test:navigation', 'test:compatibility', 'test:listeners', 'test:midi-timing', 'test:sound', 'test:architecture', 'test:legacy-selector', 'test:playtron-variants', 'test:scales-variants', 'test:touchme-variants', 'test:presets', 'test:service-worker-ready', 'test:midi-permission-cancel', 'test:release-evidence', 'test:preview-guard', 'test:sound:levels']
EXTERNAL_CHECKS = {
 'test:mobile:owner': 'Mandatory before Sergey handoff: Andrey must physically test the exact build and firmware on his phone, including USB/MIDI, calibration, audible sound, Garden touch/fullscreen, Stop/Start, settings and reconnect. A viewport/emulator or unsupported-browser message is not functional mobile PASS.',
 'test:firmware:physical-cycle': 'Rollback, reinstall and settings readback require a compatible physical board and pinned images.',
 'test:windows:daw': 'Windows/Ableton release, actual MIDI-clip recording, physical sound and web reconnect require independent evidence on a real Windows host; a listed port is not PASS.'
}
BROWSER_TESTS = ['test:production-isolation', 'test:build-destination', 'test:firmware:browser', 'test:beta-build', 'test:sound:browser', 'test:audio:realtime', 'test:pwa:browser', 'test:quality:browser', 'test:auditions:browser', 'test:playtron-variants:browser', 'test:scales-variants:browser', 'test:touchme-variants:browser']
BROWSER_TESTS.extend(['test:audio:load', 'test:ui-performance'])
TESTS.insert(0, 'test:lint')
p = argparse.ArgumentParser()
p.add_argument('--output', required=True, type=pathlib.Path)
p.add_argument('--timeout', type=float, default=180)
p.add_argument('--browser', action='store_true', help='Run isolated browser lanes with the required firmware/general-beta build order; no physical flashing')
p.add_argument('--soak-seconds', type=int, default=0, help='Optional real-time soak, 1–28800 seconds; requires --browser')
p.add_argument('--require-complete', action='store_true', help='Exit nonzero when required browser coverage is absent')
a = p.parse_args()
if not math.isfinite(a.timeout) or a.timeout <= 0: p.error('--timeout must be finite and positive')
if not 0 <= a.soak_seconds <= 28800: p.error('--soak-seconds must be from 0 to 28800')
if a.soak_seconds and not a.browser: p.error('--soak-seconds requires --browser')
TESTS.extend(BROWSER_TESTS)
if a.soak_seconds: TESTS.append('test:sound:soak')
TESTS.extend(EXTERNAL_CHECKS)
run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
a.output = a.output/run_id
a.output.mkdir(parents=True, exist_ok=False)
head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
status = subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)
inputs = []
for directory in ('src', 'public', 'beta-assets', 'scripts'):
 inputs.extend(path for path in (ROOT/directory).rglob('*') if path.is_file() and '__pycache__' not in path.parts)
inputs.extend(path for pattern in ('package*.json', '*config*', '.env*') for path in ROOT.glob(pattern) if path.is_file())
input_hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(set(inputs))}
(a.output/'inputs.json').write_text(json.dumps(input_hashes,indent=2))
(a.output/'run.json').write_text(json.dumps(dict(run_id=run_id,head=head,working_tree=status,timeout=a.timeout,soak_seconds=a.soak_seconds),indent=2))
print('Evidence:', a.output, flush=True)
failed = False
interrupted = False
counts = {}
package_scripts = json.loads((ROOT/'package.json').read_text())['scripts']
(a.output/'coverage.json').write_text(json.dumps({'planned': TESTS, 'available_scripts': sorted(package_scripts), 'unplanned_scripts': sorted(set(package_scripts)-set(TESTS)), 'physical_checks': EXTERNAL_CHECKS, 'browser_enabled': a.browser}, indent=2))
with (a.output/'tests.jsonl').open('x') as journal:
 for name in TESTS:
  at = datetime.datetime.now(datetime.timezone.utc).isoformat()
  if name in EXTERNAL_CHECKS or (name in BROWSER_TESTS and not a.browser) or name not in package_scripts:
   record = dict(at=at,run_id=run_id,head=head,test=name,result='NOT RUN',reason=EXTERNAL_CHECKS.get(name, 'Use --browser for isolated browser evidence.' if name in BROWSER_TESTS else 'No executable npm script exists for this proposed lane; never count as PASS.'))
   journal.write(json.dumps(record)+'\n'); journal.flush()
   print(name, record['result'], flush=True)
   counts['NOT RUN'] = counts.get('NOT RUN', 0)+1
   continue
  command = ['npm','run',name]
  lane_timeout = a.timeout
  if name == 'test:sound:soak':
   command = ['npm','run','test:sound:browser','--',f'--soak-seconds={a.soak_seconds}',f'--soak-report={a.output / "soak.json"}']
   lane_timeout = max(a.timeout, a.soak_seconds + 180)
  started = time.monotonic()
  process = subprocess.Popen(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True,env=dict(os.environ,BIOTRON_QA_OUTPUT=str(a.output)))
  timed_out = False
  interrupted = False
  try:
   output, _ = process.communicate(timeout=lane_timeout)
  except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
   timed_out = isinstance(error, subprocess.TimeoutExpired)
   interrupted = isinstance(error, KeyboardInterrupt)
   os.killpg(process.pid, signal.SIGKILL)
   output, _ = process.communicate()
   output += '\n'+type(error).__name__+'\n'
  filename = name.replace(':','-')+'.log'
  (a.output/filename).write_text(output)
  result = 'INTERRUPTED' if interrupted else 'TIMEOUT' if timed_out else 'INCONCLUSIVE' if name == 'test:ui-performance' and process.returncode == 2 else 'PASS' if process.returncode == 0 else 'FAIL'
  record = dict(at=at,run_id=run_id,head=head,test=name,result=result,exit_code=process.returncode,command=command,timeout=lane_timeout,duration_seconds=round(time.monotonic()-started,3),evidence=filename,sha256=hashlib.sha256((a.output/filename).read_bytes()).hexdigest())
  journal.write(json.dumps(record)+'\n'); journal.flush()
  print(name, record['result'], flush=True); failed |= interrupted or timed_out or process.returncode != 0
  counts[record['result']] = counts.get(record['result'], 0)+1
  if interrupted: break
(a.output/'summary.json').write_text(json.dumps(dict(run_id=run_id,counts=counts,software_checks_passed=not failed,coverage_complete=not failed and not counts.get('NOT RUN') and sum(counts.values()) == len(TESTS)),indent=2))
sys.exit(130 if interrupted else 1 if failed else 2 if a.require_complete and counts.get('NOT RUN') else 0)
