const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function flattenDeep(a){const r=[];for(const x of a){if(Array.isArray(x))r.push(...flattenDeep(x));else r.push(x)}return r}";
export default {
  id: "039-flattenDeep",
  title: "flattenDeep",
  category: "refactor",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export flattenDeep(arr). Recursively flatten nested arrays (arbitrary depth). Non-array values kept as-is.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.flattenDeep([1,[2,[3,[4,[5]]]]]),[1,2,3,4,5]);eq(m.flattenDeep([]),[]);eq(m.flattenDeep([[],[[]]]),[]);
  }
};
