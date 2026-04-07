const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function groupBy(a,k){const r={};for(const x of a){const g=k(x);(r[g]=r[g]||[]).push(x)}return r}";
export default {
  id: "036-groupBy",
  title: "groupBy",
  category: "refactor",
  difficulty: "easy",
  expectedToStump: false,
  prompt: "Export groupBy(arr, keyFn). Return Record<string, T[]>. Preserve order within groups.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.groupBy([1,2,3,4,5],x=>x%2?"odd":"even"),{odd:[1,3,5],even:[2,4]});
  }
};
