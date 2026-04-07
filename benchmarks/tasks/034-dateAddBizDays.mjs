const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function addBusinessDays(iso,n){const d=new Date(iso+\"T00:00:00Z\");while(d.getUTCDay()===0||d.getUTCDay()===6)d.setUTCDate(d.getUTCDate()+1);let left=n;while(left>0){d.setUTCDate(d.getUTCDate()+1);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)left--}return d.toISOString().slice(0,10)}";
export default {
  id: "034-dateAddBizDays",
  title: "dateAddBizDays",
  category: "tricky-spec",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export addBusinessDays(dateIso: string, n: number): string. Skip Saturday and Sunday. If start is a weekend, normalize to next Monday before counting. Output ISO YYYY-MM-DD.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.addBusinessDays("2024-01-01",5),"2024-01-08");eq(m.addBusinessDays("2024-01-06",1),"2024-01-09");eq(m.addBusinessDays("2024-01-05",1),"2024-01-08");
  }
};
