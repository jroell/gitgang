const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function escapeHtml(s){return s.replace(/&/g,\"&amp;\").replace(/</g,\"&lt;\").replace(/>/g,\"&gt;\").replace(/\"/g,\"&quot;\").replace(/'/g,\"&#39;\")}";
export default {
  id: "042-sanitizeHtml",
  title: "sanitizeHtml",
  category: "security",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export escapeHtml(s). Replace & < > \" ' with their HTML entities in that order (& first to avoid double-escape).",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.escapeHtml("<b>\"Hi\" & 'bye'</b>"),"&lt;b&gt;&quot;Hi&quot; &amp; &#39;bye&#39;&lt;/b&gt;");eq(m.escapeHtml("&"),"&amp;");
  }
};
