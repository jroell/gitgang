const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function longestZigzag(a){if(!a.length)return 0;let up=1,dn=1,best=1;for(let i=1;i<a.length;i++){if(a[i]>a[i-1]){up=dn+1;dn=1}else if(a[i]<a[i-1]){dn=up+1;up=1}else{up=1;dn=1}best=Math.max(best,up,dn)}return best}";
export default {
  id: "001-longestZigzag",
  title: "longestZigzag",
  category: "algorithms",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export function longestZigzag(arr: number[]): number returning length of longest strictly alternating (up-down or down-up) contiguous subsequence. Single element => 1. Equal adjacents break the zigzag.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.longestZigzag([1,7,4,9,2,5]),6);eq(m.longestZigzag([1,2,3,4]),2);eq(m.longestZigzag([5]),1);eq(m.longestZigzag([]),0);eq(m.longestZigzag([2,2,2]),1);eq(m.longestZigzag([1,3,2,2,5]),3);
  }
};
