#!/usr/bin/env python3
"""Package the existing field helper and pinned public artifact; no deploy or MIDI."""
import argparse, hashlib, json, re, shutil, subprocess, zipfile
from pathlib import Path, PurePosixPath

ROOT=Path(__file__).resolve().parents[2]
STABLE_SHA='d2406d66225f76779331714b0a9df814d1c72d7f3640178f29adc9d3b45b4251'
AUTOMATION=['scripts/test-audition-browser.js','scripts/test-sound-browser.js','scripts/test-firmware-modal-browser.js','scripts/browser-test-harness.js','scripts/audio-qa/analyze.mjs','src/audio/auditionBanks.mjs','src/audio/elementary/timbres.mjs','src/audio/elementary/fx/srvb.mjs','src/audio/elementary/fx/LICENSE-chromatone.txt']

def sha(body):return hashlib.sha256(body).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def write(path,body):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
def zip_bytes(output,rows):
 with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED) as archive:
  for name,body in sorted(rows.items()):
   info=zipfile.ZipInfo(name,date_time=(2026,10,12,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
   info.external_attr=0o100644<<16;archive.writestr(info,body)

def validate_artifact(runtime,commit):
 release=json.loads((runtime/'release-evidence.json').read_text(encoding='utf-8'))
 if release.get('commit')!=commit or release.get('firmware_update_enabled') is not True or release.get('firmware_update_channel')!='public-stable':raise ValueError('Exact public-stable artifact required')
 expected={row['path']:row['sha256'] for row in release['files']}
 if len(expected)!=len(release['files']):raise ValueError('Duplicate artifact paths')
 actual={p.relative_to(runtime).as_posix():p for p in runtime.rglob('*') if p.is_file()}
 if set(actual)!=set(expected)|{'release-evidence.json'}:raise ValueError('Artifact inventory differs')
 for name,file in actual.items():
  parts=PurePosixPath(name)
  if file.is_symlink() or '..' in parts.parts or parts.is_absolute() or '\\' in name or ':' in name:raise ValueError('Unsafe artifact path')
  if name.lower().endswith('.uf2'):raise ValueError('Public artifact must not contain firmware images')
  if name in expected and sha(file.read_bytes())!=expected[name]:raise ValueError('Artifact SHA differs: '+name)
 return release,actual

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 for name in ['web-commit','online-origin']:parser.add_argument('--'+name,required=True)
 for name in ['runtime','stable-input','output']:parser.add_argument('--'+name,required=True,type=Path)
 args=parser.parse_args();commit=args.web_commit
 if not re.fullmatch('[0-9a-f]{40}',commit):parser.error('40-hex web commit required')
 if not re.fullmatch(r'https://[0-9a-f]{8}\.biotron-settings-beta\.pages\.dev',args.online_origin):parser.error('Exact immutable beta origin required')
 if git('status','--porcelain').strip():raise ValueError('Commit own helper/docs before packaging')
 helper=git('rev-parse','HEAD').decode().strip()
 if git('diff','--name-only',commit,helper,'--','src','public','beta-assets','scripts','package.json','package-lock.json','vue.config.js').strip():raise ValueError('App/test inputs changed after exact app gate')
 release,files=validate_artifact(args.runtime.resolve(),commit)
 if args.stable_input.is_symlink() or sha(args.stable_input.read_bytes())!=STABLE_SHA:raise ValueError('Official stable test input SHA differs')
 packet=args.output.resolve();packet.mkdir(parents=True,exist_ok=False)
 for name,file in files.items():write(packet/'runtime'/name,file.read_bytes())
 write(packet/'test-inputs/biotron-firmware_v1.8.2.uf2',args.stable_input.read_bytes())
 helper_root=ROOT/'tools/windows-tester'
 data=(helper_root/'tester.py').read_text(encoding='utf-8')
 for name,value in {'WEB_COMMIT':repr(commit),'FIRMWARE_CHANNEL':repr('public-stable'),'FIRMWARE_VERSION':repr('1.8.2'),'FIRMWARE_SOURCE':'None','UF2_SHA':repr(STABLE_SHA)}.items():
  data,count=re.subn(r'^'+name+r' = .*$',name+' = '+value,data,flags=re.M)
  if count!=1:raise ValueError('Helper packaging marker differs: '+name)
 write(packet/'tester.py',data.encode())
 write(packet/'capture-browser.cjs',(helper_root/'capture-browser.cjs').read_bytes())
 substitutions={'{{WEB_COMMIT}}':commit,'{{HELPER_COMMIT}}':helper,'{{ONLINE_URL}}':args.online_origin}
 for source,target in [('PACKET-GUIDE.md','README.md'),('CLAUDE.md','CLAUDE.md'),('START-HERE.html','START-HERE.html')]:
  text=(helper_root/source).read_text(encoding='utf-8')
  for marker,value in substitutions.items():text=text.replace(marker,value)
  if '{{' in text:raise ValueError('Unfilled document marker')
  write(packet/target,text.encode())
 source_hashes={}
 for name in AUTOMATION:
  body=git('show',commit+':'+name);source_hashes[name]=sha(body)
  write(packet/'automation'/name,body)
 vendor=ROOT/'node_modules/playwright-core'
 if json.loads((vendor/'package.json').read_text())['version']!='1.62.1':raise ValueError('Pinned Playwright1.62.1 required')
 if any(p.is_symlink() for p in vendor.rglob('*')):raise ValueError('Vendor links are not portable')
 shutil.copytree(vendor,packet/'vendor/playwright-core')
 # Node ESM ignores NODE_PATH; preserve the existing small dependency closure locally.
 lock=json.loads(git('show',commit+':package-lock.json'))['packages'];vendor_versions={}
 for name in ['@elemaudio/core','invariant','shallowequal','loose-envify','js-tokens']:
  source=ROOT/'node_modules'/name
  for metadata in source.rglob('package.json'):
   relative=metadata.parent.relative_to(ROOT).as_posix();version=json.loads(metadata.read_text())['version']
   if lock.get(relative,{}).get('version')!=version:raise ValueError('Unpinned existing dependency: '+relative)
   vendor_versions[relative]=version
  if any(p.is_symlink() for p in source.rglob('*')):raise ValueError('Dependency links are not portable')
  shutil.copytree(source,packet/'automation/node_modules'/name)
 source_rows={};excluded={}
 for name in git('ls-tree','-r','--name-only',commit).decode().splitlines():
  body=git('show',commit+':'+name)
  if name.lower().endswith('.uf2'):excluded[name]=sha(body);continue
  if any(part in {'.git','node_modules','results'} for part in PurePosixPath(name).parts):raise ValueError('Unexpected source path')
  if re.search(rb'(github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)',body):raise ValueError('Potential credential: '+name)
  source_rows[name]=body
 source_manifest={'web_commit':commit,'files':{n:sha(b) for n,b in source_rows.items()},'excluded_uf2':excluded,'purpose':'Review/reproduce software in work-copy; internal firmware build/physical acceptance BLOCKED'}
 source_rows['source-manifest.json']=(json.dumps(source_manifest,indent=2)+'\n').encode()
 source_rows['SOURCE-START-HERE.md']=('Exact app '+commit+'; review-only export. All UF2 omitted; internal firmware build is BLOCKED. Embedded tools/windows-tester is historical at app commit; use the outer packet helper '+helper+' and CLAUDE.md for current field commands. Full npm gate is not a verified portable Windows route. Edit only a separate work-copy after preserving first failure.\n').encode()
 zip_bytes(packet/'source-review.zip',source_rows)
 (packet/'builds').mkdir()
 zip_bytes(packet/'builds'/('Biotron-Web-'+commit[:7]+'.zip'),{n:p.read_bytes() for n,p in files.items()})
 report='# Результат Biotron958\n\nWeb: '+commit+'\nHelper: '+helper+'\n\nКомпьютер/OS/browser: UNKNOWN\nUSB/adapter/audio/board/firmware: UNKNOWN\nТелефон/OS/MIDI-app/adapter: UNKNOWN\nTotal time/help/retries: UNKNOWN\n\n| Case / platform | Result | Expected / actual | Evidence | Backup / restore |\n| --- | --- | --- | --- | --- |\n'
 for i in range(1,18):report+=f'| W{i:02} | '+('BLOCKED' if i in [10,14] else 'NOT_RUN')+' | | | |\n'
 report+='\nКаждую phone/DAW/CapCut связку писать отдельно. Software PASS не physical acceptance. Первую ошибку и Retry не объединять. Перед передачей проверить screenshots/trace/console и исключить секреты.\n'
 write(packet/'reference/REPORT-TEMPLATE.md',report.encode())
 status={'web_commit':commit,'helper_commit':helper,'online_origin':args.online_origin,'previous_285_delivery':'https://t.me/c/1797899795/32656','previous_b15_delivery':'https://t.me/c/1797899795/32637','software_exact_gate':'PASS12Oct; original Settings reload5000ms causeUNKNOWN/OPEN','windows_phone_daw_hearing_capcut':'NOT_RUN_FOR_THIS_PACKAGE','owner_mobile':'NOT_RUN_FOR_EXACT958','firmware_physical_cycle':'BLOCKED','public_test_input':'1.8.2 official metadata12Oct10:57UTC; no install approval','customer_release':False,'automatic_upload':False,'sent':False}
 write(packet/'reference/ACCEPTANCE-STATUS.json',(json.dumps(status,ensure_ascii=False,indent=2)+'\n').encode())
 draft='Сергей @L_747, собрали один новый пакет для теста Biotron.\n\n'+args.online_origin+'/#/biotron/play?sound=1\n\nНачни с START-HERE.html: первый звук →Stop→Start. Для Claude есть исходники, точный билд и автоматические команды. Ночь не нужна; телефон отдельно. Прошивку пока не меняем.\n\nРезультат:958 · компьютер/телефон · Wxx · PASS/FAIL/NOT_RUN · наблюдение. Claude соберёт отчёт и логи командой tester.py bundle.\n\nDRAFT/NOT SENT; owner-mobile/scoped staff-send gate separate.\n'
 write(packet/'reference/SERGEY-MESSAGE-DRAFT.md',draft.encode())
 manifest={'schema':'biotron.field-test-packet.v2','web_commit':commit,'helper_commit':helper,'online_url':args.online_origin+'/#/biotron/play?sound=1','firmware_channel':'public-stable','firmware_version':'1.8.2','firmware_source_commit':None,'firmware_sha256':STABLE_SHA,'firmware_test_input_only':True,'runtime_release_sha256':sha((args.runtime/'release-evidence.json').read_bytes()),'source_sha256':source_hashes,'vendor_versions':vendor_versions,'physical_windows_result':'NOT_RUN','physical_phone_result':'NOT_RUN','customer_release':False,'automatic_upload':False,'files':{p.relative_to(packet).as_posix():sha(p.read_bytes()) for p in sorted(packet.rglob('*')) if p.is_file()}}
 write(packet/'packet-manifest.json',(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
 print(json.dumps({'packet':str(packet),'web_commit':commit,'helper_commit':helper,'payload_files':len(manifest['files']),'compiled_files':len(files),'excluded_internal_uf2':len(excluded),'manifest_sha256':sha((packet/'packet-manifest.json').read_bytes()),'sent':False}))

if __name__=='__main__':main()
