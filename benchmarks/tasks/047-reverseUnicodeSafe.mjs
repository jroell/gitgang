const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function reverseString(s){const seg=new Intl.Segmenter(\"en\",{granularity:\"grapheme\"});const parts=[];for(const x of seg.segment(s))parts.push(x.segment);return parts.reverse().join(\"\")}";
export default {
  id: "047-reverseUnicodeSafe",
  title: "reverseUnicodeSafe",
  category: "unicode",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export reverseString(s) that reverses by grapheme clusters (via Intl.Segmenter), so surrogate pairs and combining marks stay intact.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.reverseString("abc"),"cba");eq(m.reverseString("a😀b"),"b😀a");eq(m.reverseString(""),"");
  }
};
