const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function primesUpTo(n){if(n<2)return[];const s=new Uint8Array(n+1);const r=[];for(let i=2;i<=n;i++){if(!s[i]){r.push(i);for(let j=i*i;j<=n;j+=i)s[j]=1}}return r}";
export default {
  id: "030-primeSieve",
  title: "primeSieve",
  category: "numerical",
  difficulty: "easy",
  expectedToStump: false,
  prompt: "Export primesUpTo(n): number[] using sieve of eratosthenes.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.primesUpTo(1),[]);eq(m.primesUpTo(10),[2,3,5,7]);eq(m.primesUpTo(30).length,10);
  }
};
