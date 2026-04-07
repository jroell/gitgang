const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};
const solution = "class H{constructor(cmp){this.a=[];this.cmp=cmp}size(){return this.a.length}peek(){return this.a[0]}push(x){this.a.push(x);let i=this.a.length-1;while(i>0){const p=(i-1)>>1;if(this.cmp(this.a[i],this.a[p])<0){[this.a[i],this.a[p]]=[this.a[p],this.a[i]];i=p}else break}}pop(){const r=this.a[0],e=this.a.pop();if(this.a.length){this.a[0]=e;let i=0;for(;;){const l=2*i+1,r2=2*i+2;let s=i;if(l<this.a.length&&this.cmp(this.a[l],this.a[s])<0)s=l;if(r2<this.a.length&&this.cmp(this.a[r2],this.a[s])<0)s=r2;if(s!==i){[this.a[i],this.a[s]]=[this.a[s],this.a[i]];i=s}else break}}return r}}export class MedianStream{constructor(){this.lo=new H((a,b)=>b-a);this.hi=new H((a,b)=>a-b)}add(x){this.lo.push(x);this.hi.push(this.lo.pop());if(this.hi.size()>this.lo.size())this.lo.push(this.hi.pop())}median(){if(!this.lo.size())return NaN;if(this.lo.size()>this.hi.size())return this.lo.peek();return(this.lo.peek()+this.hi.peek())/2}}";
export default {
  id: "012-medianStream",
  title: "medianStream",
  category: "data-structures",
  difficulty: "hard",
  expectedToStump: true,
  prompt: "Export class MedianStream with add(x): void and median(): number. Must run in O(log n) per add and O(1) per median.",
  starterFiles: { "solution.mjs": "// TODO: implement\nexport {};\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    const s=new m.MedianStream();s.add(1);eq(s.median(),1);s.add(2);eq(s.median(),1.5);s.add(3);eq(s.median(),2);s.add(4);eq(s.median(),2.5);s.add(5);eq(s.median(),3);
  }
};
