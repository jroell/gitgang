const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function semverCmp(a,b){const p=v=>{const[m,pre]=v.split('-');return[m.split('.').map(Number),pre?pre.split('.'):[]]};const[am,ap]=p(a),[bm,bp]=p(b);for(let i=0;i<3;i++){if(am[i]!==bm[i])return am[i]<bm[i]?-1:1}if(!ap.length&&!bp.length)return 0;if(!ap.length)return 1;if(!bp.length)return-1;const n=Math.min(ap.length,bp.length);for(let i=0;i<n;i++){const x=ap[i],y=bp[i];const xn=/^\\d+$/.test(x),yn=/^\\d+$/.test(y);if(xn&&yn){const a=+x,b=+y;if(a!==b)return a<b?-1:1}else if(xn)return-1;else if(yn)return 1;else if(x!==y)return x<y?-1:1}return ap.length===bp.length?0:ap.length<bp.length?-1:1}";
export default {
  id: "026-semverCmp",
  title: "semverCmp",
  category: "parsers",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export semverCmp(a, b): -1|0|1. Follow semver 2.0.0: prerelease identifiers compared left-to-right, numeric lt alpha, shorter prerelease list lt longer.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.semverCmp("1.0.0","1.0.0"),0);eq(m.semverCmp("1.0.0","2.0.0"),-1);eq(m.semverCmp("1.0.0-alpha","1.0.0"),-1);eq(m.semverCmp("1.0.0-alpha","1.0.0-beta"),-1);eq(m.semverCmp("1.0.0-alpha.1","1.0.0-alpha"),1);eq(m.semverCmp("1.0.0-1","1.0.0-alpha"),-1);
  }
};
