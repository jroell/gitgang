const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function zip(...as){if(!as.length)return[];const n=Math.min(...as.map(a=>a.length));return Array.from({length:n},(_,i)=>as.map(a=>a[i]))}";
export default {
  id: "038-zip",
  title: "zip",
  category: "refactor",
  difficulty: "easy",
  expectedToStump: false,
  prompt: "Export zip(...arrays). Stops at shortest.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.zip([1,2,3],['a','b','c']),[[1,'a'],[2,'b'],[3,'c']]);eq(m.zip([1,2],[3,4,5]),[[1,3],[2,4]]);eq(m.zip(),[]);
  }
};
