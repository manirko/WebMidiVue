export const values = [78,3,4,4,50,10,0,4,8,98,74,75,0,1,0,12,0,0,1,1,0,1,60,2,3,100,0];
export const response = (nonce = 42, vector = values, flags = 1) => [240,20,13,123,1,1,1,nonce,flags,7,0,0,0,0,7,0,0,0,0,...vector,247];
export const memory = () => {
  const data = new Map(); return {data, getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,String(value))};
};
export const deferred = () => {let resolve,reject; const promise = new Promise((yes,no) => {resolve = yes; reject = no;}); return {promise,resolve,reject};};
export class Port extends EventTarget {
  constructor(id, name, type = 'input') {super(); Object.assign(this,{id,name,type,manufacturer:'Playtronica',state:'connected',connection:'closed',opens:0,closes:0,sent:[]});}
  async open() {this.opens++; this.connection = 'open'; return this;}
  async close() {this.closes++; this.connection = 'closed'; return this;}
  send(data) {this.sent.push(Array.from(data));}
  receive(data) {const event = new Event('midimessage'); event.data = data; this.dispatchEvent(event);}
}
export class Access extends EventTarget {
  constructor(inputs, outputs) {super(); this.inputs = new Map(inputs.map(p => [p.id,p])); this.outputs = new Map(outputs.map(p => [p.id,p]));}
  change(port) {const event = new Event('statechange'); event.port = port; this.dispatchEvent(event);}
}
export const turn = () => new Promise(resolve => setImmediate(resolve));
