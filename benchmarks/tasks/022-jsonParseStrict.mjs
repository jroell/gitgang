const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function parseJsonStrict(s){let i=0;const ws=()=>{while(i<s.length&&/\\s/.test(s[i]))i++};const err=m=>{throw new SyntaxError(m)};function val(){ws();const c=s[i];if(c==='{')return obj();if(c==='[')return arr();if(c==='\"')return str();if(c==='t'||c==='f')return bool();if(c==='n')return nul();return num()}function obj(){i++;ws();const o={};if(s[i]==='}'){i++;return o}while(true){ws();if(s[i]!=='\"')err(\"key\");const k=str();ws();if(s[i]!==':')err(\":\");i++;o[k]=val();ws();if(s[i]===','){i++;ws();if(s[i]==='}')err(\"trailing\");}else if(s[i]==='}'){i++;return o}else err(\"expect , or }\")}}function arr(){i++;ws();const a=[];if(s[i]===']'){i++;return a}while(true){a.push(val());ws();if(s[i]===','){i++;ws();if(s[i]===']')err(\"trailing\")}else if(s[i]===']'){i++;return a}else err(\"expect , or ]\")}}function str(){i++;let r=\"\";while(i<s.length&&s[i]!=='\"'){if(s[i]==='\\\\'){i++;const e=s[i++];if(e==='n')r+='\\n';else if(e==='t')r+='\\t';else if(e==='\"')r+='\"';else if(e==='\\\\')r+='\\\\';else if(e==='u'){r+=String.fromCharCode(parseInt(s.slice(i,i+4),16));i+=4}else err(\"esc\")}else r+=s[i++]}if(s[i]!=='\"')err(\"unterm\");i++;return r}function num(){const st=i;if(s[i]==='-')i++;while(i<s.length&&/[0-9.eE+-]/.test(s[i]))i++;const n=Number(s.slice(st,i));if(Number.isNaN(n))err(\"num\");return n}function bool(){if(s.slice(i,i+4)==='true'){i+=4;return true}if(s.slice(i,i+5)==='false'){i+=5;return false}err(\"bool\")}function nul(){if(s.slice(i,i+4)==='null'){i+=4;return null}err(\"null\")}const r=val();ws();if(i<s.length)err(\"trailing\");return r}";
export default {
  id: "022-jsonParseStrict",
  title: "jsonParseStrict",
  category: "parsers",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export parseJsonStrict(s) supporting objects, arrays, strings (with \\n \\t \\\" \\\\ \\u escapes), numbers, true/false/null. Throw SyntaxError on trailing chars, trailing commas, or unquoted keys.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.parseJsonStrict('{"a":1,"b":[true,null,"x"]}'),{a:1,b:[true,null,"x"]});eq(m.parseJsonStrict('"hi\\nthere"'),"hi\nthere");let t=false;try{m.parseJsonStrict('{a:1}')}catch{t=true}assert(t);let t2=false;try{m.parseJsonStrict('[1,2,]')}catch{t2=true}assert(t2);let t3=false;try{m.parseJsonStrict('{"a":1} junk')}catch{t3=true}assert(t3);
  }
};
