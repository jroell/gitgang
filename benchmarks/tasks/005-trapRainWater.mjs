const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function trapRainWater(h){let l=0,r=h.length-1,lm=0,rm=0,t=0;while(l<r){if(h[l]<h[r]){if(h[l]>=lm)lm=h[l];else t+=lm-h[l];l++}else{if(h[r]>=rm)rm=h[r];else t+=rm-h[r];r--}}return t}";
export default {
  id: "005-trapRainWater",
  title: "trapRainWater",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export trapRainWater(h: number[]): number for standard 1D rain trapping. Must be O(n) time O(1) extra.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.trapRainWater([0,1,0,2,1,0,1,3,2,1,2,1]),6);eq(m.trapRainWater([4,2,0,3,2,5]),9);eq(m.trapRainWater([]),0);eq(m.trapRainWater([1,1,1]),0);
  }
};
