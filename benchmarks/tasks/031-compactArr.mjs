const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function compact(a){return a.filter(x=>{if(x===null||x===undefined)return false;if(typeof x==='number'&&(x===0||Number.isNaN(x)))return false;if(x===false||x==='')return false;return true})}";
export default {
  id: "031-compactArr",
  title: "compactArr",
  category: "tricky-spec",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export compact(arr) that removes: null, undefined, NaN, '', 0, false — but KEEPS '0', 'false', and empty objects {}. Order preserved.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.compact([0,1,false,2,'',3,null,undefined,NaN,'0','false',{}]),[1,2,3,'0','false',{}]);
  }
};
