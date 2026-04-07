const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function factorial(n){if(n<0)throw new Error(\"neg\");let r=1n;for(let i=2;i<=n;i++)r*=BigInt(i);return r}";
export default {
  id: "029-bigIntFactorial",
  title: "bigIntFactorial",
  category: "numerical",
  difficulty: "easy",
  expectedToStump: false,
  prompt: "Export factorial(n: number): bigint. n<0 throws. Must handle n up to 100.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.factorial(0).toString(),"1");eq(m.factorial(5).toString(),"120");eq(m.factorial(20).toString(),"2432902008176640000");
  }
};
