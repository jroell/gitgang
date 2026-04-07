const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function nQueensCount(n){let c=0;const col=new Set(),d1=new Set(),d2=new Set();function r(i){if(i===n){c++;return}for(let j=0;j<n;j++){if(col.has(j)||d1.has(i-j)||d2.has(i+j))continue;col.add(j);d1.add(i-j);d2.add(i+j);r(i+1);col.delete(j);d1.delete(i-j);d2.delete(i+j)}}r(0);return c}";
export default {
  id: "010-nQueensCount",
  title: "nQueensCount",
  category: "algorithms",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export nQueensCount(n: number): number distinct solutions to the n-queens problem.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.nQueensCount(1),1);eq(m.nQueensCount(4),2);eq(m.nQueensCount(5),10);eq(m.nQueensCount(8),92);eq(m.nQueensCount(2),0);
  }
};
