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
BROWSER_TESTS = ['test:browser-harness', 'test:production-isolation', 'test:build-destination', 'test:firmware:browser', 'test:beta-build', 'test:sound:browser', 'test:audio:realtime', 'test:pwa:browser', 'test:quality:browser', 'test:auditions:browser', 'test:playtron-variants:browser', 'test:scales-variants:browser', 'test:touchme-variants:browser']
BROWSER_TESTS.extend(['test:audio:load', 'test:ui-performance'])
TESTS.insert(0, 'test:lint')
p = argparse.ArgumentParser()
p.add_argument('--output', required=True, type=pathlib.Path)
p.add_argument('--timeout', type=float, default=180)
p.add_argument('--browser', action='store_true', help='Run isolated browser lanes with the required firmware/general-beta build order; no physical flashing')
p.add_argument('--browsers', default='', help='Additional sequential full Biotron/software browser lanes: comma-separated BIOTRON_QA_BROWSER names; requires --browser. Safari is separate from Playwright WebKit.')
p.add_argument('--soak-seconds', type=int, default=0, help='Optional real-time soak, 1–28800 seconds; requires --browser')
p.add_argument('--require-complete', action='store_true', help='Exit nonzero when required browser coverage is absent')
p.add_argument('--only', default=None, help='Comma-separated planned lane names for an affected-only recheck; other lanes stay NOT RUN and required builds are retained')
a = p.parse_args()
if not math.isfinite(a.timeout) or a.timeout <= 0: p.error('--timeout must be finite and positive')
if not 0 <= a.soak_seconds <= 28800: p.error('--soak-seconds must be from 0 to 28800')
if a.soak_seconds and not a.browser: p.error('--soak-seconds requires --browser')
matrix_browsers = [name.strip() for name in a.browsers.split(',') if name.strip()]
if matrix_browsers and not a.browser: p.error('--browsers requires --browser')
if len(matrix_browsers) != len(set(matrix_browsers)): p.error('--browsers must not contain duplicates')
allowed_browsers = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./scripts/browser-test-harness').browserNames))"], cwd=ROOT, text=True))
if any(name not in allowed_browsers for name in matrix_browsers): p.error('--browsers contains an unknown selector; allowed: '+','.join(allowed_browsers))
portable_lanes = ('test:firmware:browser', 'test:sound:browser', 'test:pwa:browser', 'test:quality:browser', 'test:auditions:browser',
                  'test:playtron-variants:browser', 'test:scales-variants:browser', 'test:touchme-variants:browser')
matrix_lanes = {}
for script in BROWSER_TESTS:
 TESTS.append(script)
 if script in portable_lanes:
  for browser in matrix_browsers:
   name = f'{script}@{browser}'
   matrix_lanes[name] = (script, browser)
   TESTS.append(name)
if a.soak_seconds: TESTS.append('test:sound:soak')
TESTS.extend(EXTERNAL_CHECKS)
selected = [name.strip() for name in (a.only or '').split(',') if name.strip()]
if a.only is not None and (not selected or len(selected) != len(set(selected)) or any(name not in TESTS for name in selected)):
 p.error('--only must contain unique planned lane names')
required_builds = set()
for name in selected:
 script = matrix_lanes.get(name, (name,))[0]
 if (script in portable_lanes and script != 'test:firmware:browser') or script in ('test:sound:soak', 'test:audio:realtime', 'test:audio:load', 'test:ui-performance'):
  required_builds.add('test:beta-build')
 if script == 'test:firmware:browser': required_builds.add('test:firmware:browser')
selected = set(selected) | required_builds if selected else set(TESTS)
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
(a.output/'run.json').write_text(json.dumps(dict(run_id=run_id,head=head,working_tree=status,timeout=a.timeout,soak_seconds=a.soak_seconds,selected=[name for name in TESTS if name in selected],required_builds=sorted(required_builds)),indent=2))
print('Evidence:', a.output, flush=True)
def process_snapshot():
 """Only PID/parent/start/status metadata; never commands or user profile data."""
 output = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,lstart=,stat='], text=True, timeout=3)
 return {int(parts[0]): (int(parts[1]), ' '.join(parts[2:7]), parts[7])
         for line in output.splitlines() if len(parts := line.split()) >= 8}

def owned_descendants(root_pid, snapshot):
 owned = {root_pid} if root_pid in snapshot else set()
 while True:
  children = {pid for pid, entry in snapshot.items() if entry[0] in owned}
  if children <= owned: return {pid: snapshot[pid][1] for pid in owned}
  owned.update(children)

def stop_owned_attempt(process):
 # Playwright browsers can have separate process groups. SIGINT first lets its
 # documented handler close them; a start-time identity prevents killing reused PIDs.
 parent_lost = process.poll() is not None
 try: owned = None if parent_lost else owned_descendants(process.pid, process_snapshot()) or None
 except (OSError, subprocess.SubprocessError): owned = None
 if process.poll() is None:
  try: os.killpg(process.pid, signal.SIGINT)
  except ProcessLookupError: pass
  except OSError: owned = None
 try: output, _ = process.communicate(timeout=12)
 except subprocess.TimeoutExpired:
  if owned is not None:
   try:
    snapshot = process_snapshot()
    if snapshot.get(process.pid, (None, None))[1] == owned.get(process.pid):
     owned.update(owned_descendants(process.pid, snapshot))
    for pid, started in owned.items():
     if pid in snapshot and snapshot[pid][1] == started:
      try: os.kill(pid, signal.SIGKILL)
      except ProcessLookupError: pass
   except (OSError, subprocess.SubprocessError): owned = None
  if owned is None and process.poll() is None:
   try: process.kill()
   except ProcessLookupError: pass
   except OSError: pass
  try: output, _ = process.communicate(timeout=5)
  except subprocess.TimeoutExpired as error:
   partial = error.output or ''
   return partial.decode(errors='replace') if isinstance(partial, bytes) else partial, False, 'stdout/cleanup did not finish within grace deadlines'
 if owned is None: return output, False, 'process inventory unavailable; cleanup is unconfirmed'
 try:
  snapshot = process_snapshot()
  survivors = [pid for pid, started in owned.items() if pid in snapshot and snapshot[pid][1] == started and not snapshot[pid][2].startswith('Z')]
 except (OSError, subprocess.SubprocessError): return output, False, 'cleanup readback unavailable'
 return output, not survivors, 'surviving owned processes: '+','.join(map(str, survivors)) if survivors else 'owned processes released'

failed = False
interrupted = False
counts = {}
continuation_allowed = True
cleanup_confirmed = None
cleanup_reason = None
package_scripts = json.loads((ROOT/'package.json').read_text())['scripts']
(a.output/'coverage.json').write_text(json.dumps({'planned': TESTS, 'available_scripts': sorted(package_scripts), 'unplanned_scripts': sorted(set(package_scripts)-set(TESTS)), 'physical_checks': EXTERNAL_CHECKS, 'browser_enabled': a.browser, 'matrix_browsers': matrix_browsers, 'matrix_lanes': matrix_lanes}, indent=2))
with (a.output/'tests.jsonl').open('x') as journal:
 for name in TESTS:
  script, browser = matrix_lanes.get(name, (name, 'chrome'))
  if not continuation_allowed:
   record = dict(test=name, browser=browser, result='NOT RUN', reason='Previous lane cleanup unconfirmed: '+cleanup_reason)
   journal.write(json.dumps(record)+'\n'); journal.flush()
   counts['NOT RUN'] = counts.get('NOT RUN', 0)+1
   continue
  at = datetime.datetime.now(datetime.timezone.utc).isoformat()
  if name not in selected or name in EXTERNAL_CHECKS or (name in BROWSER_TESTS and not a.browser) or script not in package_scripts:
   record = dict(at=at,run_id=run_id,head=head,test=name,result='NOT RUN',reason=EXTERNAL_CHECKS.get(name, 'Outside --only recheck; no result for this lane.' if name not in selected else 'Use --browser for isolated browser evidence.' if name in BROWSER_TESTS else 'No executable npm script exists for this proposed lane; never count as PASS.'))
   journal.write(json.dumps(record)+'\n'); journal.flush()
   print(name, record['result'], flush=True)
   counts['NOT RUN'] = counts.get('NOT RUN', 0)+1
   continue
  command = ['npm','run','test:firmware:browser:compiled' if name in matrix_lanes and script == 'test:firmware:browser' else script]
  lane_timeout = a.timeout
  if name == 'test:sound:soak':
   command = ['npm','run','test:sound:browser','--',f'--soak-seconds={a.soak_seconds}',f'--soak-report={a.output / "soak.json"}']
   lane_timeout = max(a.timeout, a.soak_seconds + 180)
  started = time.monotonic()
  lane_env = dict(os.environ, BIOTRON_QA_OUTPUT=str(a.output), BIOTRON_QA_BROWSER=browser)
  if script == 'test:auditions:browser': lane_env['AUDITION_BROWSER_OUTPUT'] = str(a.output / name.replace(':', '-'))
  if script == 'test:quality:browser': lane_env['QUALITY_BROWSER_OUTPUT'] = str(a.output / name.replace(':', '-'))
  if script == 'test:sound:browser': lane_env['BIOTRON_TEST_EVIDENCE_DIR'] = str(a.output / name.replace(':', '-'))
  cleanup_confirmed = None
  cleanup_reason = None
  process = subprocess.Popen(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True,env=lane_env)
  timed_out = False
  interrupted = False
  try:
   output, _ = process.communicate(timeout=lane_timeout)
  except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
   timed_out = isinstance(error, subprocess.TimeoutExpired)
   interrupted = isinstance(error, KeyboardInterrupt)
   output, cleanup_confirmed, cleanup_reason = stop_owned_attempt(process)
   continuation_allowed = cleanup_confirmed
   output += '\n'+type(error).__name__+'\n'
  filename = name.replace(':','-')+'.log'
  (a.output/filename).write_text(output)
  result = 'INTERRUPTED' if interrupted else 'TIMEOUT' if timed_out else 'INCONCLUSIVE' if name == 'test:ui-performance' and process.returncode == 2 else 'PASS' if process.returncode == 0 else 'FAIL'
  record = dict(at=at,run_id=run_id,head=head,test=name,browser=browser,result=result,exit_code=process.returncode,command=command,cleanup_confirmed=cleanup_confirmed,cleanup_reason=cleanup_reason,timeout=lane_timeout,duration_seconds=round(time.monotonic()-started,3),evidence=filename,sha256=hashlib.sha256((a.output/filename).read_bytes()).hexdigest())
  journal.write(json.dumps(record)+'\n'); journal.flush()
  print(name, record['result'], flush=True); failed |= interrupted or timed_out or process.returncode != 0
  counts[record['result']] = counts.get(record['result'], 0)+1
  if interrupted: break
(a.output/'summary.json').write_text(json.dumps(dict(run_id=run_id,counts=counts,software_checks_passed=not failed,coverage_complete=not failed and not counts.get('NOT RUN') and sum(counts.values()) == len(TESTS)),indent=2))
sys.exit(130 if interrupted else 1 if failed else 2 if a.require_complete and counts.get('NOT RUN') else 0)
