const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export class Trie{constructor(){this.r={c:{},w:false}}insert(w){let n=this.r;for(const ch of w){n.c[ch]=n.c[ch]||{c:{},w:false};n=n.c[ch]}n.w=true}complete(p){let n=this.r;for(const ch of p){if(!n.c[ch])return[];n=n.c[ch]}const out=[];const dfs=(node,s)=>{if(node.w)out.push(s);for(const ch of Object.keys(node.c).sort())dfs(node.c[ch],s+ch)};dfs(n,p);return out}}";
export default {
  id: "014-trieAutocomplete",
  title: "trieAutocomplete",
  category: "data-structures",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export class Trie with insert(word), complete(prefix) returning all stored words with that prefix, sorted ascending.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const t=new m.Trie();["apple","app","apt","bat"].forEach(w=>t.insert(w));eq(t.complete("ap"),["app","apple","apt"]);eq(t.complete("b"),["bat"]);eq(t.complete("z"),[]);
  }
};
