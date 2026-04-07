const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export class LRUCache{constructor(c){this.c=c;this.m=new Map()}get(k){if(!this.m.has(k))return undefined;const v=this.m.get(k);this.m.delete(k);this.m.set(k,v);return v}put(k,v){if(this.m.has(k))this.m.delete(k);this.m.set(k,v);if(this.m.size>this.c)this.m.delete(this.m.keys().next().value)}}";
export default {
  id: "011-lruCache",
  title: "lruCache",
  category: "data-structures",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export class LRUCache with constructor(capacity), get(key): V|undefined, put(key, value): void. O(1) per op; evict least recently used on overflow.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const c=new m.LRUCache(2);c.put(1,1);c.put(2,2);eq(c.get(1),1);c.put(3,3);eq(c.get(2),undefined);c.put(4,4);eq(c.get(1),undefined);eq(c.get(3),3);eq(c.get(4),4);
  }
};
