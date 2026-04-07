const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function diffLines(a,b){const m=a.length,n=b.length;const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);const out=[];let i=m,j=n;while(i>0&&j>0){if(a[i-1]===b[j-1]){out.push({op:\"=\",line:a[i-1]});i--;j--}else if(dp[i-1][j]>=dp[i][j-1]){out.push({op:\"-\",line:a[i-1]});i--}else{out.push({op:\"+\",line:b[j-1]});j--}}while(i>0){out.push({op:\"-\",line:a[i-1]});i--}while(j>0){out.push({op:\"+\",line:b[j-1]});j--}return out.reverse()}";
export default {
  id: "049-diffLines",
  title: "diffLines",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export diffLines(a: string[], b: string[]): Array<{op:'=' |'+' |'-', line:string}>. Use LCS. '-' lines come before '+' when both at same LCS boundary.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const d=m.diffLines(["a","b","c"],["a","x","c"]);eq(d.filter(x=>x.op==="=").length,2);eq(d.filter(x=>x.op==="-").map(x=>x.line),["b"]);eq(d.filter(x=>x.op==="+").map(x=>x.line),["x"]);
  }
};
