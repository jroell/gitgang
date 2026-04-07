const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function slugify(s){return s.normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g,\"\").toLowerCase().replace(/[^a-z0-9]+/g,\"-\").replace(/^-+|-+$/g,\"\")}";
export default {
  id: "046-slugify",
  title: "slugify",
  category: "unicode",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export slugify(s): lowercase, strip diacritics via NFD, replace non-alnum runs with '-', trim leading/trailing dashes.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.slugify("Héllo World!"),"hello-world");eq(m.slugify("  Ça va? "),"ca-va");eq(m.slugify("---"),"");
  }
};
