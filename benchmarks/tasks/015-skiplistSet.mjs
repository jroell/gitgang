const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export class OrderedSet{constructor(){this.a=[]}_bs(x){let l=0,r=this.a.length;while(l<r){const m=(l+r)>>1;if(this.a[m]<x)l=m+1;else r=m}return l}has(x){const i=this._bs(x);return i<this.a.length&&this.a[i]===x}add(x){const i=this._bs(x);if(this.a[i]===x)return false;this.a.splice(i,0,x);return true}remove(x){const i=this._bs(x);if(this.a[i]!==x)return false;this.a.splice(i,1);return true}kth(i){return this.a[i]}}";
export default {
  id: "015-skiplistSet",
  title: "skiplistSet",
  category: "data-structures",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export class OrderedSet with add(x), has(x), remove(x), kth(i): returns i-th smallest (0-indexed) or undefined. Each op O(log n) average.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const s=new m.OrderedSet();[5,3,1,4,2].forEach(x=>s.add(x));eq(s.kth(0),1);eq(s.kth(4),5);assert(s.has(3));s.remove(3);assert(!s.has(3));eq(s.kth(2),4);
  }
};
