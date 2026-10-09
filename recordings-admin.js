(function(){
 'use strict';const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e};
 const bytes=n=>{n=Number(n)||0;return n>=1e9?(n/1e9).toFixed(2)+' GB':n>=1e6?(n/1e6).toFixed(1)+' MB':Math.round(n/1e3)+' KB'},duration=n=>{n=Math.floor(Number(n)||0);return Math.floor(n/3600)+'h '+Math.floor(n%3600/60)+'m '+n%60+'s'};
 const badge=s=>el('span',(s||'none').replaceAll('_',' ').toUpperCase(),'badge '+(s==='recording'?'good':s==='completed'?'blue':['interrupted','incomplete','upload_issue','initializing','deleting'].includes(s)?'warn':'neutral'));
 const action=(label,fn)=>{const b=el('button',label,'table-action');b.type='button';b.addEventListener('click',fn);return b};
 class RecordingsAdmin{
  constructor(client,helpers){this.client=client;this.helpers=helpers;this.offset=0;this.today=new Map();this.running=false;this.epoch=0;this.viewerEpoch=0;this.historyOffset=0;
   $('recordings-filter').addEventListener('submit',e=>{e.preventDefault();this.offset=0;this.load().catch(e=>this.fail(e))});
   $('recordings-preset').addEventListener('change',()=>this.preset());
   $('recordings-next').addEventListener('click',()=>{this.offset+=25;this.load().catch(e=>this.fail(e))});
   $('recordings-previous').addEventListener('click',()=>{this.offset=Math.max(0,this.offset-25);this.load().catch(e=>this.fail(e))});
   $('recording-close').addEventListener('click',()=>this.closeViewer());$('recording-viewer').addEventListener('cancel',()=>this.closeViewer());
   $('recording-play').addEventListener('click',()=>{const v=$('recording-video');if(v.paused)v.play().catch(()=>this.message('Press Play to start the video.'));else v.pause()});
   $('recording-video').addEventListener('ended',()=>this.select(this.segmentIndex+1,true));
   $('recording-video').addEventListener('timeupdate',()=>{if(!this.currentSegment)return;const sec=this.prefix[this.segmentIndex]+$('recording-video').currentTime;$('recording-timeline').value=sec;$('recording-time').textContent=duration(sec)+' / '+duration(this.playDuration)});
   $('recording-video').addEventListener('play',()=>{$('recording-play').textContent='Pause'});$('recording-video').addEventListener('pause',()=>{$('recording-play').textContent='Play'});
   $('recording-video').addEventListener('error',()=>this.message('Video could not load. Re-select the segment to refresh authorized access.'));
   $('recording-timeline').addEventListener('change',()=>{const n=Number($('recording-timeline').value);let i=this.prefix.findLastIndex(p=>p<=n);this.select(Math.max(0,i),false,n-this.prefix[Math.max(0,i)])});
   $('recording-speed').addEventListener('change',()=>{$('recording-video').playbackRate=Number($('recording-speed').value)});
   $('recording-prev-segment').addEventListener('click',()=>this.select(this.segmentIndex-1,!$('recording-video').paused));$('recording-next-segment').addEventListener('click',()=>this.select(this.segmentIndex+1,!$('recording-video').paused));
   $('recording-fullscreen').addEventListener('click',()=> $('recording-video').requestFullscreen?.().catch(()=>this.message('Fullscreen is unavailable.')));
   $('recording-delete').addEventListener('click',()=>this.delete());
   $('recording-settings-form').addEventListener('submit',e=>{e.preventDefault();this.saveSettings().catch(e=>this.fail(e))});
   $('detail-recordings-filter').addEventListener('submit',e=>{e.preventDefault();this.historyOffset=0;this.loadHistory().catch(e=>this.fail(e))});
   $('detail-recordings-preset').addEventListener('change',()=>{this.preset('detail-recordings');this.historyOffset=0;this.loadHistory().catch(e=>this.fail(e))});
   $('detail-recordings-more').addEventListener('click',()=>{this.historyOffset+=25;this.loadHistory(true).catch(e=>this.fail(e))});
   window.addEventListener('pagehide',()=>this.stop());
  }
  api(action,payload){return window.LinkoraRecording.api(this.client,action,payload)}
  fail(e){$('recordings-message').textContent=e.message;if(e.status===401||e.status===403){this.stop();this.helpers.denied(e)}}
  setUsers(users){this.users=users;const selected=$('recordings-employee').value;$('recordings-employee').replaceChildren(el('option','All employees'));$('recordings-employee').firstChild.value='';for(const u of users){const o=el('option',u.fullName+' · '+u.employeeId);o.value=u.id;$('recordings-employee').append(o)}$('recordings-employee').value=selected;}
  start(users){this.running=true;++this.epoch;this.setUsers(users);this.preset();clearInterval(this.timer);this.timer=setInterval(()=>{if(!$('view-recordings').hidden)this.load().catch(e=>this.fail(e));this.refreshBadges().catch(e=>this.fail(e))},15000);this.refreshBadges().catch(e=>this.fail(e))}
  stop(){this.running=false;++this.epoch;clearInterval(this.timer);this.closeViewer();this.today.clear();$('recordings-body').replaceChildren();$('detail-recordings-body').replaceChildren()}
  shift(day,n){return new Date(new Date(day+'T12:00:00Z').getTime()+n*864e5).toISOString().slice(0,10)}
  preset(prefix='recordings'){
   const day=this.helpers.day(),kind=$(prefix+'-preset').value;let from=day,to=day;
   if(kind==='custom')return;
   if(kind==='yesterday')from=to=this.shift(day,-1);if(kind==='7')from=this.shift(day,-6);if(kind==='30')from=this.shift(day,-29);if(kind==='90')from=this.shift(day,-89);
   if(kind==='month')from=day.slice(0,7)+'-01';
   if(kind==='previous'){to=this.shift(day.slice(0,7)+'-01',-1);from=to.slice(0,7)+'-01'}
   $(prefix+'-from').value=from;$(prefix+'-to').value=to;
  }
  async refreshBadges(){if(!this.running||this.badgeBusy)return;this.badgeBusy=true;const epoch=this.epoch;try{const d=await this.api('statuses',{});if(epoch!==this.epoch)return;this.today=new Map(d.rows.map(r=>[r.employee_id,r]));this.helpers.badges?.()}finally{this.badgeBusy=false}}
  recordingBadge(id){const r=this.today.get(id);if(!r)return badge('none');const b=action(r.status.replaceAll('_',' ').toUpperCase(),()=>this.open(r.id));b.classList.add('recording-badge-action');return b}
  async load(){if(!this.running||this.loading)return;this.loading=true;const epoch=this.epoch;$('recordings-message').textContent='Loading private recording history…';
   try{const d=await this.api('list',{from:$('recordings-from').value,to:$('recordings-to').value,employeeId:$('recordings-employee').value||null,status:$('recordings-status').value,search:$('recordings-search').value,offset:this.offset,limit:25});if(epoch!==this.epoch)return;
    const body=$('recordings-body');body.replaceChildren();for(const r of d.rows)this.row(body,r);
    if(!d.rows.length)this.empty(body,13,'No recordings match this range.');const total=Number(d.rows[0]?.filtered_total||0);$('recordings-previous').disabled=!this.offset;$('recordings-next').disabled=this.offset+d.rows.length>=total;$('recordings-message').textContent=(d.rows.length?'Showing '+(this.offset+1)+'–'+(this.offset+d.rows.length)+' of '+total:'No recordings')+' · '+d.timezone;
    this.summary(d.summary);if(!this.config){this.config=await this.api('config');this.renderSettings()}
   }finally{this.loading=false}
  }
  empty(body,count,text){const tr=el('tr'),td=el('td',text,'empty-state');td.colSpan=count;tr.append(td);body.append(tr)}
  row(body,r){const tr=el('tr');const vals=[r.full_name+' · '+r.employee_code,this.helpers.timestamp(r.started_at).split(',')[0],this.helpers.timestamp(r.login_at),this.helpers.timestamp(r.logout_at),this.helpers.timestamp(r.started_at),this.helpers.timestamp(r.ended_at),duration(r.total_duration_seconds),null,r.total_segments,bytes(r.total_size_bytes),this.helpers.timestamp(r.retention_until),r.termination_reason||'—'];for(const v of vals){const td=el('td',v);if(v===null)td.append(badge(r.status));tr.append(td)}const td=el('td');td.append(action('View / Details',()=>this.open(r.id)));tr.append(td);body.append(tr)}
  summary(s){const grid=$('recordings-summary');grid.replaceChildren();for(const[label,value]of [['Recordings today',s.today],['Currently recording',s.recording],['Completed today',s.completedToday],['Interrupted / issues',s.interrupted],['Storage used',bytes(s.storageBytes)],['Expiring within 7 days',s.expiringSoon]]){const c=el('div',null,'metric');c.append(el('span',label),el('strong',value));grid.append(c)}
   $('recordings-capacity').textContent='Last 30 days: '+bytes(s.last30Bytes)+' · Estimated 90 days (8-hour shifts, 26 workdays/month): '+bytes(s.estimated90Bytes)+' · Recording budget: '+bytes(s.budgetBytes)+' · Oldest: '+this.helpers.timestamp(s.oldest)+'. '+(s.overdueCleanup?s.overdueCleanup+' expired recording(s) await storage cleanup. ':'')+(s.budgetBytes&&s.storageBytes>=s.budgetBytes*.8?'Warning: recording storage budget is at least 80% used. ':'')+(s.enabled?'Recording enabled.':'Recording is disabled pending approved storage capacity and monitoring policy.');
  }
  async open(id){this.closeViewer();const epoch=++this.viewerEpoch;this.recordingId=id;$('recording-viewer').showModal();this.message('Checking Co-CEO access…');$('recording-title').textContent='Screen recording';$('recording-segments').replaceChildren();
   try{const d=await this.api('detail',{recordingId:id});if(epoch!==this.viewerEpoch)return;const r=d.recording;this.detail=d;
    $('recording-title').textContent=r.full_name+' · '+r.employee_code;
    $('recording-meta').textContent='Attendance session: '+r.attendance_session_id+' · Clock In '+this.helpers.timestamp(r.login_at)+' · Clock Out '+this.helpers.timestamp(r.logout_at)+' · Recording '+this.helpers.timestamp(r.started_at)+' – '+this.helpers.timestamp(r.ended_at)+' · Stored video '+duration(r.total_duration_seconds)+' · '+r.status.toUpperCase()+' · Expected segments '+(r.expected_segments??'unknown final tail')+' / stored '+r.total_segments+' · Expires '+this.helpers.timestamp(r.retention_until);
    this.segments=d.segments.filter(s=>s.upload_status==='stored');this.prefix=[];this.playDuration=0;for(const s of this.segments){this.prefix.push(this.playDuration);this.playDuration+=Number(s.duration_seconds)}$('recording-timeline').max=Math.max(1,this.playDuration);$('recording-timeline').value=0;
    d.segments.forEach(s=>{const item=el('li');item.append(el('span','Segment '+s.sequence_number+' · '+this.helpers.timestamp(s.started_at)+' · '+duration(s.duration_seconds)+' · '+s.upload_status.toUpperCase()));if(s.upload_status==='stored'&& !['deleted','expired','deleting'].includes(r.status))item.append(action('Play',()=>this.select(this.segments.findIndex(v=>v.id===s.id),true)));$('recording-segments').append(item)});
    const eventList=$('recording-events');eventList.replaceChildren();for(const e of d.events){const item=el('li',this.helpers.timestamp(e.created_at)+' · '+e.event.replaceAll('_',' ')+(e.actor_name?' · '+e.actor_name:e.actor_id?' · '+e.actor_id:' · server')+(e.details.reason?' · '+e.details.reason:''));eventList.append(item)}
    $('recording-delete').disabled=r.logout_at === null || ['recording','initializing','upload_issue','finalizing','deleted','expired','deleting'].includes(r.status);
    this.message(['expired','deleted','deleting'].includes(r.status)?'Video is expired, deleted or being removed. Minimal audit metadata remains.':!this.segments.length?'No verified uploaded video is available.':r.status==='completed'?'Verified stored segments. Press Play to review.':'Incomplete or interrupted recording: uploaded video is preserved. Gaps and missing segments are shown below.');
    if(this.segments.length&&!['expired','deleted','deleting'].includes(r.status))await this.select(0,false);
    this.viewerTimer=setInterval(async()=>{try{const fresh=await this.api('detail',{recordingId:id});if(['deleted','expired','deleting'].includes(fresh.recording.status)||new Date(fresh.recording.retention_until)<=new Date())this.closeViewer()}catch(e){this.closeViewer();this.fail(e)}},15000);
   }catch(e){if(epoch===this.viewerEpoch)this.message(e.message);if(e.status===401||e.status===403)this.fail(e)}
  }
  async select(index,play,seek=0){if(!this.segments||index<0||index>=this.segments.length)return;const epoch=this.viewerEpoch;const request=++this.selectionEpoch;const segment=this.segments[index];this.message('Loading segment '+segment.sequence_number+'…');
   try{const access=await this.api('playback',{recordingId:this.recordingId,sequence:segment.sequence_number});if(epoch!==this.viewerEpoch||request!==this.selectionEpoch)return;
    const v=$('recording-video');v.pause();v.removeAttribute('src');v.load();this.currentSegment=segment;this.segmentIndex=index;v.src=access.url;v.playbackRate=Number($('recording-speed').value);
    v.onloadedmetadata=()=>{if(seek>0)v.currentTime=seek;if(play)v.play().catch(()=>this.message('Press Play to start this segment.'))};
    $('recording-prev-segment').disabled=index===0;$('recording-next-segment').disabled=index===this.segments.length-1;this.message('Segment '+segment.sequence_number+' of '+this.detail.segments.length+' · Automatic chronological progression · Private access expires in '+access.expiresIn+' seconds.');
   }catch(e){if(epoch===this.viewerEpoch)this.message(e.message);if(e.status===401||e.status===403)this.fail(e)}
  }
  message(text){$('recording-viewer-message').textContent=text}
  closeViewer(){++this.viewerEpoch;this.selectionEpoch=0;clearInterval(this.viewerTimer);const v=$('recording-video');v.pause();v.onloadedmetadata=null;v.removeAttribute('src');v.load();this.currentSegment=null;this.segments=null;if($('recording-viewer').open)$('recording-viewer').close()}
  async delete(){if(!confirm('Permanently delete this recording? This permanently removes stored screen video and cannot be undone.'))return;
   try{await this.api('delete',{recordingId:this.recordingId,confirmed:true});this.closeViewer();this.load().catch(e=>this.fail(e));$('recordings-message').textContent='Deletion queued. Access is blocked immediately; the server verifies object removal.'}catch(e){this.message(e.message)}
  }
  renderSettings(){const f=$('recording-settings-form'),c=this.config;f.elements.enabled.checked=c.enabled;f.elements.policyReady.checked=c.policy_ready;f.elements.budget.value=c.storage_budget_bytes/1e9;f.elements.bitrate.value=c.target_bitrate;f.elements.fps.value=c.target_fps;f.elements.notice.value=c.notice}
  async saveSettings(){const f=$('recording-settings-form');if(!f.reportValidity())return;const c=await this.api('settings',{enabled:f.elements.enabled.checked,policyReady:f.elements.policyReady.checked,storageBudgetBytes:Math.round(Number(f.elements.budget.value)*1e9),bitrate:Number(f.elements.bitrate.value),fps:Number(f.elements.fps.value),notice:f.elements.notice.value.trim()});this.config=c;this.renderSettings();$('recording-settings-message').textContent='Monitoring policy saved and audited. Employees acknowledge the current notice before starting or resuming.';this.load().catch(e=>this.fail(e))}
  async employeeHistory(id){this.historyEmployee=id;this.historyOffset=0;this.preset('detail-recordings');$('detail-recordings-body').replaceChildren();await this.loadHistory()}
  async loadHistory(append=false){const id=this.historyEmployee;const d=await this.api('list',{employeeId:id,from:$('detail-recordings-from').value,to:$('detail-recordings-to').value,offset:this.historyOffset,limit:25});if(id!==this.historyEmployee||!$('detail-dialog').open)return;const body=$('detail-recordings-body');if(!append)body.replaceChildren();for(const r of d.rows){const tr=el('tr');for(const v of [this.helpers.timestamp(r.started_at),duration(r.total_duration_seconds)])tr.append(el('td',v));const status=el('td');status.append(badge(r.status));tr.append(status);const td=el('td');td.append(action('View Recording',()=>this.open(r.id)));tr.append(td);body.append(tr)}if(!body.children.length)this.empty(body,4,'No recordings in this date range.');$('detail-recordings-more').hidden=this.historyOffset+d.rows.length>=Number(d.rows[0]?.filtered_total||0)}
 }
 window.LinkoraRecordingsAdmin=RecordingsAdmin;
}());
