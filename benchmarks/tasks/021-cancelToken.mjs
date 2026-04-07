const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function makeCancelable(p){let c=false,res,rej;const wrapped=new Promise((r,j)=>{res=r;rej=j});p.then(v=>{if(!c)res(v)},e=>{if(!c)rej(e)});return{promise:wrapped,cancel(){if(!c){c=true;rej(new Error(\"canceled\"))}}}}";
export default {
  id: "021-cancelToken",
  title: "cancelToken",
  category: "concurrency",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export function makeCancelable(promise): { promise, cancel() }. Calling cancel before promise settles makes the returned promise reject with Error('canceled'). Cancel after settlement is a no-op.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const{promise,cancel}=m.makeCancelable(new Promise(r=>setTimeout(()=>r(1),50)));cancel();let err=null;try{await promise}catch(e){err=e}assert(err&&err.message==="canceled");const ok=m.makeCancelable(Promise.resolve(7));eq(await ok.promise,7);ok.cancel();
  }
};
