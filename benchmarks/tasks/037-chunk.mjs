const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function chunk(a,s){if(s<=0)throw new Error(\"size\");const r=[];for(let i=0;i<a.length;i+=s)r.push(a.slice(i,i+s));return r}";
export default {
  id: "037-chunk",
  title: "chunk",
  category: "refactor",
  difficulty: "easy",
  expectedToStump: false,
  prompt: "Export chunk(arr, size). Size<=0 throws. Last chunk may be shorter.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.chunk([1,2,3,4,5],2),[[1,2],[3,4],[5]]);eq(m.chunk([],3),[]);let t=false;try{m.chunk([1],0)}catch{t=true}assert(t);
  }
};
