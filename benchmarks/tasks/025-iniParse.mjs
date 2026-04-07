const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function parseIni(t){const r={_default:{}};let cur=\"_default\";for(const raw of t.split(/\\r?\\n/)){const l=raw.trim();if(!l||l[0]===';'||l[0]==='#')continue;if(l[0]==='['&&l.endsWith(']')){cur=l.slice(1,-1).trim();if(!r[cur])r[cur]={};continue}const eq=l.indexOf('=');if(eq<0)continue;const k=l.slice(0,eq).trim();const v=l.slice(eq+1).trim();r[cur][k]=v}return r}";
export default {
  id: "025-iniParse",
  title: "iniParse",
  category: "parsers",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export parseIni(text): Record<string, Record<string,string>>. Sections are [name]. key=value. Lines starting with ; or # are comments. Trim whitespace. Values before any section go under '_default'.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const r=m.parseIni("; comment\nfoo=bar\n[s1]\na=1\nb = two\n[s2]\nk=v");eq(r._default.foo,"bar");eq(r.s1.a,"1");eq(r.s1.b,"two");eq(r.s2.k,"v");
  }
};
