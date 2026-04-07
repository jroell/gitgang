const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function deepEqual(a,b){if(Object.is(a,b))return true;if(a===0&&b===0)return true;if(Number.isNaN(a)&&Number.isNaN(b))return true;if(typeof a!=='object'||typeof b!=='object'||!a||!b)return false;if(a instanceof Date)return b instanceof Date&&a.getTime()===b.getTime();if(a instanceof Map){if(!(b instanceof Map)||a.size!==b.size)return false;for(const[k,v]of a)if(!b.has(k)||!deepEqual(v,b.get(k)))return false;return true}if(a instanceof Set){if(!(b instanceof Set)||a.size!==b.size)return false;for(const v of a)if(!b.has(v))return false;return true}if(Array.isArray(a)){if(!Array.isArray(b)||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!deepEqual(a[i],b[i]))return false;return true}if(Array.isArray(b))return false;const ka=Object.keys(a),kb=Object.keys(b);if(ka.length!==kb.length)return false;for(const k of ka)if(!deepEqual(a[k],b[k]))return false;return true}";
export default {
  id: "032-deepEqual",
  title: "deepEqual",
  category: "tricky-spec",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export deepEqual(a,b). Compare primitives, arrays, plain objects, Maps, Sets, Dates. NaN equals NaN. +0 equals -0. Different types -> false.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    assert(m.deepEqual({a:[1,{b:2}]},{a:[1,{b:2}]}));assert(!m.deepEqual({a:1},{a:2}));assert(m.deepEqual(NaN,NaN));assert(m.deepEqual(0,-0));assert(m.deepEqual(new Date(1),new Date(1)));assert(!m.deepEqual([1,2],[1,2,3]));assert(m.deepEqual(new Map([[1,2]]),new Map([[1,2]])));
  }
};
