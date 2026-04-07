const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export class UnionFind{constructor(n){this.p=Array.from({length:n},(_,i)=>i);this.r=new Array(n).fill(0);this.n=n}find(x){while(this.p[x]!==x){this.p[x]=this.p[this.p[x]];x=this.p[x]}return x}union(a,b){const x=this.find(a),y=this.find(b);if(x===y)return false;if(this.r[x]<this.r[y])this.p[x]=y;else if(this.r[x]>this.r[y])this.p[y]=x;else{this.p[y]=x;this.r[x]++}this.n--;return true}connected(a,b){return this.find(a)===this.find(b)}count(){return this.n}}";
export default {
  id: "013-unionFind",
  title: "unionFind",
  category: "data-structures",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export class UnionFind(n) with union(a,b), find(a), connected(a,b), count() returning component count. Use path compression and union by rank.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const u=new m.UnionFind(5);eq(u.count(),5);u.union(0,1);u.union(2,3);eq(u.count(),3);assert(u.connected(0,1));assert(!u.connected(0,2));u.union(1,2);assert(u.connected(0,3));eq(u.count(),2);
  }
};
