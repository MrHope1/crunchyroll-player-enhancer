const http=require('node:http'),fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const script=fs.readFileSync(process.argv[2],'utf8');
const xml='<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation id="low" height="720" width="1280" bandwidth="2000000"/><Representation id="high" height="1080" width="1920" bandwidth="8000000"/></AdaptationSet><AdaptationSet mimeType="audio/mp4" lang="ja"><Representation id="ja" bandwidth="192000"/></AdaptationSet><AdaptationSet mimeType="audio/mp4" lang="en"><Representation id="en" bandwidth="192000"/></AdaptationSet></Period></MPD>';
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url.includes('json')?'application/json':'application/dash+xml');res.end(req.url.includes('json')?'{}':xml)});
server.listen(0,'127.0.0.1',async()=>{
 const url=`http://127.0.0.1:${server.address().port}`;
 const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'});const w=dom.window;
 w.TextDecoder=TextDecoder;w.TextEncoder=class extends TextEncoder{encode(s){return new w.Uint8Array(super.encode(s))}};
 w.setInterval=()=>1;w.eval(script);
 function get(path,type=''){return new Promise((resolve,reject)=>{const x=new w.XMLHttpRequest();x.open('GET',url+path);x.responseType=type;x.onload=()=>resolve(x);x.onerror=reject;x.send()})}
 try {
  const x=await get('/episode.mpd');assert.ok(!x.responseText.includes('id="low"'));assert.ok(x.responseText.includes('id="high"'));assert.ok(x.responseText.includes('id="ja"'));assert.ok(x.responseText.includes('id="en"'));assert.equal(x.response,x.responseText);assert.equal(x.responseURL,url+'/episode.mpd');console.log('PASS actual XHR text filters quality and preserves audio languages');
  const b=await get('/episode.mpd','arraybuffer');const out=new TextDecoder().decode(b.response);assert.ok(!out.includes('id="low"'));assert.ok(out.includes('id="high"'));console.log('PASS actual XHR arraybuffer filters quality');
  const j=await get('/data.json','json');assert.equal(JSON.stringify(j.response),'{}');console.log('PASS actual XHR JSON unchanged');
 }catch(e){process.exitCode=1;console.error(e)}finally{dom.window.close();server.close()}
});
