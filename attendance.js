(() => {
  const config = window.LINKORA_GOOGLE_ACTIVITY_CONFIG || {};
  const app = document.querySelector('#app');
  const region = document.querySelector('#toast-region');
  const key = 'linkora-google-session-v1';
  let session = read();

  function read() { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } }
  function save(value) { session=value; value ? sessionStorage.setItem(key,JSON.stringify(value)) : sessionStorage.removeItem(key); }
  function safe(value='') { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(message, kind='success') { const node=document.createElement('div');node.className=`toast ${kind}`;node.textContent=message;region.append(node);setTimeout(()=>node.remove(),4500); }
  function configured() { return /^https:\/\/script\.google\.com\/macros\/s\//.test(config.apiUrl||'') && /\.apps\.googleusercontent\.com$/.test(config.googleClientId||''); }
  function clock() { return new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()); }

  async function log(action, data, keepalive=false) {
    if (!configured()) return false;
    try {
      const body=JSON.stringify({action,...data});
      if (keepalive && navigator.sendBeacon) return navigator.sendBeacon(config.apiUrl,new Blob([body],{type:'text/plain;charset=UTF-8'}));
      await fetch(config.apiUrl,{method:'POST',mode:'no-cors',body,headers:{'Content-Type':'text/plain;charset=UTF-8'},keepalive:true});
      return true;
    } catch (error) { console.warn('Activity log unavailable',error); return false; }
  }
  function loginView() {
    app.innerHTML=`<div class="login-page"><section class="login-hero"><div class="wordmark">LINKORA <b>SOLUTIONS</b></div><div><h1>Welcome to the staff portal.</h1><p>Use your approved Google work account. Login and logout times are recorded automatically.</p></div><div class="secure-note">◈ Linkora uses Google’s secure sign-in. Your password is never stored by Linkora.</div></section><section class="login-panel"><div class="login-card"><a class="back-link" href="index.html">← Back to website</a><h2>Sign in</h2><p>Continue with the Google account approved by your administrator.</p><div id="google-signin" class="google-signin"></div><p class="signin-help" id="help"></p></div></section></div>`;
    if (!configured()) { document.querySelector('#help').textContent='This portal is being configured. Please contact your administrator.'; return; }
    loadGoogle();
  }
  function loadGoogle(attempt=0) {
    if (window.google?.accounts?.id) {
      google.accounts.id.initialize({client_id:config.googleClientId,callback:onLogin,auto_select:false,cancel_on_tap_outside:true,use_fedcm_for_prompt:true});
      google.accounts.id.renderButton(document.querySelector('#google-signin'),{theme:'outline',size:'large',type:'standard',text:'signin_with',shape:'rect',width:300});
    } else if (attempt<50) setTimeout(()=>loadGoogle(attempt+1),100);
    else document.querySelector('#help').textContent='Google Sign-In could not load. Please refresh and try again.';
  }
  function onLogin(response) {
    let user;
    try { user=JSON.parse(atob(response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { toast('Google sign-in could not be read. Please try again.','error'); return; }
    if (!user.email || !user.name) { toast('Your Google account did not provide the required profile information.','error'); return; }
    save({id:crypto.randomUUID(),name:user.name,email:user.email,credential:response.credential,loginAt:new Date().toISOString()});
    void log('login',session);
    portalView();
    toast('Signed in successfully. Your login is being recorded.');
  }
  function portalView() {
    if (!session) return loginView();
    const short=safe(session.name.split(' ')[0]), initials=safe(session.name.split(' ').map(x=>x[0]).slice(0,2).join(''));
    app.innerHTML=`<div class="portal simple-portal"><aside class="sidebar"><div class="wordmark">LINKORA <b>SOLUTIONS</b></div><div class="sidebar-bottom">Signed in as<br><b>${safe(session.name)}</b><br><span>${safe(session.email)}</span></div></aside><div class="content"><header class="topbar"><div class="page-title"><h1>Welcome, ${short}</h1><p>Your session is active and is recorded in the Linkora activity log.</p></div><div class="avatar">${initials}</div></header><main class="page"><section class="card status-card"><div><div class="subtle"><i class="status-dot"></i> Currently signed in</div><h2>Your session is active.</h2><p class="subtle">Started at ${new Date(session.loginAt).toLocaleString()}</p><div class="attendance-actions"><button class="primary-btn" id="signout">Sign out</button></div></div><div><div class="time-display" id="clock">${clock()}</div><div class="time-date">Linkora Solutions</div></div></section><section class="card section-gap"><h2>Activity logging</h2><p class="subtle">Your sign-in and sign-out times are saved in Linkora’s private activity spreadsheet. A temporary logging issue never blocks access.</p></section></main></div></div>`;
    document.querySelector('#signout').onclick=signout;
    clearInterval(window.linkoraClock);window.linkoraClock=setInterval(()=>{const node=document.querySelector('#clock');if(node)node.textContent=clock();},1000);
  }
  function signout() {
    const closing=session;save(null);clearInterval(window.linkoraClock);
    if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();
    void log('logout',closing,true);loginView();toast('You have been signed out. Your activity row is being updated.');
  }
  window.addEventListener('pagehide',()=>{if(session)void log('logout',session,true);});
  if (session) { void log('login',session); portalView(); } else loginView();
})();
