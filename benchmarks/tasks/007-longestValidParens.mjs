const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function longestValidParens(s){let mx=0;const st=[-1];for(let i=0;i<s.length;i++){if(s[i]==='(')st.push(i);else{st.pop();if(!st.length)st.push(i);else mx=Math.max(mx,i-st[st.length-1])}}return mx}";
export default {
  id: "007-longestValidParens",
  title: "longestValidParens",
  category: "algorithms",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export longestValidParens(s: string): number — length of longest well-formed parentheses substring.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.longestValidParens("(()"),2);eq(m.longestValidParens(")()())"),4);eq(m.longestValidParens(""),0);eq(m.longestValidParens("()(()"),2);eq(m.longestValidParens("()(())"),6);
  }
};
