import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const tick=()=>new Promise(r=>setImmediate(r));
function harness(respond=()=>({data:{ok:true,active:true}})){
 const calls=[],uploads=[],timers=new Map(),states=[];let id=0,clock=1000;
 class Stream{constructor(tracks){this.tracks=tracks}getTracks(){return this.tracks}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video')}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio')}removeTrack(t){this.tracks=this.tracks.filter(x=>x!==t)}}
 class Recorder{static isTypeSupported(m){return m.includes('vp8')}constructor(stream,options){this.stream=stream;this.options=options;this.state='inactive'}start(){this.state='recording';queueMicrotask(()=>this.onstart?.())}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['test video bytes'])});this.onstop?.()})}}
 const window={MediaRecorder:Recorder,TENNIS_PORTAL_CONFIG:{supabaseUrl:'https://test.invalid',supabaseAnonKey:'public-test'},addEventListener(){}};
 const client={functions:{async invoke(name,{body}){calls.push(body);return respond(body)}},auth:{async getSession(){return{data:{session:{access_token:'verified-test-token'}}}}}};
 const ctx=vm.createContext({window,MediaRecorder:Recorder,MediaStream:Stream,Blob,Date,Math,Promise,performance:{now:()=>clock},AbortSignal,
 setTimeout(fn,ms){const n=++id;timers.set(n,{fn,ms});return n},clearTimeout(n){timers.delete(n)},setInterval(fn,ms){const n=++id;timers.set(n,{fn,ms});return n},clearInterval(n){timers.delete(n)},
 async fetch(url,options){uploads.push({url,options});return{ok:true}},queueMicrotask});
 vm.runInContext(readFileSync('screen-recording.js','utf8'),ctx);
 const video={kind:'video',readyState:'live',getSettings:()=>({displaySurface:'monitor'}),async applyConstraints(){},stop(){this.readyState='ended'}};
 const audio={kind:'audio',readyState:'live',stop(){this.readyState='ended'}};
 const stream=new Stream([video,audio]),config={target_bitrate:500000,target_fps:10,segment_seconds:60,max_segment_bytes:8388608,max_queue_bytes:25165824};
 const prepared=window.LinkoraRecording.prepare(stream,config),presence={active:true,tabId:'tab'};
 const recording=new window.LinkoraRecording.Recording(client,presence,s=>states.push(s));
 return{...window.LinkoraRecording,calls,uploads,timers,states,video,audio,stream,prepared,recording,config,window,presence,Stream,advance(n=1000){clock+=n},result:{recording:{id:'recording',generation:1},serverTime:new Date().toISOString(),nextSequence:1,config}};
}
test('prepare strips audio, chooses supported codec and validates whole-screen before attendance',()=>{
 const h=harness();assert.equal(h.audio.readyState,'ended');assert.equal(h.prepared.stream.getAudioTracks().length,0);assert.equal(h.prepared.codec,'video/webm;codecs=vp8');assert.equal(h.calls.length,0);
 h.video.getSettings=()=>({displaySurface:'browser'});assert.throws(()=>h.prepare(new h.Stream([h.video]),h.config),/Entire Screen/);assert.equal(h.video.readyState,'ended');
});
test('unknown display source is reported explicitly; unsupported recorder never starts attendance',()=>{
 const h=harness();h.video.getSettings=()=>({});assert.equal(h.prepare(new h.Stream([h.video]),h.config).displaySurface,'unknown');h.window.MediaRecorder=null;assert.throws(()=>h.prepare(h.stream,h.config),/cannot record/);assert.equal(h.calls.length,0);
});
test('each rotation creates an independent container; stable sequence upload then commit frees memory',async()=>{
 const h=harness(b=>({data:b.action==='reserve'?{path:'approved/segment.webm'}:{ok:true,active:true}}));await h.recording.start(h.prepared,h.result);
 assert.equal(h.calls[0].action,'activate');const initial=h.recording.recorder;h.advance();h.recording.rotate();await tick();await tick();
 assert.notEqual(h.recording.recorder,initial);assert.deepEqual(h.calls.map(x=>x.action),['activate','reserve','commit']);assert.equal(h.calls[1].sequence,1);assert.equal(h.uploads.length,1);assert.equal(h.uploads[0].options.headers['x-upsert'],'false');assert.equal(h.recording.queueBytes,0);assert.equal(h.recording.queue.length,0);h.recording.abort('test_done');assert.equal(h.timers.size,0);
});
test('lost commit retries exact same sequence and skips already stored immutable object',async()=>{
 let commits=0,reserves=0;const h=harness(b=>b.action==='reserve'?{data:{path:'approved/video.webm',stored:++reserves>1}}:b.action==='commit'&&++commits===1?{error:new Error('network')}:{data:{ok:true,active:true}});
 await h.recording.start(h.prepared,h.result);h.advance();h.recording.rotate();await tick();await tick();assert.equal(h.recording.queue.length,1);h.recording.queue[0].nextAttempt=0;await h.recording.drain();
 assert.deepEqual(h.calls.filter(x=>x.action==='reserve').map(x=>x.sequence),[1,1]);assert.equal(h.uploads.length,1);assert.equal(h.recording.queue.length,0);assert.equal(h.recording.failed,true);h.recording.abort('test_done');
});
test('normal final flush happens while attendance lease is active, capture stops, no late encoder restart',async()=>{
 const h=harness(b=>({data:b.action==='reserve'?{path:'approved/video.webm'}:b.action==='finalize'?{status:'finalizing'}:{ok:true,active:true}}));await h.recording.start(h.prepared,h.result);
 // Avoid artificial timer-driven draining: the encoded final event drains before the bounded wait.
 const stopped=h.recording.stop('clock_out',true);await tick();await tick();for(const [n,t]of [...h.timers])if(t.ms===200){h.timers.delete(n);t.fn()}const result=await stopped;
 assert.equal(result.status,'finalizing');assert.equal(h.video.readyState,'ended');assert.equal(h.presence.active,true);assert.equal(h.recording.mode,'idle');assert.equal(h.calls.at(-1).action,'finalize');assert.equal(h.calls.at(-1).expectedSegments,1);assert.equal(h.timers.size,0);
});
test('bounded queue overflow interrupts capture; crashes discard only unsaved tail and reject stale callbacks',async()=>{
 const h=harness();await h.recording.start(h.prepared,h.result);h.presence.active=false;h.recording.queue=Array.from({length:6},()=>({blob:new Blob(['x']),nextAttempt:0}));h.recording.queueBytes=6;
 h.advance();h.recording.rotate();await tick();await tick();assert.equal(h.recording.failed,true);assert.equal(h.video.readyState,'ended');assert.equal(h.calls.some(x=>x.action==='interrupt'),true);assert.equal(h.recording.mode,'idle');
 const j=harness();await j.recording.start(j.prepared,j.result);const old=j.recording.recorder;j.recording.abort('pagehide');old.ondataavailable({data:new Blob(['late'])});old.onstop();assert.equal(j.recording.queue.length,0);assert.equal(j.recording.mode,'idle');assert.equal(j.timers.size,0);
});
test('revoked authorization stops recorder and capture; no background permission requests',async()=>{
 const h=harness(b=>b.action==='pulse'?{error:{context:{status:403,async json(){return{error:'Access denied'}}}}}:{data:{ok:true,active:true}});await h.recording.start(h.prepared,h.result);h.presence.active=false;await h.recording.pulse();await tick();await tick();assert.equal(h.video.readyState,'ended');assert.equal(h.recording.mode,'idle');assert.equal(h.calls.some(x=>x.action==='interrupt'),true);
});
