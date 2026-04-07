const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function evalExpr(s){let i=0;const skip=()=>{while(s[i]===' ')i++};function expr(){let v=term();skip();while(s[i]==='+'||s[i]==='-'){const op=s[i++];const r=term();v=op==='+'?v+r:v-r;skip()}return v}function term(){let v=unary();skip();while(s[i]==='*'||s[i]==='/'){const op=s[i++];const r=unary();v=op==='*'?v*r:v/r;skip()}return v}function unary(){skip();if(s[i]==='-'){i++;return-unary()}if(s[i]==='+'){i++;return unary()}return primary()}function primary(){skip();if(s[i]==='('){i++;const v=expr();skip();i++;return v}const st=i;while(i<s.length&&/[0-9.]/.test(s[i]))i++;return Number(s.slice(st,i))}return expr()}";
export default {
  id: "024-exprEval",
  title: "exprEval",
  category: "parsers",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export evalExpr(s: string): number supporting + - * / parentheses and unary minus with correct precedence. Integers and decimals. Whitespace ignored.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.evalExpr("1+2*3"),7);eq(m.evalExpr("(1+2)*3"),9);eq(m.evalExpr("-2+-3"),-5);eq(m.evalExpr("10/4"),2.5);eq(m.evalExpr("2*(3+4)-1"),13);
  }
};
