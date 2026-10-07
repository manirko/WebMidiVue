from pathlib import Path
import json,hashlib,argparse,subprocess
root=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);args=p.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
sound=(root/'scripts/test-sound-elementary.js').read_text();preset=(root/'scripts/test-presets-idb.js').read_text()
def between(text,left,right):return text.split(left,1)[1].split(right,1)[0]
metric=between(sound,'const metrics = await page.evaluate(async () => {','    })\n\n    // Plant-note')
checks=between(sound,'    // Plant-note','    const {sounds, ...gates} = metrics');checks='// Plant-note'+checks
seed=between(preset,'const result = await page.evaluate(async () => {','    })\n    // A fresh')
cases=between(preset,'const cases = await page.evaluate(async ({dbName}) => {','    }, result)')
imports='\n'.join([f'import {{ElementarySynthEngine}} from {json.dumps(str(root/"src/audio/elementary/engine.mjs"))}',f'import {{SOUNDS}} from {json.dumps(str(root/"src/audio/elementary/timbres.mjs"))}',f'import {{BIOTRON_CALIBRATION}} from {json.dumps(str(root/"src/audio/biotronCalibration.mjs"))}',f'import {{Db, withPresetFeedback}} from {json.dumps(str(root/"src/assets/js/PresetsIDB.js"))}'])
entry=imports+'''\nwindow.__ElemEngine={ElementarySynthEngine,SOUNDS,BIOTRON_CALIBRATION};window.__Presets={Db,withPresetFeedback};
const assert=(value,message)=>{if(!value)throw new Error(message)};assert.strictEqual=(a,b,message)=>assert(a===b,message);
async function sound(){const metrics=await (async()=>{\n'''+metric+'\n})();\n'+checks+'''\nreturn metrics}
async function seed(){\n'''+seed+'\n}\nasync function cases({dbName}){\n'+cases+'''\n}
const result=document.getElementById('result');
const stage=document.getElementById('stage');
async function run(task,fn){stage.textContent=task+' RUNNING';try{const value=await fn();result.textContent=JSON.stringify({task,result:'PASS',value},null,2);stage.textContent=task+' PASS'}catch(error){result.textContent=JSON.stringify({task,result:'FAIL',error:String(error),stack:error.stack},null,2);stage.textContent=task+' FAIL'}}
document.getElementById('sound').onclick=()=>run('sound-levels',sound);
document.getElementById('seed').onclick=()=>run('preset-seed',async()=>{const value=await seed();sessionStorage.setItem('fixture',JSON.stringify(value));return value});
document.getElementById('cases').onclick=()=>run('preset-transactions',async()=>{const value=JSON.parse(sessionStorage.getItem('fixture')||'null');assert(value,'Seed first, then reload');return cases(value)});
'''
(out/'entry.mjs').write_text(entry)
(out/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Biotron browser regression bench</title><style>body{background:#f7f8fb;font:16px/1.6 system-ui;color:#111;margin:24px}header{background:linear-gradient(135deg,#5c6bc0,#3949ab);color:white;padding:24px;border-radius:12px}button{font:inherit;padding:16px;margin:16px 8px 16px 0;cursor:pointer;min-height:44px}button:hover{background:#e8edff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:24px;border-radius:12px}</style><header><h1>Browser regression bench</h1><p>Exact source test vectors. Offline audio rendering and isolated IndexedDB fixtures; no hardware commands.</p></header><button id="sound">Run sound levels</button><button id="seed">Seed preset fixture</button><button id="cases">Verify presets after reload</button><p id="stage" role="status">READY</p><pre id="result">Results appear here.</pre><script defer src="/bundle.js"></script></html>''')
(out/'build.cjs').write_text(f'''const webpack=require({json.dumps(str(root/'node_modules/webpack'))});webpack({{mode:'production',entry:{json.dumps(str(out/'entry.mjs'))},output:{{path:{json.dumps(str(out))},filename:'bundle.js',publicPath:'/'}},resolve:{{modules:[{json.dumps(str(root/'node_modules'))},'node_modules']}}}},(err,stats)=>{{if(err||stats.hasErrors()){{console.error(err||stats.toString({{all:false,errors:true}}));process.exitCode=1}}else console.log('Browser QA harness bundled')}});''')
(out/'source-manifest.json').write_text(json.dumps({'candidate':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'generated_from':{f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in ['scripts/test-sound-elementary.js','scripts/test-presets-idb.js','package-lock.json','src/assets/js/PresetsIDB.js']+[str(p.relative_to(root)) for p in (root/'src/audio').rglob('*.mjs')]},'method':'Exact page.evaluate test bodies extracted into explicit UI controls; no external browser launcher'},indent=2))
print(out)
