// Reads only the published public API. No privileged credentials or draft export.
import {readFileSync,writeFileSync} from 'node:fs';
const config=readFileSync('blog-config.js','utf8'),key=config.match(/publishableKey:\s*'([^']+)'/)[1],url=config.match(/url:\s*'([^']+)'/)[1];
const slugs=[];
for(let offset=0;;offset+=500){
 const response=await fetch(url+'/rest/v1/blog_posts?select=slug&status=eq.published&order=slug&offset='+offset+'&limit=500',{headers:{apikey:key}});
 if(!response.ok)throw new Error('Published Blog API unavailable; sitemap left unchanged');
 const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid public Blog response');
 for(const row of rows){if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug))throw Error('Invalid published slug');slugs.push(row.slug)}
 if(rows.length<500)break;
}
const sitemap=readFileSync('sitemap.xml','utf8').replace(/\s*<url><loc>https:\/\/linkorasolution\.com\/blog-post\.html\?slug=[^<]*<\/loc><\/url>/g,'');
writeFileSync('sitemap.xml',sitemap.replace('</urlset>',slugs.map(slug=>'  <url><loc>https://linkorasolution.com/blog-post.html?slug='+slug+'</loc></url>').join('\n')+'\n</urlset>'));
console.log('Sitemap refreshed with '+slugs.length+' published Blog URLs; drafts excluded.');
