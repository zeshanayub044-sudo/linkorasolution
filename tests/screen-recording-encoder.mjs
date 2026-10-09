// Optional real-encoder acceptance test. Set PLAYWRIGHT_MODULE and EDGE_EXECUTABLE to installed tooling.
// Synthetic canvas only: this does not assert native screen-picker or production employee acceptance.
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end('<html><body><canvas id="screen" width="1280" height="720"></canvas><video id="player" muted></video></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_EXECUTABLE});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.addScriptTag({content:readFileSync('screen-recording.js','utf8')});
 const report=await page.evaluate(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),objects=new Map(),segments=[],canvas=document.getElementById('screen'),draw=canvas.getContext('2d');
  let frame=0;const render=()=>{draw.fillStyle='#081d31';draw.fillRect(0,0,1280,720);draw.fillStyle='#14d3ec';draw.font='32px sans-serif';draw.fillText('LINKORA work recording — synthetic acceptance test',40,70);draw.fillStyle='white';draw.font='24px monospace';draw.fillText('Readable work content · Frame '+frame++,40,125);draw.fillRect(40,180,frame%100+100,25)};render();const animation=setInterval(render,50);
  const stream=canvas.captureStream(10),cfg={target_fps:10,target_bitrate:500000,segment_seconds:60,max_segment_bytes:8388608,max_queue_bytes:25165824};
  const client={functions:{async invoke(name,{body:b}){if(b.action==='reserve'){segments[b.sequence-1]={...b,path:'private/segment-'+b.sequence+'.webm'};return{data:{path:segments[b.sequence-1].path,stored:objects.has(segments[b.sequence-1].path)}}}if(b.action==='finalize')return{data:{status:'finalizing'}};return{data:{ok:true,active:true}}}},auth:{async getSession(){return{data:{session:{access_token:'synthetic-test-token'}}}}}};
  window.TENNIS_PORTAL_CONFIG={supabaseUrl:'https://synthetic.invalid',supabaseAnonKey:'public-test'};
  window.fetch=async(url,o)=>{objects.set(url.split('employee-screen-recordings/')[1],o.body);return{ok:true}};
  const prepared=LinkoraRecording.prepare(stream,cfg),presence={active:true,tabId:'synthetic-tab'},rec=new LinkoraRecording.Recording(client,presence);
  await rec.start(prepared,{recording:{id:'synthetic',generation:1},config:cfg,nextSequence:1,serverTime:new Date().toISOString()});
  let maxQueue=0;for(let i=0;i<479;i++){await wait(125);const old=rec.recorder;rec.rotate();while(rec.recorder===old)await wait(1);await rec.started;maxQueue=Math.max(maxQueue,rec.queueBytes)}
  await wait(125);const result=await rec.stop('clock_out',true);clearInterval(animation);
  const video=document.getElementById('player');let decoded=0,seekChecked=false;let sampleBytes=0;
  for(let i=0;i<segments.length;i++){
   const blob=objects.get(segments[i].path);if(!blob||!blob.size)throw new Error('Missing video segment '+i);sampleBytes+=blob.size;const url=URL.createObjectURL(blob);
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Decode timeout '+i)),5000);video.onloadeddata=()=>{clearTimeout(timer);resolve()};video.onerror=()=>{clearTimeout(timer);reject(new Error('Decode failed '+i))};video.src=url;video.load()});decoded++;
   if(i===240){await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Seek failed')),5000);video.onseeked=()=>{clearTimeout(t);resolve()};video.currentTime=.04});seekChecked=true}
   // captureStream exposes any decoded audio tracks; this screen-only fixture must have none.
   if(video.captureStream?.().getAudioTracks().length)throw new Error('Unexpected audio');video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
  }
  return{codec:prepared.codec,segments:segments.length,decoded,bytes:sampleBytes,maxQueueBytes:maxQueue,audioTracks:stream.getAudioTracks().length,seekChecked,finalStatus:result.status,trackEnded:stream.getVideoTracks()[0].readyState==='ended',sequencesCorrect:segments.every((s,i)=>s.sequence===i+1)};
 });
 assert.equal(report.segments,480);assert.equal(report.decoded,480);assert.equal(report.audioTracks,0);assert.equal(report.seekChecked,true);assert.equal(report.sequencesCorrect,true);assert.equal(report.trackEnded,true);assert.equal(report.finalStatus,'finalizing');assert.ok(report.maxQueueBytes<25165824);console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
