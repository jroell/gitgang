const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function topoSort(nodes,edges){const adj=new Map(nodes.map(n=>[n,[]]));const ind=new Map(nodes.map(n=>[n,0]));for(const[u,v]of edges){adj.get(u).push(v);ind.set(v,ind.get(v)+1)}const q=nodes.filter(n=>ind.get(n)===0);const out=[];while(q.length){const n=q.shift();out.push(n);for(const v of adj.get(n)){ind.set(v,ind.get(v)-1);if(ind.get(v)===0)q.push(v)}}if(out.length!==nodes.length)throw new Error(\"cycle\");return out}";
export default {
  id: "048-topologicalSort",
  title: "topologicalSort",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export topoSort(nodes: string[], edges: Array<[string,string]>): string[] giving a topological order (u before v for each edge [u,v]). Throw Error('cycle') on cycle. Nodes without edges keep input order where possible.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.topoSort(["a","b","c","d"],[["a","b"],["a","c"],["b","d"],["c","d"]]),["a","b","c","d"]);let t=false;try{m.topoSort(["a","b"],[["a","b"],["b","a"]])}catch{t=true}assert(t);
  }
};
