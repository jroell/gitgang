const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function constantTimeEqual(a,b){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}";
export default {
  id: "041-hmacLike",
  title: "hmacLike",
  category: "security",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export constantTimeEqual(a: string, b: string): boolean. Return false on length mismatch. Must avoid early-exit leaks (compare all bytes even on mismatch). Use charCodeAt XOR or Buffer.compare style.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    assert(m.constantTimeEqual("abc","abc"));assert(!m.constantTimeEqual("abc","abd"));assert(!m.constantTimeEqual("abc","ab"));assert(m.constantTimeEqual("",""));
  }
};
