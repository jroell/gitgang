const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function mergeIntervals(iv){if(!iv.length)return[];const s=iv.map(x=>x.slice()).sort((a,b)=>a[0]-b[0]);const r=[s[0]];for(let i=1;i<s.length;i++){if(s[i][0]<=r[r.length-1][1])r[r.length-1][1]=Math.max(r[r.length-1][1],s[i][1]);else r.push(s[i])}return r}";
export default {
  id: "035-mergeIntervals",
  title: "mergeIntervals",
  category: "tricky-spec",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export mergeIntervals(iv) merging overlapping/adjacent (touching) ranges. Input unordered.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.mergeIntervals([[1,3],[2,6],[8,10],[15,18]]),[[1,6],[8,10],[15,18]]);eq(m.mergeIntervals([[1,4],[4,5]]),[[1,5]]);eq(m.mergeIntervals([]),[]);
  }
};
