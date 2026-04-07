const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export async function retryBackoff(fn,{retries,baseMs,factor}){let lastErr;for(let i=0;i<=retries;i++){try{return await fn()}catch(e){lastErr=e;if(i<retries)await new Promise(r=>setTimeout(r,baseMs*Math.pow(factor,i)))}}throw lastErr}";
export default {
  id: "019-retryBackoff",
  title: "retryBackoff",
  category: "concurrency",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export async retryBackoff(fn, {retries, baseMs, factor}) that retries fn() on rejection, waiting baseMs * factor^attempt before each retry. Resolves with fn's value on first success, rejects with the LAST error after exhausting retries. If retries=0, attempt once.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    let n=0;const ok=await m.retryBackoff(async()=>{n++;if(n<3)throw new Error("x");return 42},{retries:5,baseMs:1,factor:1});eq(ok,42);eq(n,3);let err=null;try{await m.retryBackoff(async()=>{throw new Error("fail")},{retries:2,baseMs:1,factor:1})}catch(e){err=e}assert(err&&err.message==="fail");
  }
};
