const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "export function minMeetingRooms(iv){if(!iv.length)return 0;const s=iv.map(x=>x[0]).sort((a,b)=>a-b);const e=iv.map(x=>x[1]).sort((a,b)=>a-b);let r=0,mx=0,j=0;for(let i=0;i<s.length;i++){if(s[i]<e[j])r++;else j++;mx=Math.max(mx,r)}return mx}";
export default {
  id: "004-minMeetingRooms",
  title: "minMeetingRooms",
  category: "algorithms",
  difficulty: "medium",
  expectedToStump: false,
  prompt: "Export minMeetingRooms(intervals: Array<[start,end]>): number giving minimum rooms needed. End is exclusive; a meeting ending at t does not conflict with one starting at t.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    eq(m.minMeetingRooms([[0,30],[5,10],[15,20]]),2);eq(m.minMeetingRooms([[7,10],[2,4]]),1);eq(m.minMeetingRooms([]),0);eq(m.minMeetingRooms([[1,5],[5,10]]),1);eq(m.minMeetingRooms([[1,5],[2,6],[3,7],[4,8]]),4);
  }
};
