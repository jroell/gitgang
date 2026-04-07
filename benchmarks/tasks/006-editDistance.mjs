const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function editDistance(a,b){const m=a.length,n=b.length;let p=Array.from({length:n+1},(_,i)=>i);for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c.push(a[i-1]===b[j-1]?p[j-1]:1+Math.min(p[j-1],p[j],c[j-1]));p=c}return p[n]}";
export default {
  id: "006-editDistance",
  title: "editDistance",
  category: "algorithms",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export editDistance(a,b): number (Levenshtein).",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.editDistance("kitten","sitting"),3);eq(m.editDistance("","abc"),3);eq(m.editDistance("abc",""),3);eq(m.editDistance("same","same"),0);eq(m.editDistance("intention","execution"),5);
  }
};
