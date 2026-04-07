const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function memoize(f,k=(...a)=>JSON.stringify(a)){const c=new Map();return function(...a){const key=k(...a);if(c.has(key))return c.get(key);const v=f.apply(this,a);c.set(key,v);return v}}";
export default {
  id: "040-memoize",
  title: "memoize",
  category: "refactor",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export memoize(fn, keyFn=(...a)=>JSON.stringify(a)). Cached results returned; pending promises NOT required.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    let n=0;const f=m.memoize(x=>{n++;return x*2});eq(f(3),6);eq(f(3),6);eq(n,1);eq(f(4),8);eq(n,2);
  }
};
