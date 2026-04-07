const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function matMul(A,B){const r=A.length,c=B[0].length,k=B.length;if(A[0].length!==k)throw new Error(\"shape\");const R=Array.from({length:r},()=>new Array(c).fill(0));for(let i=0;i<r;i++)for(let j=0;j<c;j++){let s=0;for(let t=0;t<k;t++)s+=A[i][t]*B[t][j];R[i][j]=s}return R}";
export default {
  id: "028-matMul",
  title: "matMul",
  category: "numerical",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export matMul(A,B): number[][]. Throw Error('shape') on mismatch.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.matMul([[1,2],[3,4]],[[5,6],[7,8]]),[[19,22],[43,50]]);let t=false;try{m.matMul([[1,2]],[[1,2]])}catch{t=true}assert(t);
  }
};
