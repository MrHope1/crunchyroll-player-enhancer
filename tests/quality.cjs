const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2],'utf8');let failed=0;
const mpd=`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet mimeType="video/mp4" codecs="avc1.640028"><ContentProtection schemeIdUri="keep"/><Representation id="720" width="1280" height="720" bandwidth="9000000"/><Representation id="1080-low" width="1920" height="1080" bandwidth="4000000"/><Representation id="best" width="1920" height="1080" bandwidth="8000000"><SegmentTemplate media="v/$Number$.m4s"/></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4" lang="en"><Representation id="audio1" bandwidth="128000"/><Representation id="audio2" bandwidth="256000"/></AdaptationSet><AdaptationSet mimeType="text/vtt"><Representation id="sub"/></AdaptationSet></Period></MPD>`;
function setup(text=mpd,{enabled=true,type='application/dash+xml',url='https://cdn.example/stream.mpd?token=test'}={}){
const dom=new JSDOM('<div id="player-container"><video></video><div role="menu" aria-label="Quality"><div role="separator">Quality</div>'+['Highest Available','Moderate','Data Saver'].map(label=>`<div role="menuitemradio" aria-label="${label}" aria-checked="false" class="native-theme"><div><span>${label}</span><span>Description</span></div><div></div></div>`).join('')+'</div></div>',{url:'https://www.crunchyroll.com/watch/test',runScripts:'outside-only'});
const w=dom.window,d=w.document;let tick;
w.Response=Response;w.Headers=Headers;w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
w.fetch=async()=>{const r=new Response(text,{headers:{'content-type':type}});Object.defineProperty(r,'url',{value:url});return r};
w.localStorage.setItem('cr-enhancer.maximum-quality',''+enabled);w.setInterval=fn=>{tick=fn};w.setTimeout=()=>1;w.clearTimeout=()=>{};
w.HTMLElement.prototype.getClientRects=function(){return [{}]};Object.defineProperty(d,'fullscreenElement',{value:d.querySelector('#player-container'),configurable:true});
w.eval(source);return {w,d,dom,tick:()=>tick(),fetch:()=>w.fetch(url)};
}
async function test(name,fn){let x;try{x=setup();await fn(x);console.log('PASS',name)}catch(e){failed++;console.log('FAIL',name,e.message)}finally{x?.dom.window.close()}}
(async()=>{
await test('DASH retains maximum resolution then bitrate and preserves DRM/subtitles',async({fetch,w})=>{const r=await fetch(),xml=new w.DOMParser().parseFromString(await r.text(),'application/xml');assert.deepEqual([...xml.querySelectorAll('Representation')].map(n=>n.id),['best','audio2','sub']);assert.ok(xml.querySelector('ContentProtection'));assert.equal(xml.querySelector('SegmentTemplate').getAttribute('media'),'v/$Number$.m4s');assert.equal(r.url,'https://cdn.example/stream.mpd?token=test')});
await test('response clones preserve URL and transformed body',async({fetch})=>{const r=await fetch();assert.equal(r.clone().url,r.url);assert.ok(!(await r.clone().text()).includes('1080-low'))});
await test('toggle above native options preserves native theme and remembers choice',({d,w,tick})=>{tick();const row=d.querySelector('[data-cr-quality-lock]');assert.ok(row);assert.ok(row.classList.contains('native-theme'));assert.equal(row.nextElementSibling.getAttribute('aria-label'),'Highest Available');row.click();assert.equal(w.localStorage.getItem('cr-enhancer.maximum-quality'),'false');assert.equal(row.getAttribute('aria-checked'),'false')});
await test('disabled mode leaves future manifests intact',async({d,fetch})=>{d.querySelector('[data-cr-quality-lock]').click();assert.equal(await (await fetch()).text(),mpd)});
await test('native quality click disables lock',({d,w})=>{d.querySelector('[aria-label="Moderate"]').click();assert.equal(w.localStorage.getItem('cr-enhancer.maximum-quality'),'false')});
await test('settings option is fullscreen-only',({d,w,tick})=>{Object.defineProperty(d,'fullscreenElement',{value:null,configurable:true});tick();assert.equal(d.querySelector('[data-cr-quality-lock]'),null)});
for(const [name,body,type,want] of [
 ['malformed XML unchanged','<MPD><broken>','application/dash+xml','<MPD><broken>'],
 ['non-manifest JSON unchanged','{"ok":true}','application/json','{"ok":true}'],
 ['HLS media segments unchanged','#EXTM3U\n#EXTINF:4,\nseg.ts\n','application/vnd.apple.mpegurl','#EXTM3U\n#EXTINF:4,\nseg.ts\n']]){
 const x=setup(body,{type});try{assert.equal(await(await x.fetch()).text(),want);console.log('PASS',name)}catch(e){failed++;console.log('FAIL',name,e.message)}finally{x.dom.window.close()}
}
const hls='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1280x720,AUDIO="a"\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="a"\nbest.m3u8\n';
const x=setup(hls,{type:'application/vnd.apple.mpegurl',url:'https://cdn.example/master.m3u8'});try{const out=await(await x.fetch()).text();assert.ok(out.includes('best.m3u8'));assert.ok(out.includes('audio.m3u8'));assert.ok(!out.includes('low.m3u8'));console.log('PASS HLS retains best video and audio group')}catch(e){failed++;console.log('FAIL HLS',e.message)}finally{x.dom.window.close()}
process.exitCode=failed?1:0;
})();
