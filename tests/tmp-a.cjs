process.env.TZ='Asia/Kolkata';
const {JSDOM}=require('jsdom');const fs=require('fs');
const d=new JSDOM('<!doctype html><html><body><div id="arise-main"><header><h1>Analytics</h1></header><div class="flex-1"><div class="space-y-6"></div></div></div></body></html>',{url:'https://arise.test/',runScripts:'outside-only',pretendToBeVisual:true});
const w=d.window;
w.localStorage.setItem('focusSessionsV2', JSON.stringify([
 {id:'a',category:'DSA',minutes:60,startedAt:'2026-11-09T23:30:00.000Z'},
 {id:'b',category:'DSA',minutes:25,startedAt:'2026-11-10T18:40:00.000Z'}]));
w.eval(fs.readFileSync('src/analytics-integrity.js','utf8'));
console.log(JSON.stringify(w.AriseAnalytics.audit({now:new Date('2026-11-10T12:30:00.000Z')}),null,1));
console.log(JSON.stringify(w.AriseAnalytics.summarise({days:7,now:new Date('2026-11-10T12:30:00.000Z')}).buckets));
console.log('card', !!w.document.getElementById('ani-card'), w.document.querySelector('.ani-accuracy')?.textContent.slice(0,90));
process.exit(0);
