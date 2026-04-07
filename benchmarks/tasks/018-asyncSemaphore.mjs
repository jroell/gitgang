const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export class Semaphore{constructor(n){this.c=n;this.q=[]}acquire(){return new Promise(res=>{const g=()=>{this.c--;res(()=>{this.c++;if(this.q.length)this.q.shift()()})};if(this.c>0)g();else this.q.push(g)})}}";
export default {
  id: "018-asyncSemaphore",
  title: "asyncSemaphore",
  category: "concurrency",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export class Semaphore(n) with acquire(): Promise<()=>void> returning a release fn. Pending acquires resolve in FIFO order as releases occur.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const s=new m.Semaphore(2);const order=[];const task=async id=>{const rel=await s.acquire();order.push("s"+id);await new Promise(r=>setTimeout(r,5));order.push("e"+id);rel()};await Promise.all([task(1),task(2),task(3),task(4)]);eq(order.slice(0,2).sort(),["s1","s2"]);assert(order.includes("e4"));
  }
};
