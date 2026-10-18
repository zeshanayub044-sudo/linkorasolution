import {readFileSync,writeFileSync} from 'node:fs';
const read=f=>readFileSync(f,'utf8');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const services=JSON.parse(read('content/services.json'));
export function leadForm(selected='Not sure yet',prefix='lead') {
 const options=['On-Page SEO','Off-Page SEO','Backlinks','Guest Posting','Blog Writing','DA Increase','Guest Post Sites Sheet','Technical SEO','Google Business Profile (GMB)','Web Development','12-Website Monthly SEO Plan — $1,000/month','Not sure yet'];
 return `<form class="lead-form" data-lead-form>
 <div class="field"><label for="${prefix}-name">Name *</label><input id="${prefix}-name" name="name" autocomplete="name" maxlength="120" required></div>
 <div class="field"><label for="${prefix}-email">Business email *</label><input id="${prefix}-email" name="email" type="email" autocomplete="email" maxlength="254" required></div>
 <div class="field"><label for="${prefix}-phone">Phone / WhatsApp (optional)</label><input id="${prefix}-phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div>
 <div class="field"><label for="${prefix}-company">Company (optional)</label><input id="${prefix}-company" name="company" autocomplete="organization" maxlength="160"></div>
 <div class="field"><label for="${prefix}-website">Website URL (optional)</label><input id="${prefix}-website" name="website" type="url" placeholder="https://yourwebsite.com" maxlength="500"></div>
 <div class="field"><label for="${prefix}-service">Service interested in *</label><select id="${prefix}-service" name="service" required>${options.map(o=>`<option${o===selected?' selected':''}>${escape(o)}</option>`).join('')}</select></div>
 <div class="field wide"><label for="${prefix}-budget">Approximate budget (optional)</label><input id="${prefix}-budget" name="budget" maxlength="120" placeholder="Your range and currency, or tell us you need guidance"></div>
 <div class="field wide"><label for="${prefix}-message">What would you like to achieve? *</label><textarea id="${prefix}-message" name="message" maxlength="4000" rows="4" required></textarea></div>
 <div class="trap" aria-hidden="true"><label>Leave this field empty<input name="company_site" tabindex="-1" autocomplete="off"></label></div>
 <p class="form-note wide">We use your details to review and respond to this inquiry. Please do not include passwords or confidential client data. <a href="privacy.html" target="_blank" rel="noopener noreferrer">How we handle inquiry data</a></p>
 <button class="btn btn-gold wide" type="submit">Request a Quote</button><p class="wide" data-lead-status role="status" aria-live="polite"></p>
 </form>`;
}
const index=read('index.html'),header=index.match(/<header[\s\S]*?<\/header>/)[0].replace(' class="active"','');
for(const s of services){
 const url='https://linkorasolution.com/'+s.slug+'.html',name=s.name+' | LINKORA SOLUTION';
 const schema={'@context':'https://schema.org','@graph':[{'@type':'Service',name:s.name,description:s.description,url,provider:{'@type':'Organization',name:'LINKORA SOLUTION',url:'https://linkorasolution.com/'}},{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:'https://linkorasolution.com/'},{'@type':'ListItem',position:2,name:'Services',item:'https://linkorasolution.com/services.html'},{'@type':'ListItem',position:3,name:s.name,item:url}]}]};
 const a=(href,label)=>`<a class="btn btn-ghost" href="${href}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
 const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(name)}</title><meta name="description" content="${escape(s.description)}"><link rel="canonical" href="${url}"><meta name="robots" content="index,follow"><meta property="og:type" content="website"><meta property="og:site_name" content="LINKORA SOLUTION"><meta property="og:title" content="${escape(name)}"><meta property="og:description" content="${escape(s.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="https://linkorasolution.com/assets/linkora-mark.png"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(name)}"><meta name="twitter:description" content="${escape(s.description)}"><meta name="twitter:image" content="https://linkorasolution.com/assets/linkora-mark.png"><link rel="icon" href="assets/favicon.ico?v=2"><link rel="apple-touch-icon" href="assets/apple-touch-icon.png?v=2"><link rel="manifest" href="site.webmanifest?v=3"><meta name="theme-color" content="#0a0e14"><link rel="stylesheet" href="styles.css?v=6"><link rel="stylesheet" href="growth.css?v=1"><script type="application/ld+json">${JSON.stringify(schema).replaceAll('<','\\u003c')}</script><script src="marketing-config.js" defer></script><script src="marketing.js?v=1" defer></script></head>
 <body data-service="${escape(s.service)}">${header}<main>
 <section class="growth-hero"><div class="wrap"><p class="growth-kicker">${escape(s.name)}</p><h1>${escape(s.title)}</h1><p class="lead">${escape(s.intro)}</p><div class="hero-cta"><a class="btn btn-gold btn-lg" href="#request-quote" data-service-cta>Request a Quote</a>${a('services.html','Compare Services')}</div></div></section>
 <section class="border-top"><div class="wrap growth-grid"><article class="card"><h2>The problem we address</h2><p>${escape(s.problem)}</p></article><article class="card"><h2>What the service includes</h2><p>${escape(s.overview)}</p></article></div></section>
 <section><div class="wrap growth-grid"><article><h2>Clear deliverables</h2><ul>${s.deliverables.map(d=>`<li>${escape(d)}</li>`).join('')}</ul></article><article><h2>Our process</h2><ol>${s.process.map(d=>`<li>${escape(d)}</li>`).join('')}</ol></article></div></section>
 <section class="border-top"><div class="wrap growth-grid"><article class="card"><h2>Benefits that matter</h2><p>${escape(s.benefits)}</p></article><article class="card"><h2>Who it is for</h2><p>${escape(s.audience)}</p></article></div></section>
 <section><div class="wrap growth-copy"><h2>Why discuss your project with LINKORA SOLUTION?</h2><p>Start with a clear service scope, a practical process and reporting you can review. Our existing service overview shows what can be included, and the proposal should identify responsibilities, approvals and exclusions before work begins. Meet the leadership and discuss whether the approach fits your business.</p><div class="growth-related">${a('about.html','Meet the Leadership')}${a('services.html','View Packages and Scope')}</div><p class="growth-disclosure">Search results, publisher decisions and customer behavior are outside an agency’s control. Paid placements should use appropriate sponsored or nofollow attributes. No ranking, revenue or review-score guarantee is made.</p></div></section>
 <section class="border-top"><div class="wrap growth-faq"><h2>Questions before you start</h2>${s.faq.map(([q,a])=>`<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join('')}</div></section>
 <section id="request-quote"><div class="wrap"><div class="section-head"><span class="mono">Discuss your project</span><h2>Tell us what you want to improve.</h2><p>Share your website, priorities and constraints. We’ll review the requirements before recommending a scope.</p></div>${leadForm(s.service,s.slug)}<div class="growth-related">${a('https://wa.me/923216308339?text='+encodeURIComponent('Hello LINKORA SOLUTION, I would like to discuss '+s.service+'.'),'Discuss on WhatsApp')}${services.filter(o=>o.slug!==s.slug).map(o=>a(o.slug+'.html',o.name)).join('')}</div></div></section>
 </main><footer></footer><script src="script.js?v=9"></script></body></html>\n`;
 writeFileSync(s.slug+'.html',html);
}
// The Contact page uses the same validated form contract as the service pages.
let contact=read('contact.html').replace(/<form class="contact-form[\s\S]*?<\/form>/,leadForm()).replace(/<script>\s*function sendToWhatsApp[\s\S]*?<\/script>/,'');
contact=contact.replace('Within 24 hours on WhatsApp and email, Monday–Saturday.','Send your requirements and our team will review them before responding.');
writeFileSync('contact.html',contact);
console.log('Built four service pages and the shared Contact form.');
