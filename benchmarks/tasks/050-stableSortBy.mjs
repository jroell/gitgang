const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function stableSortBy(a,k){return a.map((v,i)=>[v,k(v),i]).sort((x,y)=>x[1]<y[1]?-1:x[1]>y[1]?1:x[2]-y[2]).map(x=>x[0])}";
export default {
  id: "050-stableSortBy",
  title: "stableSortBy",
  category: "algorithms",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export stableSortBy(arr, keyFn). Must be stable. Original array unchanged. Supports numeric and string keys.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const a=[{n:"b",i:1},{n:"a",i:2},{n:"b",i:3},{n:"a",i:4}];const s=m.stableSortBy(a,x=>x.n);eq(s.map(x=>x.i),[2,4,1,3]);eq(a.map(x=>x.i),[1,2,3,4]);
  }
};
