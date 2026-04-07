const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function debounceAsync(fn,ms){let t=null,wait=null;return function(...args){if(!wait)wait={promise:null,resolve:null,reject:null},wait.promise=new Promise((r,j)=>{wait.resolve=r;wait.reject=j});if(t)clearTimeout(t);t=setTimeout(()=>{const w=wait;wait=null;t=null;Promise.resolve().then(()=>fn.apply(this,args)).then(w.resolve,w.reject)},ms);return wait.promise}}";
export default {
  id: "017-debounceAsync",
  title: "debounceAsync",
  category: "concurrency",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export debounceAsync(fn, ms) returning a function. Multiple rapid calls coalesce: only the LAST call's arguments run after ms of quiet. All callers in the same burst receive the SAME resolved value (or rejection).",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    let n=0;const f=m.debounceAsync(x=>{n++;return x*2},10);const p1=f(1),p2=f(2),p3=f(3);const[a,b,c]=await Promise.all([p1,p2,p3]);eq(n,1);eq(a,6);eq(b,6);eq(c,6);
  }
};
