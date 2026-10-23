const {JSDOM}=require("jsdom");const fs=require("fs");
const dom=new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>',{runScripts:"outside-only",pretendToBeVisual:true});
const w=dom.window;let fail=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fail++};
const run=f=>w.eval(fs.readFileSync(f,"utf8"));
run("mutation-bus.js");run("a11y-color-patch.js");run("a11y-toast-patch.js");
ok(!!w.__ARISE_MUTATION_BUS__,"bus present");
const d=w.document;
// add nodes AFTER patches loaded -> should be labelled via bus path (scoped scan)
const host=d.createElement("div");
host.innerHTML='<div class="att-zone-badge" data-tone="danger">x</div><div class="lh-cell" data-level="3" title="Mon"></div><div class="htw-toast">hi</div>';
d.getElementById("root").appendChild(host);
setTimeout(()=>{
  ok(d.querySelector(".att-zone-badge [data-uxa-tone-label]")?.textContent==="[At risk] ","tone label added to new node");
  ok(d.querySelector(".lh-cell").getAttribute("aria-label")==="Mon (activity level: High)","heat cell aria-label added");
  ok(d.querySelector(".htw-toast").getAttribute("role")==="status","toast role=status added");
  // >40 added nodes -> falls back to full-document scan
  const big=d.createElement("div");let h="";for(let i=0;i<60;i++)h+='<span class="hh-pct-up">'+i+'</span>';big.innerHTML=h;
  d.getElementById("root").appendChild(big);for(let i=0;i<45;i++){const s=d.createElement("i");d.getElementById("root").appendChild(s)}
  setTimeout(()=>{ok(d.querySelectorAll(".hh-pct-up[aria-label]").length===60,"burst (>40 nodes) falls back to full scan");
    console.log(fail?"SMOKE FAILED":"SMOKE OK");process.exit(fail?1:0)},700);
},700);
