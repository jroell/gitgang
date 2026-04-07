const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function medianOfTwoSorted(a,b){if(a.length>b.length)[a,b]=[b,a];const m=a.length,n=b.length,h=(m+n+1)>>1;let lo=0,hi=m;while(lo<=hi){const i=(lo+hi)>>1,j=h-i;const al=i===0?-Infinity:a[i-1];const ar=i===m?Infinity:a[i];const bl=j===0?-Infinity:b[j-1];const br=j===n?Infinity:b[j];if(al<=br&&bl<=ar){if((m+n)%2)return Math.max(al,bl);return(Math.max(al,bl)+Math.min(ar,br))/2}else if(al>br)hi=i-1;else lo=i+1}return 0}";
export default {
  id: "008-medianOfTwoSorted",
  title: "medianOfTwoSorted",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export medianOfTwoSorted(a,b): number. Must run in O(log(min(m,n))).",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.medianOfTwoSorted([1,3],[2]),2);eq(m.medianOfTwoSorted([1,2],[3,4]),2.5);eq(m.medianOfTwoSorted([],[1]),1);eq(m.medianOfTwoSorted([1,1,1],[1,1]),1);
  }
};
