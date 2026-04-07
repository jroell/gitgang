const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export class AsyncQueue{constructor(){this.v=[];this.w=[]}push(x){if(this.w.length)this.w.shift()(x);else this.v.push(x)}pop(){if(this.v.length)return Promise.resolve(this.v.shift());return new Promise(r=>this.w.push(r))}}";
export default {
  id: "020-asyncQueue",
  title: "asyncQueue",
  category: "concurrency",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export class AsyncQueue<T> with push(v) and pop(): Promise<T>. FIFO. pop before push awaits until a value arrives.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const q=new m.AsyncQueue();q.push(1);q.push(2);eq(await q.pop(),1);eq(await q.pop(),2);const p=q.pop();q.push(3);eq(await p,3);
  }
};
