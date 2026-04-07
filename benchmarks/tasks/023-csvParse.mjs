const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function parseCsv(t){const rows=[[\"\"]];let i=0,q=false;while(i<t.length){const c=t[i];if(q){if(c==='\"'){if(t[i+1]==='\"'){rows[rows.length-1][rows[rows.length-1].length-1]+='\"';i+=2;continue}q=false;i++;continue}rows[rows.length-1][rows[rows.length-1].length-1]+=c;i++}else{if(c==='\"'){q=true;i++}else if(c===','){rows[rows.length-1].push(\"\");i++}else if(c==='\\n'){rows.push([\"\"]);i++}else if(c==='\\r'){i++}else{rows[rows.length-1][rows[rows.length-1].length-1]+=c;i++}}}if(rows.length&&rows[rows.length-1].length===1&&rows[rows.length-1][0]===\"\")rows.pop();return rows}";
export default {
  id: "023-csvParse",
  title: "csvParse",
  category: "parsers",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export parseCsv(text): string[][]. Support quoted fields with escaped double-quotes (\"\") and embedded commas/newlines. No header handling.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.parseCsv('a,b,c\n1,2,3'),[["a","b","c"],["1","2","3"]]);eq(m.parseCsv('"hello, world","line\nbreak","q""q"'),[["hello, world","line\nbreak",'q"q']]);eq(m.parseCsv(''),[]);
  }
};
