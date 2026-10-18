(function () {
 'use strict';
 document.addEventListener('DOMContentLoaded',async function () {
  var host=document.querySelector('[data-proof]');if(!host)return;
  try {
   var response=await fetch('content/proof.json');if(!response.ok)return;
   var data=await response.json();if(!data.enabled)return;
   var entries=[...(data.testimonials||[]),...(data.caseStudies||[]),...(data.portfolio||[])].filter(function (entry) {return entry.verified===true&&entry.approvedForPublication===true&&entry.name&&entry.evidence&&entry.summary;});
   if(!entries.length)return;
   var grid=document.createElement('div');grid.className='proof-grid';
   entries.forEach(function (entry) {
    // Evidence is a reviewed public URL; no HTML from configuration is executed.
    var url=new URL(entry.evidence,location.href);if(url.protocol!=='https:'||url.username||url.password)return;
    var card=document.createElement('article');card.className='card';
    var title=document.createElement('h3');title.textContent=entry.name;card.appendChild(title);
    ['industry','challenge','workPerformed','strategy','results','timePeriod','servicesUsed','summary'].forEach(function (key) {if(!entry[key])return;var p=document.createElement('p');p.textContent=Array.isArray(entry[key])?entry[key].join(', '):entry[key];card.appendChild(p);});
    var link=document.createElement('a');link.href=url.href;link.textContent='View approved evidence';link.target='_blank';link.rel='noopener noreferrer';card.appendChild(link);grid.appendChild(card);
   });
   if(!grid.children.length)return;
   var heading=document.createElement('h2');heading.textContent='Selected work and client perspectives';host.append(heading,grid);host.hidden=false;
  }catch(_){/* Empty or unavailable proof is never replaced with fabricated content. */}
 });
}());
