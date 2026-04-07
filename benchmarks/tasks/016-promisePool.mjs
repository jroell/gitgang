const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export async function promisePool(tasks,limit){const out=new Array(tasks.length);let i=0,active=0,done=0,rejected=false,rejErr,resolveAll,rejectAll;return new Promise((res,rej)=>{resolveAll=res;rejectAll=rej;const run=()=>{if(rejected)return;while(active<limit&&i<tasks.length){const idx=i++;active++;Promise.resolve().then(()=>tasks[idx]()).then(v=>{out[idx]=v;active--;done++;if(done===tasks.length)res(out);else run()},e=>{if(!rejected){rejected=true;rej(e)}})}};if(!tasks.length)res([]);else run()})}";
export default {
  id: "016-promisePool",
  title: "promisePool",
  category: "concurrency",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export async function promisePool(tasks: Array<()=>Promise<T>>, limit: number): Promise<T[]>. Preserve input order in output. Run at most `limit` concurrently. If any task rejects, reject with the first rejection and stop starting new ones.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const d=(v,t)=>()=>new Promise(r=>setTimeout(()=>r(v),t));const r=await m.promisePool([d(1,10),d(2,5),d(3,1)],2);eq(r,[1,2,3]);const r2=await m.promisePool([],3);eq(r2,[]);let err=null;try{await m.promisePool([d(1,5),()=>Promise.reject(new Error("x")),d(3,5)],2)}catch(e){err=e}assert(err&&err.message==="x");
  }
};
