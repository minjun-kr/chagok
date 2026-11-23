import {createApp} from './server.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const dir=await mkdtemp(join(tmpdir(),'chagok-weekly-'));
const server=await createApp({dbPath:join(dir,'test.sqlite')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
async function request(path,body,method=body?'POST':'GET') {
  const res=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json()};
}
const add=(date,amount,type='expense')=>request('/api/entries',{date,amount,type,memo:'주간 검증',requestId:randomUUID()});
try {
  await add('2026-12-28',100);await add('2027-01-03',200);
  await add('2026-12-27',999);await add('2027-01-04',999);await add('2026-12-29',500,'income');
  let week=(await request('/api/weekly-expenses?date=2027-01-01')).data;
  assert.equal(week.start,'2026-12-28');assert.equal(week.end,'2027-01-03');assert.equal(week.total,'300');
  assert.equal(week.days.length,7);assert.equal(week.days[0].amount,100);assert.equal(week.days[6].amount,200);
  assert.equal((await request('/api/weekly-expenses?date=2027-01-03')).data.total,'300');
  const jan=(await request('/api/entries?month=2027-01')).data.entries;
  const id=jan.find(entry=>entry.date==='2027-01-03').id;
  await request(`/api/entries/${id}`,{date:'2027-01-03',amount:250,type:'expense',memo:'수정'},'PUT');
  assert.equal((await request('/api/weekly-expenses?date=2027-01-01')).data.total,'350');
  await request(`/api/entries/${id}`,undefined,'DELETE');
  assert.equal((await request('/api/weekly-expenses?date=2027-01-01')).data.total,'100');
  assert.equal((await request('/api/weekly-expenses?date=2030-02-01')).data.total,'0');
  const leap=(await request('/api/weekly-expenses?date=2028-02-29')).data;
  assert.equal(leap.start,'2028-02-28');assert.equal(leap.end,'2028-03-05');
  for(const date of ['2027-02-29','no-date','0999-12-31','10000-01-01'])assert.equal((await request('/api/weekly-expenses?date='+date)).status,400);
  for(const date of ['1000-01-01','9999-12-31'])assert.equal((await request('/api/weekly-expenses?date='+date)).data.days.length,7);
  await add('9999-12-31',123);
  assert.equal((await request('/api/weekly-expenses?date=9999-12-31')).data.total,'123');
  // Each month is within its safe limit; the combined week exceeds Number precision.
  const fixture=new DatabaseSync(join(dir,'test.sqlite'));
  fixture.exec('BEGIN');
  const seed=fixture.prepare('INSERT INTO entries(request_id,type,amount,date,memo,created_at) VALUES(?,?,?,?,?,?)');
  for(let index=0;index<9008;index++)seed.run('weekly-limit:'+index,'expense',999999999999,index<4504?'2030-12-31':'2031-01-01','한도 검증',index);
  fixture.exec('COMMIT');fixture.close();
  week=(await request('/api/weekly-expenses?date=2031-01-01')).data;
  assert.equal(week.total,(9008n*999999999999n).toString());

  const nodes=new Map();
  const element=()=>({value:'',textContent:'',children:[],events:{},dataset:{},style:{},disabled:false,checked:false,hidden:false,classList:{add(){},remove(){}},addEventListener(name,fn){this.events[name]=fn;},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},setAttribute(){},focus(){}});
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const library={};vm.runInNewContext(await readFile(new URL('./dist/analysis.js',import.meta.url),'utf8'),library);
  let failure=false;let pending=[];
  vm.runInNewContext(await readFile(new URL('./dist/app.js',import.meta.url),'utf8'),{
    ChagokAnalysis:library.ChagokAnalysis,document:{getElementById:$,createElement:element,createElementNS:element,createDocumentFragment:element,createTextNode:text=>({textContent:text}),querySelectorAll:()=>[],querySelector:()=>$('summary')},
    fetch:async path=>{
      if(path.startsWith('/api/weekly-expenses')) {
        if(failure)throw Error('offline');
        if(pending.length)return pending.shift();
        const date=new URL(path,'http://localhost').searchParams.get('date');
        const res=await fetch(base+'/api/weekly-expenses?date='+date);return res;
      }
      return {ok:true,json:async()=>({entries:[],categories:[],summary:{income:0,expense:0,balance:0,incomeCount:0,expenseCount:0}})};
    },localStorage:{getItem:()=>null},crypto:{randomUUID},AbortSignal,Intl,Date,setTimeout:()=>0,clearTimeout(){}
  });
  const settle=async()=>{for(let i=0;i<100&&$('weekly-chart').hidden;i++)await new Promise(resolve=>setTimeout(resolve,5));};
  await settle();
  assert.equal($('category-analysis').hidden,false);assert.equal($('weekly-analysis').hidden,true);
  $('tab-weekly').events.click();
  assert.equal($('category-analysis').hidden,true);assert.equal($('weekly-analysis').hidden,false);
  $('tab-weekly').events.keydown({key:'Home',preventDefault(){}});
  assert.equal($('category-analysis').hidden,false);assert.equal($('weekly-analysis').hidden,true);
  $('tab-category').events.keydown({key:'ArrowRight',preventDefault(){}});
  assert.equal($('weekly-analysis').hidden,false);
  $('date').value='2027-01-01';await $('date').events.change();await settle();
  assert.equal($('weekly-analysis').hidden,false);
  assert.equal($('weekly-total').textContent,'100원');assert.equal($('weekly-chart').children[0].children.length,7);
  await $('next-week').events.click();await settle();assert.equal($('date').value,'2027-01-08');assert.equal($('weekly-total').textContent,'999원');
  await $('prev-week').events.click();await settle();assert.equal($('date').value,'2027-01-01');
  await $('weekly-chart').children[0].children[0].events.click();await settle();assert.equal($('date').value,'2026-12-28');assert.equal($('month').value,'2026-12');
  failure=true;await $('retry-week').events.click();assert.equal($('weekly-total').textContent,'—');assert.equal($('weekly-chart').hidden,true);assert.equal($('retry-week').hidden,false);
  failure=false;await $('retry-week').events.click();assert.equal($('weekly-total').textContent,'100원');
  let resolveOld;
  pending=[new Promise(resolve=>{resolveOld=resolve;})];
  const old=$('retry-week').events.click();await $('next-week').events.click();await settle();
  resolveOld({ok:true,json:async()=>({start:'2026-12-28',end:'2027-01-03',total:'123',days:[]})});await old;
  assert.equal($('weekly-total').textContent,'999원');
  $('tab-category').events.click();
  assert.equal($('weekly-analysis').hidden,true);assert.equal($('category-analysis').hidden,false);
  const html=await readFile(new URL('./dist/index.html',import.meta.url),'utf8');
  const calendarColumn=html.slice(html.indexOf('<div class="calendar-column">'),html.indexOf('<aside class="analysis-panel"'));
  assert.ok(calendarColumn.includes('class="history-panel"'));assert.ok(!calendarColumn.includes('id="weekly-analysis"'));
  assert.ok(html.indexOf('id="weekly-analysis"')>html.indexOf('<aside class="analysis-panel"'));
  console.log('PASS: weekly boundaries, leap year, future, income exclusion, update/delete, exact totals, chart, navigation, retry and stale-response protection');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await rm(dir,{recursive:true,force:true});
}
