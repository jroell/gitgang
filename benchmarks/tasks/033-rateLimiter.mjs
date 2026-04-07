const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export class RateLimiter{constructor(mx,w,now=()=>Date.now()){this.mx=mx;this.w=w;this.now=now;this.h=[]}tryAcquire(){const t=this.now();while(this.h.length&&this.h[0]<=t-this.w)this.h.shift();if(this.h.length>=this.mx)return false;this.h.push(t);return true}}";
export default {
  id: "033-rateLimiter",
  title: "rateLimiter",
  category: "tricky-spec",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export class RateLimiter(maxCalls, windowMs, nowFn=()=>Date.now()). tryAcquire() returns true if calls in trailing windowMs <= maxCalls-1 (and records this call), else false. Old calls are forgotten.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    let t=0;const r=new m.RateLimiter(2,10,()=>t);assert(r.tryAcquire());assert(r.tryAcquire());assert(!r.tryAcquire());t=11;assert(r.tryAcquire());assert(r.tryAcquire());assert(!r.tryAcquire());
  }
};
