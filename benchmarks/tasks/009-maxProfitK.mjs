const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function maxProfitK(k,p){const n=p.length;if(!n||k<=0)return 0;if(k>=n>>1){let s=0;for(let i=1;i<n;i++)if(p[i]>p[i-1])s+=p[i]-p[i-1];return s}const buy=new Array(k+1).fill(-Infinity),sell=new Array(k+1).fill(0);for(const x of p){for(let j=1;j<=k;j++){buy[j]=Math.max(buy[j],sell[j-1]-x);sell[j]=Math.max(sell[j],buy[j]+x)}}return sell[k]}";
export default {
  id: "009-maxProfitK",
  title: "maxProfitK",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export maxProfitK(k: number, prices: number[]): number — at most k buy+sell transactions, no overlap.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.maxProfitK(2,[2,4,1]),2);eq(m.maxProfitK(2,[3,2,6,5,0,3]),7);eq(m.maxProfitK(0,[1,2,3]),0);eq(m.maxProfitK(100,[]),0);
  }
};
