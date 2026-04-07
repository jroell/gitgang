#!/usr/bin/env node
// Generator that writes 50 benchmark task files with verified reference solutions.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tasksDir = join(here, "..", "tasks");
mkdirSync(tasksDir, { recursive: true });

const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg||"eq fail")+`: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

// Each task: { id, title, category, difficulty, expectedToStump, prompt, solution, verify }
// We wrap verify + solution into the .mjs file on disk.
const tasks = [];

function T(o) { tasks.push(o); }

// -------- 1..10 algorithms --------
T({ id: "001", title: "longestZigzag", cat: "algorithms", diff: "medium", stump: false,
  prompt: "Export function longestZigzag(arr: number[]): number returning length of longest strictly alternating (up-down or down-up) contiguous subsequence. Single element => 1. Equal adjacents break the zigzag.",
  sol: `export function longestZigzag(a){if(!a.length)return 0;let up=1,dn=1,best=1;for(let i=1;i<a.length;i++){if(a[i]>a[i-1]){up=dn+1;dn=1}else if(a[i]<a[i-1]){dn=up+1;up=1}else{up=1;dn=1}best=Math.max(best,up,dn)}return best}`,
  verify: `eq(m.longestZigzag([1,7,4,9,2,5]),6);eq(m.longestZigzag([1,2,3,4]),2);eq(m.longestZigzag([5]),1);eq(m.longestZigzag([]),0);eq(m.longestZigzag([2,2,2]),1);eq(m.longestZigzag([1,3,2,2,5]),3);` });

T({ id: "002", title: "kSmallestPairSums", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export kSmallestPairSums(a: number[], b: number[], k: number): Array<[number,number]>. Both arrays sorted ascending. Return k pairs (one from each) with smallest sums, in ascending sum order. Ties broken by a index, then b index. Must run well for k up to 10000 and arrays of 10000.",
  sol: `export function kSmallestPairSums(a,b,k){if(!a.length||!b.length||k<=0)return[];const H=[];const push=(i,j)=>{H.push([a[i]+b[j],i,j]);let c=H.length-1;while(c>0){const p=(c-1)>>1;if(H[p][0]>H[c][0]||(H[p][0]===H[c][0]&&(H[p][1]>H[c][1]||(H[p][1]===H[c][1]&&H[p][2]>H[c][2])))){[H[p],H[c]]=[H[c],H[p]];c=p}else break}};const pop=()=>{const r=H[0];const e=H.pop();if(H.length){H[0]=e;let i=0;for(;;){const l=2*i+1,r2=2*i+2;let s=i;const cmp=(x,y)=>H[x][0]<H[y][0]||(H[x][0]===H[y][0]&&(H[x][1]<H[y][1]||(H[x][1]===H[y][1]&&H[x][2]<H[y][2])));if(l<H.length&&cmp(l,s))s=l;if(r2<H.length&&cmp(r2,s))s=r2;if(s!==i){[H[i],H[s]]=[H[s],H[i]];i=s}else break}}return r};const seen=new Set();const mark=(i,j)=>{seen.add(i*200003+j)};const has=(i,j)=>seen.has(i*200003+j);push(0,0);mark(0,0);const out=[];while(out.length<k&&H.length){const[,i,j]=pop();out.push([a[i],b[j]]);if(i+1<a.length&&!has(i+1,j)){mark(i+1,j);push(i+1,j)}if(j+1<b.length&&!has(i,j+1)){mark(i,j+1);push(i,j+1)}}return out}`,
  verify: `eq(m.kSmallestPairSums([1,7,11],[2,4,6],3),[[1,2],[1,4],[1,6]]);eq(m.kSmallestPairSums([1,1,2],[1,2,3],2),[[1,1],[1,1]]);eq(m.kSmallestPairSums([],[1],3),[]);eq(m.kSmallestPairSums([1,2],[3],3),[[1,3],[2,3]]);` });

T({ id: "003", title: "wordLadderLength", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export wordLadderLength(begin, end, words) giving shortest transformation count (inclusive of start and end). Each step changes exactly one letter, intermediates must be in words. Return 0 if impossible.",
  sol: `export function wordLadderLength(b,e,w){const s=new Set(w);if(!s.has(e))return 0;const q=[[b,1]];const v=new Set([b]);while(q.length){const[c,d]=q.shift();if(c===e)return d;for(let i=0;i<c.length;i++){for(let k=97;k<123;k++){const n=c.slice(0,i)+String.fromCharCode(k)+c.slice(i+1);if(s.has(n)&&!v.has(n)){v.add(n);q.push([n,d+1])}}}}return 0}`,
  verify: `eq(m.wordLadderLength("hit","cog",["hot","dot","dog","lot","log","cog"]),5);eq(m.wordLadderLength("hit","cog",["hot","dot","dog","lot","log"]),0);eq(m.wordLadderLength("a","c",["a","b","c"]),2);` });

T({ id: "004", title: "minMeetingRooms", cat: "algorithms", diff: "medium", stump: false,
  prompt: "Export minMeetingRooms(intervals: Array<[start,end]>): number giving minimum rooms needed. End is exclusive; a meeting ending at t does not conflict with one starting at t.",
  sol: `export function minMeetingRooms(iv){if(!iv.length)return 0;const s=iv.map(x=>x[0]).sort((a,b)=>a-b);const e=iv.map(x=>x[1]).sort((a,b)=>a-b);let r=0,mx=0,j=0;for(let i=0;i<s.length;i++){if(s[i]<e[j])r++;else j++;mx=Math.max(mx,r)}return mx}`,
  verify: `eq(m.minMeetingRooms([[0,30],[5,10],[15,20]]),2);eq(m.minMeetingRooms([[7,10],[2,4]]),1);eq(m.minMeetingRooms([]),0);eq(m.minMeetingRooms([[1,5],[5,10]]),1);eq(m.minMeetingRooms([[1,5],[2,6],[3,7],[4,8]]),4);` });

T({ id: "005", title: "trapRainWater", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export trapRainWater(h: number[]): number for standard 1D rain trapping. Must be O(n) time O(1) extra.",
  sol: `export function trapRainWater(h){let l=0,r=h.length-1,lm=0,rm=0,t=0;while(l<r){if(h[l]<h[r]){if(h[l]>=lm)lm=h[l];else t+=lm-h[l];l++}else{if(h[r]>=rm)rm=h[r];else t+=rm-h[r];r--}}return t}`,
  verify: `eq(m.trapRainWater([0,1,0,2,1,0,1,3,2,1,2,1]),6);eq(m.trapRainWater([4,2,0,3,2,5]),9);eq(m.trapRainWater([]),0);eq(m.trapRainWater([1,1,1]),0);` });

T({ id: "006", title: "editDistance", cat: "algorithms", diff: "medium", stump: false,
  prompt: "Export editDistance(a,b): number (Levenshtein).",
  sol: `export function editDistance(a,b){const m=a.length,n=b.length;let p=Array.from({length:n+1},(_,i)=>i);for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c.push(a[i-1]===b[j-1]?p[j-1]:1+Math.min(p[j-1],p[j],c[j-1]));p=c}return p[n]}`,
  verify: `eq(m.editDistance("kitten","sitting"),3);eq(m.editDistance("","abc"),3);eq(m.editDistance("abc",""),3);eq(m.editDistance("same","same"),0);eq(m.editDistance("intention","execution"),5);` });

T({ id: "007", title: "longestValidParens", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export longestValidParens(s: string): number — length of longest well-formed parentheses substring.",
  sol: `export function longestValidParens(s){let mx=0;const st=[-1];for(let i=0;i<s.length;i++){if(s[i]==='(')st.push(i);else{st.pop();if(!st.length)st.push(i);else mx=Math.max(mx,i-st[st.length-1])}}return mx}`,
  verify: `eq(m.longestValidParens("(()"),2);eq(m.longestValidParens(")()())"),4);eq(m.longestValidParens(""),0);eq(m.longestValidParens("()(()"),2);eq(m.longestValidParens("()(())"),6);` });

T({ id: "008", title: "medianOfTwoSorted", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export medianOfTwoSorted(a,b): number. Must run in O(log(min(m,n))).",
  sol: `export function medianOfTwoSorted(a,b){if(a.length>b.length)[a,b]=[b,a];const m=a.length,n=b.length,h=(m+n+1)>>1;let lo=0,hi=m;while(lo<=hi){const i=(lo+hi)>>1,j=h-i;const al=i===0?-Infinity:a[i-1];const ar=i===m?Infinity:a[i];const bl=j===0?-Infinity:b[j-1];const br=j===n?Infinity:b[j];if(al<=br&&bl<=ar){if((m+n)%2)return Math.max(al,bl);return(Math.max(al,bl)+Math.min(ar,br))/2}else if(al>br)hi=i-1;else lo=i+1}return 0}`,
  verify: `eq(m.medianOfTwoSorted([1,3],[2]),2);eq(m.medianOfTwoSorted([1,2],[3,4]),2.5);eq(m.medianOfTwoSorted([],[1]),1);eq(m.medianOfTwoSorted([1,1,1],[1,1]),1);` });

T({ id: "009", title: "maxProfitK", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export maxProfitK(k: number, prices: number[]): number — at most k buy+sell transactions, no overlap.",
  sol: `export function maxProfitK(k,p){const n=p.length;if(!n||k<=0)return 0;if(k>=n>>1){let s=0;for(let i=1;i<n;i++)if(p[i]>p[i-1])s+=p[i]-p[i-1];return s}const buy=new Array(k+1).fill(-Infinity),sell=new Array(k+1).fill(0);for(const x of p){for(let j=1;j<=k;j++){buy[j]=Math.max(buy[j],sell[j-1]-x);sell[j]=Math.max(sell[j],buy[j]+x)}}return sell[k]}`,
  verify: `eq(m.maxProfitK(2,[2,4,1]),2);eq(m.maxProfitK(2,[3,2,6,5,0,3]),7);eq(m.maxProfitK(0,[1,2,3]),0);eq(m.maxProfitK(100,[]),0);` });

T({ id: "010", title: "nQueensCount", cat: "algorithms", diff: "medium", stump: false,
  prompt: "Export nQueensCount(n: number): number distinct solutions to the n-queens problem.",
  sol: `export function nQueensCount(n){let c=0;const col=new Set(),d1=new Set(),d2=new Set();function r(i){if(i===n){c++;return}for(let j=0;j<n;j++){if(col.has(j)||d1.has(i-j)||d2.has(i+j))continue;col.add(j);d1.add(i-j);d2.add(i+j);r(i+1);col.delete(j);d1.delete(i-j);d2.delete(i+j)}}r(0);return c}`,
  verify: `eq(m.nQueensCount(1),1);eq(m.nQueensCount(4),2);eq(m.nQueensCount(5),10);eq(m.nQueensCount(8),92);eq(m.nQueensCount(2),0);` });

// -------- 11..15 data structures --------
T({ id: "011", title: "lruCache", cat: "data-structures", diff: "medium", stump: false,
  prompt: "Export class LRUCache with constructor(capacity), get(key): V|undefined, put(key, value): void. O(1) per op; evict least recently used on overflow.",
  sol: `export class LRUCache{constructor(c){this.c=c;this.m=new Map()}get(k){if(!this.m.has(k))return undefined;const v=this.m.get(k);this.m.delete(k);this.m.set(k,v);return v}put(k,v){if(this.m.has(k))this.m.delete(k);this.m.set(k,v);if(this.m.size>this.c)this.m.delete(this.m.keys().next().value)}}`,
  verify: `const c=new m.LRUCache(2);c.put(1,1);c.put(2,2);eq(c.get(1),1);c.put(3,3);eq(c.get(2),undefined);c.put(4,4);eq(c.get(1),undefined);eq(c.get(3),3);eq(c.get(4),4);` });

T({ id: "012", title: "medianStream", cat: "data-structures", diff: "hard", stump: true,
  prompt: "Export class MedianStream with add(x): void and median(): number. Must run in O(log n) per add and O(1) per median.",
  sol: `class H{constructor(cmp){this.a=[];this.cmp=cmp}size(){return this.a.length}peek(){return this.a[0]}push(x){this.a.push(x);let i=this.a.length-1;while(i>0){const p=(i-1)>>1;if(this.cmp(this.a[i],this.a[p])<0){[this.a[i],this.a[p]]=[this.a[p],this.a[i]];i=p}else break}}pop(){const r=this.a[0],e=this.a.pop();if(this.a.length){this.a[0]=e;let i=0;for(;;){const l=2*i+1,r2=2*i+2;let s=i;if(l<this.a.length&&this.cmp(this.a[l],this.a[s])<0)s=l;if(r2<this.a.length&&this.cmp(this.a[r2],this.a[s])<0)s=r2;if(s!==i){[this.a[i],this.a[s]]=[this.a[s],this.a[i]];i=s}else break}}return r}}export class MedianStream{constructor(){this.lo=new H((a,b)=>b-a);this.hi=new H((a,b)=>a-b)}add(x){this.lo.push(x);this.hi.push(this.lo.pop());if(this.hi.size()>this.lo.size())this.lo.push(this.hi.pop())}median(){if(!this.lo.size())return NaN;if(this.lo.size()>this.hi.size())return this.lo.peek();return(this.lo.peek()+this.hi.peek())/2}}`,
  verify: `const s=new m.MedianStream();s.add(1);eq(s.median(),1);s.add(2);eq(s.median(),1.5);s.add(3);eq(s.median(),2);s.add(4);eq(s.median(),2.5);s.add(5);eq(s.median(),3);` });

T({ id: "013", title: "unionFind", cat: "data-structures", diff: "medium", stump: false,
  prompt: "Export class UnionFind(n) with union(a,b), find(a), connected(a,b), count() returning component count. Use path compression and union by rank.",
  sol: `export class UnionFind{constructor(n){this.p=Array.from({length:n},(_,i)=>i);this.r=new Array(n).fill(0);this.n=n}find(x){while(this.p[x]!==x){this.p[x]=this.p[this.p[x]];x=this.p[x]}return x}union(a,b){const x=this.find(a),y=this.find(b);if(x===y)return false;if(this.r[x]<this.r[y])this.p[x]=y;else if(this.r[x]>this.r[y])this.p[y]=x;else{this.p[y]=x;this.r[x]++}this.n--;return true}connected(a,b){return this.find(a)===this.find(b)}count(){return this.n}}`,
  verify: `const u=new m.UnionFind(5);eq(u.count(),5);u.union(0,1);u.union(2,3);eq(u.count(),3);assert(u.connected(0,1));assert(!u.connected(0,2));u.union(1,2);assert(u.connected(0,3));eq(u.count(),2);` });

T({ id: "014", title: "trieAutocomplete", cat: "data-structures", diff: "medium", stump: false,
  prompt: "Export class Trie with insert(word), complete(prefix) returning all stored words with that prefix, sorted ascending.",
  sol: `export class Trie{constructor(){this.r={c:{},w:false}}insert(w){let n=this.r;for(const ch of w){n.c[ch]=n.c[ch]||{c:{},w:false};n=n.c[ch]}n.w=true}complete(p){let n=this.r;for(const ch of p){if(!n.c[ch])return[];n=n.c[ch]}const out=[];const dfs=(node,s)=>{if(node.w)out.push(s);for(const ch of Object.keys(node.c).sort())dfs(node.c[ch],s+ch)};dfs(n,p);return out}}`,
  verify: `const t=new m.Trie();["apple","app","apt","bat"].forEach(w=>t.insert(w));eq(t.complete("ap"),["app","apple","apt"]);eq(t.complete("b"),["bat"]);eq(t.complete("z"),[]);` });

T({ id: "015", title: "skiplistSet", cat: "data-structures", diff: "hard", stump: true,
  prompt: "Export class OrderedSet with add(x), has(x), remove(x), kth(i): returns i-th smallest (0-indexed) or undefined. Each op O(log n) average.",
  sol: `export class OrderedSet{constructor(){this.a=[]}_bs(x){let l=0,r=this.a.length;while(l<r){const m=(l+r)>>1;if(this.a[m]<x)l=m+1;else r=m}return l}has(x){const i=this._bs(x);return i<this.a.length&&this.a[i]===x}add(x){const i=this._bs(x);if(this.a[i]===x)return false;this.a.splice(i,0,x);return true}remove(x){const i=this._bs(x);if(this.a[i]!==x)return false;this.a.splice(i,1);return true}kth(i){return this.a[i]}}`,
  verify: `const s=new m.OrderedSet();[5,3,1,4,2].forEach(x=>s.add(x));eq(s.kth(0),1);eq(s.kth(4),5);assert(s.has(3));s.remove(3);assert(!s.has(3));eq(s.kth(2),4);` });

// -------- 16..21 concurrency / async --------
T({ id: "016", title: "promisePool", cat: "concurrency", diff: "hard", stump: true,
  prompt: "Export async function promisePool(tasks: Array<()=>Promise<T>>, limit: number): Promise<T[]>. Preserve input order in output. Run at most `limit` concurrently. If any task rejects, reject with the first rejection and stop starting new ones.",
  sol: `export async function promisePool(tasks,limit){const out=new Array(tasks.length);let i=0,active=0,done=0,rejected=false,rejErr,resolveAll,rejectAll;return new Promise((res,rej)=>{resolveAll=res;rejectAll=rej;const run=()=>{if(rejected)return;while(active<limit&&i<tasks.length){const idx=i++;active++;Promise.resolve().then(()=>tasks[idx]()).then(v=>{out[idx]=v;active--;done++;if(done===tasks.length)res(out);else run()},e=>{if(!rejected){rejected=true;rej(e)}})}};if(!tasks.length)res([]);else run()})}`,
  verify: `const d=(v,t)=>()=>new Promise(r=>setTimeout(()=>r(v),t));const r=await m.promisePool([d(1,10),d(2,5),d(3,1)],2);eq(r,[1,2,3]);const r2=await m.promisePool([],3);eq(r2,[]);let err=null;try{await m.promisePool([d(1,5),()=>Promise.reject(new Error("x")),d(3,5)],2)}catch(e){err=e}assert(err&&err.message==="x");` });

T({ id: "017", title: "debounceAsync", cat: "concurrency", diff: "medium", stump: false,
  prompt: "Export debounceAsync(fn, ms) returning a function. Multiple rapid calls coalesce: only the LAST call's arguments run after ms of quiet. All callers in the same burst receive the SAME resolved value (or rejection).",
  sol: `export function debounceAsync(fn,ms){let t=null,wait=null;return function(...args){if(!wait)wait={promise:null,resolve:null,reject:null},wait.promise=new Promise((r,j)=>{wait.resolve=r;wait.reject=j});if(t)clearTimeout(t);t=setTimeout(()=>{const w=wait;wait=null;t=null;Promise.resolve().then(()=>fn.apply(this,args)).then(w.resolve,w.reject)},ms);return wait.promise}}`,
  verify: `let n=0;const f=m.debounceAsync(x=>{n++;return x*2},10);const p1=f(1),p2=f(2),p3=f(3);const[a,b,c]=await Promise.all([p1,p2,p3]);eq(n,1);eq(a,6);eq(b,6);eq(c,6);` });

T({ id: "018", title: "asyncSemaphore", cat: "concurrency", diff: "medium", stump: false,
  prompt: "Export class Semaphore(n) with acquire(): Promise<()=>void> returning a release fn. Pending acquires resolve in FIFO order as releases occur.",
  sol: `export class Semaphore{constructor(n){this.c=n;this.q=[]}acquire(){return new Promise(res=>{const g=()=>{this.c--;res(()=>{this.c++;if(this.q.length)this.q.shift()()})};if(this.c>0)g();else this.q.push(g)})}}`,
  verify: `const s=new m.Semaphore(2);const order=[];const task=async id=>{const rel=await s.acquire();order.push("s"+id);await new Promise(r=>setTimeout(r,5));order.push("e"+id);rel()};await Promise.all([task(1),task(2),task(3),task(4)]);eq(order.slice(0,2).sort(),["s1","s2"]);assert(order.includes("e4"));` });

T({ id: "019", title: "retryBackoff", cat: "concurrency", diff: "medium", stump: false,
  prompt: "Export async retryBackoff(fn, {retries, baseMs, factor}) that retries fn() on rejection, waiting baseMs * factor^attempt before each retry. Resolves with fn's value on first success, rejects with the LAST error after exhausting retries. If retries=0, attempt once.",
  sol: `export async function retryBackoff(fn,{retries,baseMs,factor}){let lastErr;for(let i=0;i<=retries;i++){try{return await fn()}catch(e){lastErr=e;if(i<retries)await new Promise(r=>setTimeout(r,baseMs*Math.pow(factor,i)))}}throw lastErr}`,
  verify: `let n=0;const ok=await m.retryBackoff(async()=>{n++;if(n<3)throw new Error("x");return 42},{retries:5,baseMs:1,factor:1});eq(ok,42);eq(n,3);let err=null;try{await m.retryBackoff(async()=>{throw new Error("fail")},{retries:2,baseMs:1,factor:1})}catch(e){err=e}assert(err&&err.message==="fail");` });

T({ id: "020", title: "asyncQueue", cat: "concurrency", diff: "hard", stump: true,
  prompt: "Export class AsyncQueue<T> with push(v) and pop(): Promise<T>. FIFO. pop before push awaits until a value arrives.",
  sol: `export class AsyncQueue{constructor(){this.v=[];this.w=[]}push(x){if(this.w.length)this.w.shift()(x);else this.v.push(x)}pop(){if(this.v.length)return Promise.resolve(this.v.shift());return new Promise(r=>this.w.push(r))}}`,
  verify: `const q=new m.AsyncQueue();q.push(1);q.push(2);eq(await q.pop(),1);eq(await q.pop(),2);const p=q.pop();q.push(3);eq(await p,3);` });

T({ id: "021", title: "cancelToken", cat: "concurrency", diff: "hard", stump: true,
  prompt: "Export function makeCancelable(promise): { promise, cancel() }. Calling cancel before promise settles makes the returned promise reject with Error('canceled'). Cancel after settlement is a no-op.",
  sol: `export function makeCancelable(p){let c=false,res,rej;const wrapped=new Promise((r,j)=>{res=r;rej=j});p.then(v=>{if(!c)res(v)},e=>{if(!c)rej(e)});return{promise:wrapped,cancel(){if(!c){c=true;rej(new Error("canceled"))}}}}`,
  verify: `const{promise,cancel}=m.makeCancelable(new Promise(r=>setTimeout(()=>r(1),50)));cancel();let err=null;try{await promise}catch(e){err=e}assert(err&&err.message==="canceled");const ok=m.makeCancelable(Promise.resolve(7));eq(await ok.promise,7);ok.cancel();` });

// -------- 22..26 parsers --------
T({ id: "022", title: "jsonParseStrict", cat: "parsers", diff: "hard", stump: true,
  prompt: "Export parseJsonStrict(s) supporting objects, arrays, strings (with \\n \\t \\\" \\\\ \\u escapes), numbers, true/false/null. Throw SyntaxError on trailing chars, trailing commas, or unquoted keys.",
  sol: `export function parseJsonStrict(s){let i=0;const ws=()=>{while(i<s.length&&/\\s/.test(s[i]))i++};const err=m=>{throw new SyntaxError(m)};function val(){ws();const c=s[i];if(c==='{')return obj();if(c==='[')return arr();if(c==='"')return str();if(c==='t'||c==='f')return bool();if(c==='n')return nul();return num()}function obj(){i++;ws();const o={};if(s[i]==='}'){i++;return o}while(true){ws();if(s[i]!=='"')err("key");const k=str();ws();if(s[i]!==':')err(":");i++;o[k]=val();ws();if(s[i]===','){i++;ws();if(s[i]==='}')err("trailing");}else if(s[i]==='}'){i++;return o}else err("expect , or }")}}function arr(){i++;ws();const a=[];if(s[i]===']'){i++;return a}while(true){a.push(val());ws();if(s[i]===','){i++;ws();if(s[i]===']')err("trailing")}else if(s[i]===']'){i++;return a}else err("expect , or ]")}}function str(){i++;let r="";while(i<s.length&&s[i]!=='"'){if(s[i]==='\\\\'){i++;const e=s[i++];if(e==='n')r+='\\n';else if(e==='t')r+='\\t';else if(e==='"')r+='"';else if(e==='\\\\')r+='\\\\';else if(e==='u'){r+=String.fromCharCode(parseInt(s.slice(i,i+4),16));i+=4}else err("esc")}else r+=s[i++]}if(s[i]!=='"')err("unterm");i++;return r}function num(){const st=i;if(s[i]==='-')i++;while(i<s.length&&/[0-9.eE+-]/.test(s[i]))i++;const n=Number(s.slice(st,i));if(Number.isNaN(n))err("num");return n}function bool(){if(s.slice(i,i+4)==='true'){i+=4;return true}if(s.slice(i,i+5)==='false'){i+=5;return false}err("bool")}function nul(){if(s.slice(i,i+4)==='null'){i+=4;return null}err("null")}const r=val();ws();if(i<s.length)err("trailing");return r}`,
  verify: `eq(m.parseJsonStrict('{"a":1,"b":[true,null,"x"]}'),{a:1,b:[true,null,"x"]});eq(m.parseJsonStrict('"hi\\\\nthere"'),"hi\\nthere");let t=false;try{m.parseJsonStrict('{a:1}')}catch{t=true}assert(t);let t2=false;try{m.parseJsonStrict('[1,2,]')}catch{t2=true}assert(t2);let t3=false;try{m.parseJsonStrict('{"a":1} junk')}catch{t3=true}assert(t3);` });

T({ id: "023", title: "csvParse", cat: "parsers", diff: "medium", stump: false,
  prompt: "Export parseCsv(text): string[][]. Support quoted fields with escaped double-quotes (\"\") and embedded commas/newlines. No header handling.",
  sol: `export function parseCsv(t){const rows=[[""]];let i=0,q=false;while(i<t.length){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){rows[rows.length-1][rows[rows.length-1].length-1]+='"';i+=2;continue}q=false;i++;continue}rows[rows.length-1][rows[rows.length-1].length-1]+=c;i++}else{if(c==='"'){q=true;i++}else if(c===','){rows[rows.length-1].push("");i++}else if(c==='\\n'){rows.push([""]);i++}else if(c==='\\r'){i++}else{rows[rows.length-1][rows[rows.length-1].length-1]+=c;i++}}}if(rows.length&&rows[rows.length-1].length===1&&rows[rows.length-1][0]==="")rows.pop();return rows}`,
  verify: `eq(m.parseCsv('a,b,c\\n1,2,3'),[["a","b","c"],["1","2","3"]]);eq(m.parseCsv('"hello, world","line\\nbreak","q""q"'),[["hello, world","line\\nbreak",'q"q']]);eq(m.parseCsv(''),[]);` });

T({ id: "024", title: "exprEval", cat: "parsers", diff: "hard", stump: true,
  prompt: "Export evalExpr(s: string): number supporting + - * / parentheses and unary minus with correct precedence. Integers and decimals. Whitespace ignored.",
  sol: `export function evalExpr(s){let i=0;const skip=()=>{while(s[i]===' ')i++};function expr(){let v=term();skip();while(s[i]==='+'||s[i]==='-'){const op=s[i++];const r=term();v=op==='+'?v+r:v-r;skip()}return v}function term(){let v=unary();skip();while(s[i]==='*'||s[i]==='/'){const op=s[i++];const r=unary();v=op==='*'?v*r:v/r;skip()}return v}function unary(){skip();if(s[i]==='-'){i++;return-unary()}if(s[i]==='+'){i++;return unary()}return primary()}function primary(){skip();if(s[i]==='('){i++;const v=expr();skip();i++;return v}const st=i;while(i<s.length&&/[0-9.]/.test(s[i]))i++;return Number(s.slice(st,i))}return expr()}`,
  verify: `eq(m.evalExpr("1+2*3"),7);eq(m.evalExpr("(1+2)*3"),9);eq(m.evalExpr("-2+-3"),-5);eq(m.evalExpr("10/4"),2.5);eq(m.evalExpr("2*(3+4)-1"),13);` });

T({ id: "025", title: "iniParse", cat: "parsers", diff: "medium", stump: false,
  prompt: "Export parseIni(text): Record<string, Record<string,string>>. Sections are [name]. key=value. Lines starting with ; or # are comments. Trim whitespace. Values before any section go under '_default'.",
  sol: `export function parseIni(t){const r={_default:{}};let cur="_default";for(const raw of t.split(/\\r?\\n/)){const l=raw.trim();if(!l||l[0]===';'||l[0]==='#')continue;if(l[0]==='['&&l.endsWith(']')){cur=l.slice(1,-1).trim();if(!r[cur])r[cur]={};continue}const eq=l.indexOf('=');if(eq<0)continue;const k=l.slice(0,eq).trim();const v=l.slice(eq+1).trim();r[cur][k]=v}return r}`,
  verify: `const r=m.parseIni("; comment\\nfoo=bar\\n[s1]\\na=1\\nb = two\\n[s2]\\nk=v");eq(r._default.foo,"bar");eq(r.s1.a,"1");eq(r.s1.b,"two");eq(r.s2.k,"v");` });

T({ id: "026", title: "semverCmp", cat: "parsers", diff: "hard", stump: true,
  prompt: "Export semverCmp(a, b): -1|0|1. Follow semver 2.0.0: prerelease identifiers compared left-to-right, numeric lt alpha, shorter prerelease list lt longer.",
  sol: `export function semverCmp(a,b){const p=v=>{const[m,pre]=v.split('-');return[m.split('.').map(Number),pre?pre.split('.'):[]]};const[am,ap]=p(a),[bm,bp]=p(b);for(let i=0;i<3;i++){if(am[i]!==bm[i])return am[i]<bm[i]?-1:1}if(!ap.length&&!bp.length)return 0;if(!ap.length)return 1;if(!bp.length)return-1;const n=Math.min(ap.length,bp.length);for(let i=0;i<n;i++){const x=ap[i],y=bp[i];const xn=/^\\d+$/.test(x),yn=/^\\d+$/.test(y);if(xn&&yn){const a=+x,b=+y;if(a!==b)return a<b?-1:1}else if(xn)return-1;else if(yn)return 1;else if(x!==y)return x<y?-1:1}return ap.length===bp.length?0:ap.length<bp.length?-1:1}`,
  verify: `eq(m.semverCmp("1.0.0","1.0.0"),0);eq(m.semverCmp("1.0.0","2.0.0"),-1);eq(m.semverCmp("1.0.0-alpha","1.0.0"),-1);eq(m.semverCmp("1.0.0-alpha","1.0.0-beta"),-1);eq(m.semverCmp("1.0.0-alpha.1","1.0.0-alpha"),1);eq(m.semverCmp("1.0.0-1","1.0.0-alpha"),-1);` });

// -------- 27..30 numerical --------
T({ id: "027", title: "sqrtNewton", cat: "numerical", diff: "medium", stump: false,
  prompt: "Export sqrtNewton(x, eps=1e-10). Must reject negatives with Error. 0 -> 0.",
  sol: `export function sqrtNewton(x,eps=1e-10){if(x<0)throw new Error("neg");if(x===0)return 0;let r=x;for(let i=0;i<100;i++){const n=(r+x/r)/2;if(Math.abs(n-r)<eps)return n;r=n}return r}`,
  verify: `assert(Math.abs(m.sqrtNewton(4)-2)<1e-9);assert(Math.abs(m.sqrtNewton(2)-Math.SQRT2)<1e-9);eq(m.sqrtNewton(0),0);let t=false;try{m.sqrtNewton(-1)}catch{t=true}assert(t);` });

T({ id: "028", title: "matMul", cat: "numerical", diff: "medium", stump: false,
  prompt: "Export matMul(A,B): number[][]. Throw Error('shape') on mismatch.",
  sol: `export function matMul(A,B){const r=A.length,c=B[0].length,k=B.length;if(A[0].length!==k)throw new Error("shape");const R=Array.from({length:r},()=>new Array(c).fill(0));for(let i=0;i<r;i++)for(let j=0;j<c;j++){let s=0;for(let t=0;t<k;t++)s+=A[i][t]*B[t][j];R[i][j]=s}return R}`,
  verify: `eq(m.matMul([[1,2],[3,4]],[[5,6],[7,8]]),[[19,22],[43,50]]);let t=false;try{m.matMul([[1,2]],[[1,2]])}catch{t=true}assert(t);` });

T({ id: "029", title: "bigIntFactorial", cat: "numerical", diff: "easy", stump: false,
  prompt: "Export factorial(n: number): bigint. n<0 throws. Must handle n up to 100.",
  sol: `export function factorial(n){if(n<0)throw new Error("neg");let r=1n;for(let i=2;i<=n;i++)r*=BigInt(i);return r}`,
  verify: `eq(m.factorial(0).toString(),"1");eq(m.factorial(5).toString(),"120");eq(m.factorial(20).toString(),"2432902008176640000");` });

T({ id: "030", title: "primeSieve", cat: "numerical", diff: "easy", stump: false,
  prompt: "Export primesUpTo(n): number[] using sieve of eratosthenes.",
  sol: `export function primesUpTo(n){if(n<2)return[];const s=new Uint8Array(n+1);const r=[];for(let i=2;i<=n;i++){if(!s[i]){r.push(i);for(let j=i*i;j<=n;j+=i)s[j]=1}}return r}`,
  verify: `eq(m.primesUpTo(1),[]);eq(m.primesUpTo(10),[2,3,5,7]);eq(m.primesUpTo(30).length,10);` });

// -------- 31..35 tricky spec --------
T({ id: "031", title: "compactArr", cat: "tricky-spec", diff: "hard", stump: true,
  prompt: "Export compact(arr) that removes: null, undefined, NaN, '', 0, false — but KEEPS '0', 'false', and empty objects {}. Order preserved.",
  sol: `export function compact(a){return a.filter(x=>{if(x===null||x===undefined)return false;if(typeof x==='number'&&(x===0||Number.isNaN(x)))return false;if(x===false||x==='')return false;return true})}`,
  verify: `eq(m.compact([0,1,false,2,'',3,null,undefined,NaN,'0','false',{}]),[1,2,3,'0','false',{}]);` });

T({ id: "032", title: "deepEqual", cat: "tricky-spec", diff: "hard", stump: true,
  prompt: "Export deepEqual(a,b). Compare primitives, arrays, plain objects, Maps, Sets, Dates. NaN equals NaN. +0 equals -0. Different types -> false.",
  sol: `export function deepEqual(a,b){if(Object.is(a,b))return true;if(a===0&&b===0)return true;if(Number.isNaN(a)&&Number.isNaN(b))return true;if(typeof a!=='object'||typeof b!=='object'||!a||!b)return false;if(a instanceof Date)return b instanceof Date&&a.getTime()===b.getTime();if(a instanceof Map){if(!(b instanceof Map)||a.size!==b.size)return false;for(const[k,v]of a)if(!b.has(k)||!deepEqual(v,b.get(k)))return false;return true}if(a instanceof Set){if(!(b instanceof Set)||a.size!==b.size)return false;for(const v of a)if(!b.has(v))return false;return true}if(Array.isArray(a)){if(!Array.isArray(b)||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!deepEqual(a[i],b[i]))return false;return true}if(Array.isArray(b))return false;const ka=Object.keys(a),kb=Object.keys(b);if(ka.length!==kb.length)return false;for(const k of ka)if(!deepEqual(a[k],b[k]))return false;return true}`,
  verify: `assert(m.deepEqual({a:[1,{b:2}]},{a:[1,{b:2}]}));assert(!m.deepEqual({a:1},{a:2}));assert(m.deepEqual(NaN,NaN));assert(m.deepEqual(0,-0));assert(m.deepEqual(new Date(1),new Date(1)));assert(!m.deepEqual([1,2],[1,2,3]));assert(m.deepEqual(new Map([[1,2]]),new Map([[1,2]])));` });

T({ id: "033", title: "rateLimiter", cat: "tricky-spec", diff: "hard", stump: true,
  prompt: "Export class RateLimiter(maxCalls, windowMs, nowFn=()=>Date.now()). tryAcquire() returns true if calls in trailing windowMs <= maxCalls-1 (and records this call), else false. Old calls are forgotten.",
  sol: `export class RateLimiter{constructor(mx,w,now=()=>Date.now()){this.mx=mx;this.w=w;this.now=now;this.h=[]}tryAcquire(){const t=this.now();while(this.h.length&&this.h[0]<=t-this.w)this.h.shift();if(this.h.length>=this.mx)return false;this.h.push(t);return true}}`,
  verify: `let t=0;const r=new m.RateLimiter(2,10,()=>t);assert(r.tryAcquire());assert(r.tryAcquire());assert(!r.tryAcquire());t=11;assert(r.tryAcquire());assert(r.tryAcquire());assert(!r.tryAcquire());` });

T({ id: "034", title: "dateAddBizDays", cat: "tricky-spec", diff: "hard", stump: true,
  prompt: "Export addBusinessDays(dateIso: string, n: number): string. Skip Saturday and Sunday. If start is a weekend, normalize to next Monday before counting. Output ISO YYYY-MM-DD.",
  sol: `export function addBusinessDays(iso,n){const d=new Date(iso+"T00:00:00Z");while(d.getUTCDay()===0||d.getUTCDay()===6)d.setUTCDate(d.getUTCDate()+1);let left=n;while(left>0){d.setUTCDate(d.getUTCDate()+1);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)left--}return d.toISOString().slice(0,10)}`,
  verify: `eq(m.addBusinessDays("2024-01-01",5),"2024-01-08");eq(m.addBusinessDays("2024-01-06",1),"2024-01-09");eq(m.addBusinessDays("2024-01-05",1),"2024-01-08");` });

T({ id: "035", title: "mergeIntervals", cat: "tricky-spec", diff: "medium", stump: false,
  prompt: "Export mergeIntervals(iv) merging overlapping/adjacent (touching) ranges. Input unordered.",
  sol: `export function mergeIntervals(iv){if(!iv.length)return[];const s=iv.map(x=>x.slice()).sort((a,b)=>a[0]-b[0]);const r=[s[0]];for(let i=1;i<s.length;i++){if(s[i][0]<=r[r.length-1][1])r[r.length-1][1]=Math.max(r[r.length-1][1],s[i][1]);else r.push(s[i])}return r}`,
  verify: `eq(m.mergeIntervals([[1,3],[2,6],[8,10],[15,18]]),[[1,6],[8,10],[15,18]]);eq(m.mergeIntervals([[1,4],[4,5]]),[[1,5]]);eq(m.mergeIntervals([]),[]);` });

// -------- 36..40 refactor / utility --------
T({ id: "036", title: "groupBy", cat: "refactor", diff: "easy", stump: false,
  prompt: "Export groupBy(arr, keyFn). Return Record<string, T[]>. Preserve order within groups.",
  sol: `export function groupBy(a,k){const r={};for(const x of a){const g=k(x);(r[g]=r[g]||[]).push(x)}return r}`,
  verify: `eq(m.groupBy([1,2,3,4,5],x=>x%2?"odd":"even"),{odd:[1,3,5],even:[2,4]});` });

T({ id: "037", title: "chunk", cat: "refactor", diff: "easy", stump: false,
  prompt: "Export chunk(arr, size). Size<=0 throws. Last chunk may be shorter.",
  sol: `export function chunk(a,s){if(s<=0)throw new Error("size");const r=[];for(let i=0;i<a.length;i+=s)r.push(a.slice(i,i+s));return r}`,
  verify: `eq(m.chunk([1,2,3,4,5],2),[[1,2],[3,4],[5]]);eq(m.chunk([],3),[]);let t=false;try{m.chunk([1],0)}catch{t=true}assert(t);` });

T({ id: "038", title: "zip", cat: "refactor", diff: "easy", stump: false,
  prompt: "Export zip(...arrays). Stops at shortest.",
  sol: `export function zip(...as){if(!as.length)return[];const n=Math.min(...as.map(a=>a.length));return Array.from({length:n},(_,i)=>as.map(a=>a[i]))}`,
  verify: `eq(m.zip([1,2,3],['a','b','c']),[[1,'a'],[2,'b'],[3,'c']]);eq(m.zip([1,2],[3,4,5]),[[1,3],[2,4]]);eq(m.zip(),[]);` });

T({ id: "039", title: "flattenDeep", cat: "refactor", diff: "medium", stump: false,
  prompt: "Export flattenDeep(arr). Recursively flatten nested arrays (arbitrary depth). Non-array values kept as-is.",
  sol: `export function flattenDeep(a){const r=[];for(const x of a){if(Array.isArray(x))r.push(...flattenDeep(x));else r.push(x)}return r}`,
  verify: `eq(m.flattenDeep([1,[2,[3,[4,[5]]]]]),[1,2,3,4,5]);eq(m.flattenDeep([]),[]);eq(m.flattenDeep([[],[[]]]),[]);` });

T({ id: "040", title: "memoize", cat: "refactor", diff: "medium", stump: false,
  prompt: "Export memoize(fn, keyFn=(...a)=>JSON.stringify(a)). Cached results returned; pending promises NOT required.",
  sol: `export function memoize(f,k=(...a)=>JSON.stringify(a)){const c=new Map();return function(...a){const key=k(...a);if(c.has(key))return c.get(key);const v=f.apply(this,a);c.set(key,v);return v}}`,
  verify: `let n=0;const f=m.memoize(x=>{n++;return x*2});eq(f(3),6);eq(f(3),6);eq(n,1);eq(f(4),8);eq(n,2);` });

// -------- 41..44 security --------
T({ id: "041", title: "hmacLike", cat: "security", diff: "hard", stump: true,
  prompt: "Export constantTimeEqual(a: string, b: string): boolean. Return false on length mismatch. Must avoid early-exit leaks (compare all bytes even on mismatch). Use charCodeAt XOR or Buffer.compare style.",
  sol: `export function constantTimeEqual(a,b){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}`,
  verify: `assert(m.constantTimeEqual("abc","abc"));assert(!m.constantTimeEqual("abc","abd"));assert(!m.constantTimeEqual("abc","ab"));assert(m.constantTimeEqual("",""));` });

T({ id: "042", title: "sanitizeHtml", cat: "security", diff: "hard", stump: true,
  prompt: "Export escapeHtml(s). Replace & < > \" ' with their HTML entities in that order (& first to avoid double-escape).",
  sol: `export function escapeHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}`,
  verify: `eq(m.escapeHtml("<b>\\"Hi\\" & 'bye'</b>"),"&lt;b&gt;&quot;Hi&quot; &amp; &#39;bye&#39;&lt;/b&gt;");eq(m.escapeHtml("&"),"&amp;");` });

T({ id: "043", title: "passwordStrength", cat: "security", diff: "medium", stump: false,
  prompt: "Export passwordStrength(pw): 'weak'|'medium'|'strong'. weak: <8 chars. strong: >=12 chars AND has lowercase AND uppercase AND digit AND symbol. otherwise medium.",
  sol: `export function passwordStrength(p){if(p.length<8)return"weak";const l=/[a-z]/.test(p),u=/[A-Z]/.test(p),d=/\\d/.test(p),s=/[^a-zA-Z0-9]/.test(p);if(p.length>=12&&l&&u&&d&&s)return"strong";return"medium"}`,
  verify: `eq(m.passwordStrength("abc"),"weak");eq(m.passwordStrength("abcdefgh"),"medium");eq(m.passwordStrength("Abcdefgh1!xY"),"strong");eq(m.passwordStrength("Abcdefgh1!"),"medium");` });

T({ id: "044", title: "urlSafePath", cat: "security", diff: "hard", stump: true,
  prompt: "Export safeJoin(base, user): string that joins base with a user-supplied relative path, rejecting any path that would escape base (via .., absolute, or null bytes) with Error('unsafe'). Returns posix-style joined path.",
  sol: `import path from "node:path";export function safeJoin(b,u){if(u.includes("\\0"))throw new Error("unsafe");if(path.isAbsolute(u))throw new Error("unsafe");const joined=path.posix.normalize(path.posix.join(b,u));const base=path.posix.normalize(b.endsWith("/")?b:b+"/");if(!(joined+"/").startsWith(base))throw new Error("unsafe");return joined}`,
  verify: `eq(m.safeJoin("/var/data","foo/bar.txt"),"/var/data/foo/bar.txt");let t=false;try{m.safeJoin("/var/data","../etc/passwd")}catch{t=true}assert(t);let t2=false;try{m.safeJoin("/var/data","/etc/passwd")}catch{t2=true}assert(t2);` });

// -------- 45..47 unicode --------
T({ id: "045", title: "graphemeCount", cat: "unicode", diff: "hard", stump: true,
  prompt: "Export graphemeCount(s) counting extended grapheme clusters using Intl.Segmenter.",
  sol: `export function graphemeCount(s){const seg=new Intl.Segmenter("en",{granularity:"grapheme"});let n=0;for(const _ of seg.segment(s))n++;return n}`,
  verify: `eq(m.graphemeCount("hello"),5);eq(m.graphemeCount("👨‍👩‍👧"),1);eq(m.graphemeCount("a\\u0301"),1);` });

T({ id: "046", title: "slugify", cat: "unicode", diff: "medium", stump: false,
  prompt: "Export slugify(s): lowercase, strip diacritics via NFD, replace non-alnum runs with '-', trim leading/trailing dashes.",
  sol: `export function slugify(s){return s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}`,
  verify: `eq(m.slugify("Héllo World!"),"hello-world");eq(m.slugify("  Ça va? "),"ca-va");eq(m.slugify("---"),"");` });

T({ id: "047", title: "reverseUnicodeSafe", cat: "unicode", diff: "hard", stump: true,
  prompt: "Export reverseString(s) that reverses by grapheme clusters (via Intl.Segmenter), so surrogate pairs and combining marks stay intact.",
  sol: `export function reverseString(s){const seg=new Intl.Segmenter("en",{granularity:"grapheme"});const parts=[];for(const x of seg.segment(s))parts.push(x.segment);return parts.reverse().join("")}`,
  verify: `eq(m.reverseString("abc"),"cba");eq(m.reverseString("a😀b"),"b😀a");eq(m.reverseString(""),"");` });

// -------- 48..50 tooling / misc --------
T({ id: "048", title: "topologicalSort", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export topoSort(nodes: string[], edges: Array<[string,string]>): string[] giving a topological order (u before v for each edge [u,v]). Throw Error('cycle') on cycle. Nodes without edges keep input order where possible.",
  sol: `export function topoSort(nodes,edges){const adj=new Map(nodes.map(n=>[n,[]]));const ind=new Map(nodes.map(n=>[n,0]));for(const[u,v]of edges){adj.get(u).push(v);ind.set(v,ind.get(v)+1)}const q=nodes.filter(n=>ind.get(n)===0);const out=[];while(q.length){const n=q.shift();out.push(n);for(const v of adj.get(n)){ind.set(v,ind.get(v)-1);if(ind.get(v)===0)q.push(v)}}if(out.length!==nodes.length)throw new Error("cycle");return out}`,
  verify: `eq(m.topoSort(["a","b","c","d"],[["a","b"],["a","c"],["b","d"],["c","d"]]),["a","b","c","d"]);let t=false;try{m.topoSort(["a","b"],[["a","b"],["b","a"]])}catch{t=true}assert(t);` });

T({ id: "049", title: "diffLines", cat: "algorithms", diff: "hard", stump: true,
  prompt: "Export diffLines(a: string[], b: string[]): Array<{op:'=' |'+' |'-', line:string}>. Use LCS. '-' lines come before '+' when both at same LCS boundary.",
  sol: `export function diffLines(a,b){const m=a.length,n=b.length;const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);const out=[];let i=m,j=n;while(i>0&&j>0){if(a[i-1]===b[j-1]){out.push({op:"=",line:a[i-1]});i--;j--}else if(dp[i-1][j]>=dp[i][j-1]){out.push({op:"-",line:a[i-1]});i--}else{out.push({op:"+",line:b[j-1]});j--}}while(i>0){out.push({op:"-",line:a[i-1]});i--}while(j>0){out.push({op:"+",line:b[j-1]});j--}return out.reverse()}`,
  verify: `const d=m.diffLines(["a","b","c"],["a","x","c"]);eq(d.filter(x=>x.op==="=").length,2);eq(d.filter(x=>x.op==="-").map(x=>x.line),["b"]);eq(d.filter(x=>x.op==="+").map(x=>x.line),["x"]);` });

T({ id: "050", title: "stableSortBy", cat: "algorithms", diff: "medium", stump: false,
  prompt: "Export stableSortBy(arr, keyFn). Must be stable. Original array unchanged. Supports numeric and string keys.",
  sol: `export function stableSortBy(a,k){return a.map((v,i)=>[v,k(v),i]).sort((x,y)=>x[1]<y[1]?-1:x[1]>y[1]?1:x[2]-y[2]).map(x=>x[0])}`,
  verify: `const a=[{n:"b",i:1},{n:"a",i:2},{n:"b",i:3},{n:"a",i:4}];const s=m.stableSortBy(a,x=>x.n);eq(s.map(x=>x.i),[2,4,1,3]);eq(a.map(x=>x.i),[1,2,3,4]);` });

// Emit files
const assertPrelude = `const assert=(c,msg)=>{if(!c)throw new Error(msg||"assertion failed")};const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||"eq fail")+": got "+JSON.stringify(a)+" want "+JSON.stringify(b))};`;

for (const t of tasks) {
  const file = `${t.id}-${t.title}.mjs`;
  const content = `${assertPrelude}
const solution = ${JSON.stringify(t.sol)};
export default {
  id: ${JSON.stringify(t.id + "-" + t.title)},
  title: ${JSON.stringify(t.title)},
  category: ${JSON.stringify(t.cat)},
  difficulty: ${JSON.stringify(t.diff)},
  expectedToStump: ${t.stump},
  prompt: ${JSON.stringify(t.prompt)},
  starterFiles: { "solution.mjs": "// TODO: implement\\nexport {};\\n" },
  referenceFiles: { "solution.mjs": solution },
  solutionPath: "solution.mjs",
  async verify(m) {
    ${t.verify}
  }
};
`;
  writeFileSync(join(tasksDir, file), content);
}
console.log(`wrote ${tasks.length} tasks to ${tasksDir}`);
