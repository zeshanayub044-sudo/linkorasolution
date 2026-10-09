(function () {
 'use strict';
 const api=async(client,action,payload={})=>{
  const result=await client.functions.invoke('workforce-recordings',{body:{action,...payload},signal:AbortSignal.timeout(12000)});
  if(result.error){let detail;try{detail=await result.error.context.json()}catch{/* safe fallback */}const e=new Error(detail?.error||'Recording connection unavailable.');e.status=result.error.context?.status;throw e;}
  return result.data;
 };
 const stopTracks=stream=>stream?.getTracks().forEach(t=>t.stop());
 function prepare(stream,config){
  if(!window.MediaRecorder)throw new Error('This browser cannot record work sessions. Use a supported desktop browser.');
  stream.getAudioTracks().forEach(t=>{t.stop();stream.removeTrack(t)});
  const track=stream.getVideoTracks()[0];if(!track||track.readyState==='ended')throw new Error('Screen sharing ended. Try again.');
  const surface=track.getSettings?.().displaySurface;
  if(surface&&surface!=='monitor'){stopTracks(stream);throw new Error('Please select Entire Screen, not a tab or application window.');}
  const codec=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4;codecs=avc1.42E01E','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
  if(!codec){stopTracks(stream);throw new Error('No supported screen-video recording format is available.');}
  const video=new MediaStream(stream.getVideoTracks());
  const options={mimeType:codec,videoBitsPerSecond:config.target_bitrate};
  // Constructor validates support before attendance; start() waits for an authorized work session.
  const recorder=new MediaRecorder(video,options);
  return {stream:video,recorder,options,codec,mimeType:codec.split(';')[0],displaySurface:surface||'unknown'};
 }
 class Recording {
  constructor(client,presence,onState){this.client=client;this.presence=presence;this.onState=onState||(()=>{});this.queue=[];this.queueBytes=0;this.mode='idle';this.uploading=false;this.parts=[];this.partBytes=0;this.generation=0;this.failed=false;this.epoch=0;
   window.addEventListener('pagehide',()=>this.abort('portal_closed'));
   window.addEventListener('online',()=>{for(const q of this.queue)q.nextAttempt=0;this.drain()});
  }
  payload(extra={}){return{recordingId:this.id,tabId:this.presence.tabId,generation:this.generation,...extra}}
  notify(state,message){this.onState({state,message,pending:this.queue.length,bytes:this.queueBytes,recordingId:this.id})}
  async start(prepared,result){
   if(this.mode!=='idle')throw new Error('Finish the current recording first.');
   this.prepared=prepared;this.stream=prepared.stream;this.id=result.recording.id;this.generation=result.recording.generation;
   this.config=result.config;this.nextSequence=result.nextSequence;this.lastSequence=result.nextSequence-1;this.failed=false;this.mode='starting';
   this.serverStart=new Date(result.serverTime).getTime();this.localStart=performance.now();
   await prepared.stream.getVideoTracks()[0].applyConstraints?.({width:{ideal:1280,max:1920},height:{ideal:720,max:1080},frameRate:{ideal:this.config.target_fps,max:15}}).catch(()=>{});
   this.startSegment(prepared.recorder);
   await this.started;
   await api(this.client,'activate',this.payload());
   this.mode='recording';this.notify('recording','● SCREEN RECORDING ACTIVE · Screen video only');
   this.pulseTimer=setInterval(()=>this.pulse(),5000);this.retryTimer=setInterval(()=>this.drain(),1000);
  }
  clock(){return this.serverStart+performance.now()-this.localStart}
  startSegment(recorder){
   const epoch=this.epoch;
   this.recorder=recorder||new MediaRecorder(this.prepared.stream,this.prepared.options);this.parts=[];this.partBytes=0;
   this.segmentStart=this.clock();this.segmentStopped=new Promise(resolve=>{this.resolveStopped=resolve});
   this.started=new Promise((resolve,reject)=>{this.recorder.onstart=resolve;this.rejectStart=reject});this.started.catch(()=>{});
   this.recorder.ondataavailable=e=>{if(epoch!==this.epoch||!e.data.size)return;this.parts.push(e.data);this.partBytes+=e.data.size;
    if(this.partBytes>this.config.max_segment_bytes){this.issue('segment_size_limit');this.stop('segment_size_limit');}
    else if(this.partBytes>=6000000&&this.recorder.state==='recording')this.rotate();};
   this.recorder.onerror=()=>{this.rejectStart(new Error('Recording encoder failed.'));this.issue('encoder_failed');this.stop('encoder_failed');};
   this.recorder.onstop=()=>{
    if(epoch!==this.epoch)return;
    clearTimeout(this.segmentTimer);this.segmentTimer=null;
    const end=this.clock(),duration=Math.max(.001,(end-this.segmentStart)/1000);
    const blob=new Blob(this.parts,{type:this.prepared.mimeType});this.parts=[];this.partBytes=0;
    if(blob.size){this.lastSequence=this.nextSequence++;const item={blob,sequence:this.lastSequence,endedAt:new Date(end).toISOString(),durationSeconds:Math.min(180,Math.round(duration*1000)/1000),attempts:0,nextAttempt:0};
     if(blob.size>this.config.max_segment_bytes||this.queue.length>=6||this.queueBytes+blob.size>this.config.max_queue_bytes){this.issue('bounded_queue_limit',item.sequence);this.failed=true;this.mode='interrupting';}
     else{this.queue.push(item);this.queueBytes+=blob.size;this.drain();}}
    this.resolveStopped?.();
    if(this.mode==='recording'||this.mode==='starting'){try{this.startSegment()}catch{this.stop('encoder_failed')}}
    else if(this.mode==='interrupting'&&!this.stopping)this.stop('bounded_queue_limit');
   };
   this.recorder.start(1000);
   // Every rotation calls stop(), producing an independently playable file with its own container header.
   this.segmentTimer=setTimeout(()=>this.rotate(),this.config.segment_seconds*1000);
  }
  rotate(){if(this.recorder?.state==='recording')this.recorder.stop()}
  async pulse(){if(!['recording','finalizing','starting','interrupting'].includes(this.mode)||this.pulsing)return;this.pulsing=true;
   try{const r=await api(this.client,'pulse',this.payload());if(!r.active)this.stop('authorization_ended')}
   catch(e){if(e.status===401||e.status===403)this.stop('authorization_ended');else this.notify('upload_issue','Recording upload connection issue. Retrying; attendance follows its existing heartbeat policy.');}
   finally{this.pulsing=false}
  }
  issue(reason,sequence){this.failed=true;this.notify('upload_issue','Recording upload connection issue. Pending video is bounded; please restore connection or Clock Out.');
   if(this.lastIssue===reason)return;this.lastIssue=reason;api(this.client,'issue',this.payload({reason,sequence})).catch(()=>{});
  }
  async drain(){
   if(this.uploading||!this.queue.length||!this.presence.active)return;
   const epoch=this.epoch;const q=this.queue[0];if(q.nextAttempt>Date.now())return;this.uploading=true;
   try{
    const reserved=await api(this.client,'reserve',this.payload({sequence:q.sequence,sizeBytes:q.blob.size,durationSeconds:q.durationSeconds,endedAt:q.endedAt}));
    if(!reserved.stored){
     const identity=await this.client.auth.getSession();const token=identity.data.session?.access_token;if(!token)throw new Error('Sign in again.');
     const cfg=window.TENNIS_PORTAL_CONFIG;
     const response=await fetch(cfg.supabaseUrl+'/storage/v1/object/employee-screen-recordings/'+reserved.path,{method:'POST',headers:{Authorization:'Bearer '+token,apikey:cfg.supabaseAnonKey,'Content-Type':this.prepared.mimeType,'x-upsert':'false','cache-control':'no-store'},body:q.blob,signal:AbortSignal.timeout(12000)});
     if(!response.ok){let detail;try{detail=await response.json()}catch{/* safe fallback */}
      // Existing immutable object is accepted only after the backend verifies its exact reserved byte size.
      if(!['409','Duplicate','ResourceAlreadyExists'].includes(String(detail?.statusCode||detail?.error))&&!/already exists/i.test(detail?.message||''))throw new Error('Recording upload failed.');}
    }
    await api(this.client,'commit',this.payload({sequence:q.sequence}));
    if(epoch!==this.epoch)return;this.queue.shift();this.queueBytes-=q.blob.size;q.blob=null;
    if(this.mode==='recording')this.notify(this.failed?'upload_issue':'recording',this.failed?'Recording active · Prior upload incident will be visible to management.':'● SCREEN RECORDING ACTIVE · Screen video only');
   }catch(e){if(epoch!==this.epoch)return;q.attempts++;q.nextAttempt=Date.now()+Math.min(30000,1000*2**Math.min(q.attempts,5));this.issue('segment_upload_failed',q.sequence);
    if(q.attempts>=5||e.status===401||e.status===403){this.failed=true;this.stop(e.status===403?'authorization_ended':'upload_retry_limit');}}
   finally{this.uploading=false}
   if(this.queue.length&&this.queue[0].nextAttempt<=Date.now())this.drain();
  }
  async stop(reason='screen_share_stopped',finalize=false){
   if(this.stopping)return this.stopping;if(this.mode==='idle')return{status:'none'};
   this.stopping=this.finish(reason,finalize);try{return await this.stopping}finally{this.stopping=null}
  }
  async finish(reason,finalize){
   this.mode=finalize?'finalizing':'interrupting';clearTimeout(this.segmentTimer);this.segmentTimer=null;
   this.notify(this.mode,finalize?'Finalizing work session…':'Screen sharing stopped. Your work session requires screen sharing. Resume screen sharing or Clock Out.');
   if(this.recorder&&this.recorder.state!=='inactive'){this.recorder.stop();let stopTimer;await Promise.race([this.segmentStopped,new Promise(r=>{stopTimer=setTimeout(r,2000)})]);clearTimeout(stopTimer);}
   stopTracks(this.stream); // Capture ends immediately, independent of upload/network success.
   const captureEndedAt=new Date(this.clock()).toISOString();
   const deadline=Date.now()+15000;for(const q of this.queue)q.nextAttempt=0;
   while(this.queue.length&&this.presence.active&&Date.now()<deadline){this.drain();await new Promise(r=>setTimeout(r,200));}
   let result={status:'incomplete'};
   try{result=await api(this.client,finalize?'finalize':'interrupt',this.payload({expectedSegments:this.lastSequence,endedAt:captureEndedAt,reason}));}
   catch{this.failed=true;this.notify('interrupted','Recording could not be finalized. Uploaded segments are preserved; server cleanup will mark the interruption.');}
   this.clear();this.notify(finalize?result.status:'interrupted',finalize?(result.status==='finalizing'?'Recording uploaded. Saving Clock Out…':result.status==='completed'?'Recording finalized.':'Recording incomplete. Uploaded segments are preserved.'):'Screen sharing stopped. Your work session requires screen sharing. Resume screen sharing or Clock Out.');
   return result;
  }
  clear(){++this.epoch;clearInterval(this.pulseTimer);clearInterval(this.retryTimer);clearTimeout(this.segmentTimer);this.pulseTimer=null;this.retryTimer=null;this.mode='idle';this.recorder=null;this.queue=[];this.queueBytes=0;this.parts=[];this.partBytes=0;}
  abort(reason){this.mode='interrupting';clearTimeout(this.segmentTimer);if(this.recorder?.state==='recording')this.recorder.stop();stopTracks(this.stream);this.clear();this.notify('interrupted','Recording stopped: '+reason+'. Already uploaded video is preserved.');}
 }
 window.LinkoraRecording={api,prepare,Recording};
}());
