#!/usr/bin/env python3
"""A local, immutable Biotron field-test packet. No firmware writer or MIDI client."""
import argparse
import datetime
import hashlib
import http.server
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import threading
import urllib.parse
import uuid
import zipfile

# Final packager fills this after the web freeze; incomplete drafts fail closed.
WEB_COMMIT = 'PACKAGING_PENDING_WEB_COMMIT'
FIRMWARE_VERSION = '1.10.11'
FIRMWARE_SOURCE = 'a7739040e07ba7ca04767682755eec8589c15234'
FROZEN_SHA = '598d5a084f1eb3274e7c62b7bbeec1701f49d28edad87662e19c084dfc75477d'
ROLLBACK_SHA = '823d044374268462d39b13c0e65dc2676cda2fb3d5162edba78aedccb0a09f3d'
UF2_SHA = '18a73113ae75ccd68d244a2d90d1e902848a8473452e65b07a2173883abe6d60'
CASES = {
 'W01': 'Exact web, firmware, PCB, OS, browser and audio route identity',
 'W02': 'Device-free Play Sound palette, computer keyboard/Limit to 4 notes at once, then local preset and explicit Apply',
 'W03': 'Real plant/light sound, held notes, Stop and subsequent incoming notes',
 'W04': 'Chrome and Edge sustained known stimulus; preserve first freeze',
 'W05': 'Real DAW MIDI clip: On/Off, releases and audible receiver behavior',
 'W06': 'Release web port -> DAW -> reconnect, three actual cycles',
 'W07': 'Background, foreground and USB disconnect/reconnect',
 'W08': 'Offline reopen and comparison sound, no false ready state',
 'W09': 'Installed/same/legacy firmware presentation, without BOOT or write',
 'W10': 'Physical flash -> rollback -> reflash; screened board/backup/review first',
 'W11': 'Play: ten timbres/ten upper-note/six handpan; Settings: ten explicitly selected calibration cues',
 'W12': 'Independent native details, sliders, local feedback and exact copied diagnostics',
 'W13': 'Physical phone USB/MIDI, sound, settings and recovery (separate platform)',
 'W14': 'FB44 physical active calibration cue: original-channel Note Off, next cue on new channel; DAW/audio',
}


def utc():
 return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json(path, value):
 path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def digest(path):
 return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_file(root, relative):
 parts = PurePosixPath(relative)
 if not relative or '\\' in relative or ':' in relative or parts.is_absolute() or '..' in parts.parts:
  raise ValueError('Unsafe manifest path: '+relative)
 file = root.joinpath(*parts.parts)
 if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
  raise ValueError('Path leaves packet: '+relative)
 return file


def verify(root):
 if not re.fullmatch(r'[0-9a-f]{40}', WEB_COMMIT):
  raise ValueError('Web candidate not frozen; final packet assembly required')
 manifest = json.loads((root/'packet-manifest.json').read_text(encoding='utf-8'))
 if manifest['web_commit'] != WEB_COMMIT:
  raise ValueError('Unexpected web commit')
 if manifest.get('firmware_version') != FIRMWARE_VERSION or manifest.get('firmware_source_commit') != FIRMWARE_SOURCE:
  raise ValueError('Firmware identity differs from candidate')
 for relative, expected in manifest['files'].items():
  file = safe_file(root, relative)
  if not file.is_file() or digest(file) != expected:
   raise ValueError('Missing/changed packet file: '+relative)
 runtime = root/'runtime'
 expected = {x[len('runtime/'):] for x in manifest['files'] if x.startswith('runtime/')}
 actual = {x.relative_to(runtime).as_posix() for x in runtime.rglob('*') if x.is_file()}
 if actual != expected:
  raise ValueError('Runtime inventory changed')
 for directory in ['automation', 'vendor']:
  expected = {x[len(directory)+1:] for x in manifest['files'] if x.startswith(directory+'/')}
  actual = {x.relative_to(root/directory).as_posix() for x in (root/directory).rglob('*') if x.is_file()}
  if actual != expected:raise ValueError(directory+' inventory changed')
 release = json.loads((runtime/'release-evidence.json').read_text(encoding='utf-8'))
 if release['source_commit'] != WEB_COMMIT:
  raise ValueError('Runtime metadata differs from candidate')
 if digest(runtime/'firmware/biotron-1.10.11-internal.uf2') != UF2_SHA:
  raise ValueError('Firmware hash differs from candidate')
 if digest(runtime/'firmware/biotron-1.10.10-internal.uf2') != FROZEN_SHA:
  raise ValueError('Frozen 1.10.10 hash differs')
 if digest(runtime/'firmware/biotron-1.10.9-clean.uf2') != ROLLBACK_SHA:
  raise ValueError('Rollback hash differs from candidate')
 return manifest


def browser_candidates(name, env=None, system=None):
 env = os.environ if env is None else env
 system = sys.platform if system is None else system
 candidates = [env.get(('CHROME' if name=='chrome' else 'EDGE')+'_PATH')]
 if system == 'win32':
  suffix = 'Google/Chrome/Application/chrome.exe' if name=='chrome' else 'Microsoft/Edge/Application/msedge.exe'
  for key in ['PROGRAMFILES', 'ProgramFiles', 'PROGRAMFILES(X86)', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'LocalAppData']:
   if env.get(key): candidates.append(str(Path(env[key])/Path(suffix)))
 elif system == 'darwin':
  candidates.append('/Applications/'+('Google Chrome' if name=='chrome' else 'Microsoft Edge')+'.app/Contents/MacOS/'+('Google Chrome' if name=='chrome' else 'Microsoft Edge'))
 else:
  candidates += [shutil.which('google-chrome' if name=='chrome' else 'microsoft-edge'), shutil.which('chromium') if name=='chrome' else None]
 return list(dict.fromkeys(x for x in candidates if x))


def find_browser(name):
 return next((x for x in browser_candidates(name) if Path(x).is_file()), None)


def new_run(root, kind):
 directory = root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+kind+'-'+uuid.uuid4().hex[:8])
 directory.mkdir(parents=True, exist_ok=False)
 return directory


def make_server(root, manifest, port, run):
 # Only exact runtime files are exposed. No directory listing, profile, packet or evidence.
 allowed = {x[len('runtime/'):] for x in manifest['files'] if x.startswith('runtime/')}
 class Handler(http.server.BaseHTTPRequestHandler):
  def do_GET(self):
   pathname = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
   relative = 'index.html' if pathname=='/' else pathname.lstrip('/')
   if relative not in allowed:
    self.reply(404, b'Not found', 'text/plain'); return
   file = safe_file(root/'runtime', relative)
   mime = mimetypes.guess_type(relative)[0] or 'application/octet-stream'
   if relative.endswith(('.js','.mjs')): mime='text/javascript'
   body=file.read_bytes()
   if hashlib.sha256(body).hexdigest() != manifest['files']['runtime/'+relative]:
    self.reply(409,b'Packet file changed; stop and preserve this incident','text/plain');return
   self.reply(200, body, mime)
  def do_POST(self):
   # This internal transport has no telemetry database and never consumes a request body.
   self.close_connection = True
   self.reply(503, b'{"accepted":false,"reason":"field_test_storage_disabled"}', 'application/json')
  def reply(self, code, body, mime):
   self.send_response(code)
   self.send_header('Content-Type', mime)
   self.send_header('Content-Length', str(len(body)))
   self.send_header('Cache-Control', 'no-store' if self.path=='/' or 'service-worker' in self.path else 'public, max-age=0')
   self.send_header('X-Content-Type-Options', 'nosniff')
   self.send_header('Referrer-Policy', 'no-referrer')
   self.send_header('Permissions-Policy', 'midi=(self), fullscreen=(self)')
   self.end_headers()
   self.wfile.write(body)
  def log_message(self, format, *args):
   # No arbitrary URL/query/console content in the server log.
   with (run/'http.jsonl').open('a', encoding='utf-8') as log:
    log.write(json.dumps({'at':utc(), 'method':self.command, 'path':urllib.parse.urlsplit(self.path).path[:300], 'status':str(args[1]) if len(args)>1 else ''})+'\n')
 return http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)


def export_results(root):
 output = root/('biotron-results-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]+'.zip')
 results = root/'results'
 if not results.is_dir(): raise ValueError('No results yet')
 files = [p for p in results.rglob('*') if p.is_file()]
 allowed = {'.json','.jsonl','.log','.txt','.md','.png','.jpg','.zip','.mid','.wav','.mp4','.webm'}
 if any(p.is_symlink() or not p.resolve().is_relative_to(results.resolve()) for p in files):
  raise ValueError('Results contain links outside their directory')
 if any(p.suffix.lower() not in allowed or any(x.lower() in ['profile','profiles','node_modules'] for x in p.relative_to(results).parts) for p in files):
  raise ValueError('Unexpected evidence file; inspect results before bundling')
 inventory = {p.relative_to(root).as_posix():digest(p) for p in sorted(files)}
 with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED) as archive:
  for p in files: archive.write(p,p.relative_to(root).as_posix())
  archive.writestr('result-manifest.json',json.dumps({'at':utc(),'web_commit':WEB_COMMIT,'firmware_version':FIRMWARE_VERSION,'firmware_source_commit':FIRMWARE_SOURCE,'firmware_sha256':UF2_SHA,'files':inventory,'status':'UNREVIEWED_OPERATOR_EVIDENCE','customer_release':False},indent=2))
 return output


def node_version(executable):
 if not executable: return None
 try:
  version=subprocess.run([executable,'--version'],capture_output=True,text=True,timeout=5,check=True).stdout.strip()
  return version
 except (OSError,subprocess.SubprocessError): return None


def run_autotest(root, run, browser, executable, node):
 # Reuse the project's exact audition suite; no second engine or MIDI client.
 script=root/'automation/scripts/test-audition-browser.js'
 if not script.is_file():raise ValueError('This packet has no autonomous suite')
 env={**os.environ, 'NODE_PATH':str(root/'vendor'), 'BIOTRON_QA_DIST_ROOT':str(root/'runtime'),
      'BIOTRON_QA_BROWSER':'msedge' if browser=='edge' else 'chrome',
      ('EDGE_PATH' if browser=='edge' else 'CHROME_PATH'):executable,
      'AUDITION_BROWSER_OUTPUT':str(run/'browser'), 'AUDITION_BROWSER_TIMEOUT_MS':'540000'}
 command=[node,str(script)]
 write_json(run/'autotest-config.json',{'at':utc(),'command':command,'browser':browser,'executable':executable,'web_commit':WEB_COMMIT,'native_midi':'NOT_USED; isolated synthetic fixture','physical_result':'NOT_RUN'})
 fault=None;code=None;cleanup='NOT_CHECKED';interrupted=False
 with (run/'autotest.log').open('w',encoding='utf-8') as log:
  try:code=subprocess.run(command,cwd=root/'automation',env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600).returncode
  except subprocess.TimeoutExpired:
   cleanup='NOT_CONFIRMED';fault='Suite exceeded 600 seconds. Stop further autotest/capture until owned-process cleanup is confirmed.'
  except KeyboardInterrupt:
   interrupted=True;cleanup='NOT_CONFIRMED';fault='Suite interrupted. Stop further autotest/capture until owned-process cleanup is confirmed.'
  except OSError as error:
   cleanup='NOT_CONFIRMED';fault='Suite execution error: '+str(error)+'. Stop further autotest/capture until owned-process cleanup is confirmed.'
 if code!=0:fault=fault or 'Autonomous suite failed; keep the first fault and log.'
 if not fault:
  try:
   progress=json.loads((run/'browser/progress.json').read_text(encoding='utf-8'))
   keys=json.loads((run/'browser/keyboard-observations.json').read_text(encoding='utf-8'))
   if progress[-1]['stage']!='PASS' or len({(x['bank'],x['id']) for x in keys})!=43:
    fault='Suite exited without complete PASS and 43 keyboard observations.'
  except (OSError,ValueError,KeyError,IndexError,TypeError):fault='Suite evidence is missing or incomplete.'
 if fault:write_json(run/'first-autotest-fault.json',{'at':utc(),'message':fault,'exit_code':code,'cleanup':cleanup,'status':'INTERRUPTED' if interrupted else 'FAIL_OR_INCONCLUSIVE; not physical acceptance'})
 write_json(run/'autotest-summary.json',{'at':utc(),'status':'INTERRUPTED' if interrupted else 'FAIL' if fault else 'PASS_SOFTWARE_ONLY','exit_code':code,'cleanup':cleanup,'web_commit':WEB_COMMIT,'browser':browser,'physical_windows_result':'NOT_RUN','customer_release':False,'error':fault})
 if fault:raise ValueError(fault+' Evidence: '+str(run))
 print('Software tests passed. USB and audible sound remain for the manual steps. Evidence:',run)


def main():
 if sys.version_info < (3,10): raise ValueError('Python3.10+ required')
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--root',type=Path,default=Path(__file__).resolve().parent)
 sub=p.add_subparsers(dest='command',required=True)
 sub.add_parser('verify'); sub.add_parser('doctor'); sub.add_parser('cases'); sub.add_parser('bundle')
 serve=sub.add_parser('serve'); serve.add_argument('--browser',choices=['chrome','edge','none'],default='none');serve.add_argument('--port',type=int,default=8765)
 capture=sub.add_parser('capture');capture.add_argument('--browser',choices=['chrome','edge'],default='chrome');capture.add_argument('--site',choices=['local','live'],default='local');capture.add_argument('--origin',help='Exact approved HTTPS origin for live capture');capture.add_argument('--minutes',type=float,default=10);capture.add_argument('--port',type=int,default=8765);capture.add_argument('--smoke',action='store_true',help='Automated headless harness check; never a physical PASS')
 autotest=sub.add_parser('autotest');autotest.add_argument('--browser',choices=['chrome','edge'],default='chrome')
 record=sub.add_parser('record');record.add_argument('--case',choices=CASES,required=True);record.add_argument('--result',choices=['PASS','FAIL','NOT_RUN','BLOCKED','INCONCLUSIVE'],required=True);record.add_argument('--note',required=True);record.add_argument('--evidence',action='append',default=[])
 args=p.parse_args();root=args.root.resolve()
 if args.command=='cases':print(json.dumps(CASES,ensure_ascii=False,indent=2));return
 manifest=verify(root)
 if args.command=='verify':print('Packet bytes verified; physical tests NOT RUN');return
 if args.command=='bundle':
  output=export_results(root);print(str(output));print('SHA256:',digest(output));return
 if args.command=='record':
  for relative in args.evidence:
   file=safe_file(root,relative)
   if not relative.startswith('results/') or not file.is_file():raise ValueError('Evidence must be an existing results file')
  run=new_run(root,'observation')
  write_json(run/'observation.json',{'at':utc(),'case':args.case,'reported_result':args.result,'note':args.note,'evidence':{x:digest(safe_file(root,x)) for x in args.evidence},'source':'operator_supplied_not_independently_verified','web_commit':WEB_COMMIT,'customer_release':False})
  print(run);return
 browsers={name:find_browser(name) for name in ['chrome','edge']}
 run=new_run(root,args.command)
 environment={'at':utc(),'system':platform.system(),'release':platform.release(),'machine':platform.machine(),'python':platform.python_version(),'node':shutil.which('node'),'browsers':browsers,'web_commit':WEB_COMMIT,'firmware_version':FIRMWARE_VERSION,'firmware_source_commit':FIRMWARE_SOURCE,'firmware_sha256':UF2_SHA,'physical_windows_result':'NOT_RUN','customer_release':False}
 environment['node_version']=node_version(environment['node'])
 write_json(run/'environment.json',environment)
 if args.command=='doctor':print(json.dumps(environment,ensure_ascii=False,indent=2));return
 if args.command=='autotest':
  if not browsers[args.browser]:raise ValueError('Browser not found; set CHROME_PATH or EDGE_PATH')
  if not environment['node_version'] or int(environment['node_version'].lstrip('v').split('.')[0])<20:raise ValueError('Autotest needs Node.js >=20; plain serve only needs Python')
  run_autotest(root,run,args.browser,browsers[args.browser],environment['node']);return
 if not 0<=args.port<=65535:p.error('port must be 0..65535')
 if args.command=='capture' and not 0<args.minutes<=30:p.error('minutes must be >0 and <=30')
 if args.browser!='none' and not browsers[args.browser]:raise ValueError('Browser not found; set CHROME_PATH or EDGE_PATH to its exact executable')
 server=None
 try:
  if args.command=='serve' or args.site=='local':
   server=make_server(root,manifest,args.port,run)
   threading.Thread(target=server.serve_forever,daemon=True).start()
   origin='http://127.0.0.1:'+str(server.server_address[1])
  else:
   url=urllib.parse.urlsplit(args.origin or '')
   if url.scheme!='https' or not url.netloc or url.username or url.password or url.path not in ['', '/'] or url.query or url.fragment:
    raise ValueError('Live capture requires an explicit approved HTTPS origin; no default/latest fallback')
   origin=urllib.parse.urlunsplit(('https',url.netloc,'','',''))
  print('Exact field-test site:',origin+'/#/biotron/play',flush=True)
  if args.command=='serve':
   if args.browser!='none':
    profile=root/'.tester-profiles'/(args.browser+'-plain');profile.mkdir(parents=True,exist_ok=True)
    subprocess.Popen([browsers[args.browser],'--user-data-dir='+str(profile),'--new-window',origin+'/#/biotron/play'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   print('Ctrl+C stops only this local server. Close its test browser normally.',flush=True)
   threading.Event().wait()
  else:
   node=shutil.which('node')
   if not node or not environment['node_version'] or int(environment['node_version'].lstrip('v').split('.')[0])<20:raise ValueError('Capture needs installed Node.js >=20; plain serve only needs Python')
   profile=root/'.tester-profiles'/(args.browser+'-observed')
   config={'root':str(root),'run':str(run),'executable':browsers[args.browser],'browser':args.browser,'origin':origin,'profile':str(profile),'seconds':args.minutes*60,'smoke':args.smoke,'web_commit':WEB_COMMIT,'firmware_version':FIRMWARE_VERSION,'firmware_source_commit':FIRMWARE_SOURCE}
   write_json(run/'capture-config.json',config)
   result=subprocess.run([node,str(root/'capture-browser.cjs'),str(run/'capture-config.json')],cwd=root)
   if result.returncode:raise ValueError('Capture stopped with an incident; see '+str(run))
 except KeyboardInterrupt:
  write_json(run/'operator-interruption.json',{'at':utc(),'status':'INTERRUPTED_NOT_PHYSICAL_PASS'})
 finally:
  if server:server.shutdown();server.server_close()

if __name__=='__main__':
 try:main()
 except (ValueError,OSError,KeyError) as error:
  print('BLOCKED:',error,file=sys.stderr);sys.exit(1)
