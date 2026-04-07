const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function wordLadderLength(b,e,w){const s=new Set(w);if(!s.has(e))return 0;const q=[[b,1]];const v=new Set([b]);while(q.length){const[c,d]=q.shift();if(c===e)return d;for(let i=0;i<c.length;i++){for(let k=97;k<123;k++){const n=c.slice(0,i)+String.fromCharCode(k)+c.slice(i+1);if(s.has(n)&&!v.has(n)){v.add(n);q.push([n,d+1])}}}}return 0}";
export default {
  id: "003-wordLadderLength",
  title: "wordLadderLength",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export wordLadderLength(begin, end, words) giving shortest transformation count (inclusive of start and end). Each step changes exactly one letter, intermediates must be in words. Return 0 if impossible.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.wordLadderLength("hit","cog",["hot","dot","dog","lot","log","cog"]),5);eq(m.wordLadderLength("hit","cog",["hot","dot","dog","lot","log"]),0);eq(m.wordLadderLength("a","c",["a","b","c"]),2);
  }
};
