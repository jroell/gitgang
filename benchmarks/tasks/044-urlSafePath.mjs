const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "import path from \"node:path\";export function safeJoin(b,u){if(u.includes(\"\\0\"))throw new Error(\"unsafe\");if(path.isAbsolute(u))throw new Error(\"unsafe\");const joined=path.posix.normalize(path.posix.join(b,u));const base=path.posix.normalize(b.endsWith(\"/\")?b:b+\"/\");if(!(joined+\"/\").startsWith(base))throw new Error(\"unsafe\");return joined}";
export default {
  id: "044-urlSafePath",
  title: "urlSafePath",
  category: "security",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export safeJoin(base, user): string that joins base with a user-supplied relative path, rejecting any path that would escape base (via .., absolute, or null bytes) with Error('unsafe'). Returns posix-style joined path.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.safeJoin("/var/data","foo/bar.txt"),"/var/data/foo/bar.txt");let t=false;try{m.safeJoin("/var/data","../etc/passwd")}catch{t=true}assert(t);let t2=false;try{m.safeJoin("/var/data","/etc/passwd")}catch{t2=true}assert(t2);
  }
};
