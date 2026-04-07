const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function graphemeCount(s){const seg=new Intl.Segmenter(\"en\",{granularity:\"grapheme\"});let n=0;for(const _ of seg.segment(s))n++;return n}";
export default {
  id: "045-graphemeCount",
  title: "graphemeCount",
  category: "unicode",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export graphemeCount(s) counting extended grapheme clusters using Intl.Segmenter.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.graphemeCount("hello"),5);eq(m.graphemeCount("👨‍👩‍👧"),1);eq(m.graphemeCount("a\u0301"),1);
  }
};
