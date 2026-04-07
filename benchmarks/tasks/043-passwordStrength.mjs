const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function passwordStrength(p){if(p.length<8)return\"weak\";const l=/[a-z]/.test(p),u=/[A-Z]/.test(p),d=/\\d/.test(p),s=/[^a-zA-Z0-9]/.test(p);if(p.length>=12&&l&&u&&d&&s)return\"strong\";return\"medium\"}";
export default {
  id: "043-passwordStrength",
  title: "passwordStrength",
  category: "security",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export passwordStrength(pw): 'weak'|'medium'|'strong'. weak: <8 chars. strong: >=12 chars AND has lowercase AND uppercase AND digit AND symbol. otherwise medium.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.passwordStrength("abc"),"weak");eq(m.passwordStrength("abcdefgh"),"medium");eq(m.passwordStrength("Abcdefgh1!xY"),"strong");eq(m.passwordStrength("Abcdefgh1!"),"medium");
  }
};
