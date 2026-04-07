const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function sqrtNewton(x,eps=1e-10){if(x<0)throw new Error(\"neg\");if(x===0)return 0;let r=x;for(let i=0;i<100;i++){const n=(r+x/r)/2;if(Math.abs(n-r)<eps)return n;r=n}return r}";
export default {
  id: "027-sqrtNewton",
  title: "sqrtNewton",
  category: "numerical",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export sqrtNewton(x, eps=1e-10). Must reject negatives with Error. 0 -> 0.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    assert(Math.abs(m.sqrtNewton(4)-2)<1e-9);assert(Math.abs(m.sqrtNewton(2)-Math.SQRT2)<1e-9);eq(m.sqrtNewton(0),0);let t=false;try{m.sqrtNewton(-1)}catch{t=true}assert(t);
  }
};
