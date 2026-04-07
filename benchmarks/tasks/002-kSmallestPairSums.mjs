const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function kSmallestPairSums(a,b,k){if(!a.length||!b.length||k<=0)return[];const H=[];const push=(i,j)=>{H.push([a[i]+b[j],i,j]);let c=H.length-1;while(c>0){const p=(c-1)>>1;if(H[p][0]>H[c][0]||(H[p][0]===H[c][0]&&(H[p][1]>H[c][1]||(H[p][1]===H[c][1]&&H[p][2]>H[c][2])))){[H[p],H[c]]=[H[c],H[p]];c=p}else break}};const pop=()=>{const r=H[0];const e=H.pop();if(H.length){H[0]=e;let i=0;for(;;){const l=2*i+1,r2=2*i+2;let s=i;const cmp=(x,y)=>H[x][0]<H[y][0]||(H[x][0]===H[y][0]&&(H[x][1]<H[y][1]||(H[x][1]===H[y][1]&&H[x][2]<H[y][2])));if(l<H.length&&cmp(l,s))s=l;if(r2<H.length&&cmp(r2,s))s=r2;if(s!==i){[H[i],H[s]]=[H[s],H[i]];i=s}else break}}return r};const seen=new Set();const mark=(i,j)=>{seen.add(i*200003+j)};const has=(i,j)=>seen.has(i*200003+j);push(0,0);mark(0,0);const out=[];while(out.length<k&&H.length){const[,i,j]=pop();out.push([a[i],b[j]]);if(i+1<a.length&&!has(i+1,j)){mark(i+1,j);push(i+1,j)}if(j+1<b.length&&!has(i,j+1)){mark(i,j+1);push(i,j+1)}}return out}";
export default {
  id: "002-kSmallestPairSums",
  title: "kSmallestPairSums",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export kSmallestPairSums(a: number[], b: number[], k: number): Array<[number,number]>. Both arrays sorted ascending. Return k pairs (one from each) with smallest sums, in ascending sum order. Ties broken by a index, then b index. Must run well for k up to 10000 and arrays of 10000.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.kSmallestPairSums([1,7,11],[2,4,6],3),[[1,2],[1,4],[1,6]]);eq(m.kSmallestPairSums([1,1,2],[1,2,3],2),[[1,1],[1,1]]);eq(m.kSmallestPairSums([],[1],3),[]);eq(m.kSmallestPairSums([1,2],[3],3),[[1,3],[2,3]]);
  }
};
