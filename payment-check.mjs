import {createApp} from './server.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const dir=await mkdtemp(join(tmpdir(),'chagok-payment-'));
const dbPath=join(dir,'test.sqlite');
// Migrate a pre-payment database without changing its transactions.
const old=new DatabaseSync(dbPath);
old.exec(`CREATE TABLE entries(id INTEGER PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,type TEXT NOT NULL,amount INTEGER NOT NULL,date TEXT NOT NULL,memo TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
INSERT INTO entries VALUES(1,'old-entry','expense',12000,'2040-02-01','기존 기록',1);`);
old.close();
let server,base;
async function start(){server=await createApp({dbPath});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;}
async function stop(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
async function request(path,body,method=body?'POST':'GET'){const res=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};}
const entry=(overrides={})=>({type:'expense',amount:1000,date:'2040-02-02',memo:'결제 테스트',requestId:randomUUID(),...overrides});
try {
  await start();
  const migrated=(await request('/api/entries?month=2040-02')).data.entries[0];
  assert.equal(migrated.paymentMethodId,null);assert.equal(migrated.amount,12000);assert.equal(migrated.memo,'기존 기록');
  for(const name of ['', ' ', '미지정','x'.repeat(31)])assert.equal((await request('/api/payment-methods',{name})).status,400);
  assert.equal((await request('/api/payment-methods',{name:'현대카드',active:1})).status,400);
  let result=await request('/api/payment-methods',{name:' 현대카드 '});assert.equal(result.status,201);
  const card=result.data.paymentMethods[0];assert.equal(card.name,'현대카드');
  assert.equal((await request('/api/payment-methods',{name:'현대카드'})).status,409);
  const paid=entry({paymentMethodId:card.id});
  assert.equal((await request('/api/entries',paid)).status,201);
  assert.equal((await request('/api/entries',paid)).status,200);
  assert.equal((await request('/api/entries',{...paid,paymentMethodId:null})).status,400);
  assert.equal((await request('/api/entries',entry({type:'income',paymentMethodId:card.id}))).status,400);
  assert.equal((await request('/api/entries',entry({paymentMethodId:99999}))).status,400);
  assert.equal((await request('/api/entries',entry({paymentMethodId:'1'}))).status,400);
  result=(await request('/api/entries?month=2040-02')).data;
  const record=result.entries.find(e=>e.paymentMethodId===card.id),totals=result.summary;
  assert.equal(record.paymentMethodName,'현대카드');
  assert.equal((await request(`/api/payment-methods/${card.id}`,{name:'생활비 카드'},'PUT')).status,200);
  assert.equal((await request('/api/entries?month=2040-02')).data.entries.find(e=>e.id===record.id).paymentMethodName,'생활비 카드');
  assert.equal((await request(`/api/payment-methods/${card.id}`,undefined,'DELETE')).status,409);
  assert.equal((await request(`/api/payment-methods/${card.id}`,{active:false},'PUT')).status,200);
  assert.equal((await request('/api/entries',entry({paymentMethodId:card.id}))).status,400);
  assert.equal((await request('/api/entries',paid)).status,200); // Retry succeeds even after archiving.
  assert.equal((await request(`/api/entries/${record.id}`,{...paid,memo:'수정'},'PUT')).status,200);
  assert.equal((await request('/api/entries/1',entry({paymentMethodId:card.id}),'PUT')).status,400);
  assert.deepEqual((await request('/api/entries?month=2040-02')).data.summary,totals);
  await stop();await start();
  assert.equal((await request('/api/payment-methods')).data.paymentMethods[0].active,0);
  assert.equal((await request('/api/entries?month=2040-02')).data.entries.find(e=>e.id===record.id).paymentMethodName,'생활비 카드');
  assert.equal((await request(`/api/payment-methods/${card.id}`,{active:true},'PUT')).status,200);
  assert.equal((await request(`/api/entries/${record.id}`,entry({type:'income',paymentMethodId:null}),'PUT')).status,200);
  assert.equal((await request('/api/entries?month=2040-02')).data.entries.find(e=>e.id===record.id).paymentMethodId,null);
  await request('/api/entries',entry({paymentMethodId:card.id}));
  const used=(await request('/api/entries?month=2040-02')).data.entries.find(e=>e.paymentMethodId===card.id);
  await request(`/api/entries/${used.id}`,undefined,'DELETE');
  assert.equal((await request(`/api/payment-methods/${card.id}`,undefined,'DELETE')).status,409);
  const unused=(await request('/api/payment-methods',{name:'미사용 계좌'})).data.paymentMethods.find(p=>p.name==='미사용 계좌');
  assert.equal((await request(`/api/payment-methods/${unused.id}`,undefined,'DELETE')).status,200);
  assert.equal((await request(`/api/payment-methods/${unused.id}`,undefined,'DELETE')).status,200);
  assert.equal((await request('/api/payment-methods/99999',{name:'없음'},'PUT')).status,404);
  console.log('PASS: payment migration, validation, CRUD, archive/reactivate, historical names, expense-only links, retries, deleted usage and restart');

  // Exercise the actual client against the isolated SQLite API.
  const nodes=new Map();let type='expense',offline=false;
  const element=()=>({value:'',textContent:'',children:[],events:{},dataset:{},attributes:{},style:{},hidden:false,disabled:false,open:false,classList:{add(){},remove(){}},addEventListener(n,fn){this.events[n]=fn;},replaceChildren(...a){this.children=a;},append(...a){this.children.push(...a);},setAttribute(k,v){this.attributes[k]=v;},focus(){},showModal(){this.open=true;},close(){this.open=false;}});
  const $=id=>{if(!nodes.has(id)){const node=element();if(id==='type-income'||id==='type-expense')Object.defineProperty(node,'checked',{get:()=>type===id.slice(5),set:value=>{if(value)type=id.slice(5);}});nodes.set(id,node);}return nodes.get(id);};
  $('type-income').value='income';$('type-expense').value='expense';
  vm.runInNewContext(await readFile(new URL('./dist/app.js',import.meta.url),'utf8'),{
    document:{getElementById:$,createElement:element,createDocumentFragment:element,createTextNode:text=>({textContent:text}),querySelectorAll:s=>s==='input[name="type"]'?[$('type-income'),$('type-expense')]:[],querySelector:()=>$('summary')},
    localStorage:{getItem:()=>null},fetch:(path,options)=>{if(offline)throw new TypeError('offline');return fetch(base+path,options);},AbortSignal,crypto:{randomUUID},Date,Intl,FormData:class{get(){return type;}},setTimeout:()=>0,clearTimeout(){}
  });
  for(let i=0;i<100&&$('save-state').textContent!=='로컬 DB에 저장';i++)await new Promise(resolve=>setTimeout(resolve,10));
  await $('manage-payments').events.click();assert.equal($('payment-dialog').open,true);
  $('payment-name').value='현금';await $('payment-form').events.submit({preventDefault(){}});
  const methods=()=>$('payment-list').children[0].children;
  const methodRow=name=>methods().find(row=>row.children[0].children[0].textContent===name);
  const cashId=Number(methodRow('현금').dataset.id);
  methodRow('현금').children[1].children[0].events.click();$('payment-name').value='현금 지갑';
  offline=true;await $('payment-form').events.submit({preventDefault(){}});assert.equal($('payment-name').value,'현금 지갑');assert.match($('payment-error').textContent,/서버/);
  offline=false;await $('payment-form').events.submit({preventDefault(){}});assert.ok(methodRow('현금 지갑'));
  $('payment-close').events.click();
  $('date').value='2040-02-03';await $('date').events.change();
  $('payment-method').value=String(cashId);$('amount').value='2300';$('memo').value='현금 식사';
  offline=true;await $('entry-form').events.submit({preventDefault(){}});assert.equal($('payment-method').value,String(cashId));
  offline=false;await $('entry-form').events.submit({preventDefault(){}});
  const rows=()=>$('records').children[0].children;
  assert.match(rows()[0].children[0].children[1].children[1].textContent,/현금 지갑/);
  rows()[0].children[1].children[1].children[0].events.click();assert.equal($('payment-method').value,String(cashId));
  await $('manage-payments').events.click();
  assert.equal(methodRow('현금 지갑').children[1].children[2].disabled,true);
  methodRow('현금 지갑').children[1].children[1].events.click();await $('payment-confirm').events.click();
  assert.equal($('payment-method').value,String(cashId));
  assert.ok($('payment-method').children[0].children.some(option=>option.textContent==='현금 지갑 · 사용 중지'));
  $('date').value='2040-03-03';await $('date').events.change();
  assert.equal($('payment-method').value,String(cashId),'Archived selection survives moving the edit to another month');
  $('date').value='2040-02-03';await $('date').events.change();
  $('payment-close').events.click();$('memo').value='사용 중지 후 수정';await $('entry-form').events.submit({preventDefault(){}});
  assert.ok(!$('payment-method').children[0].children.some(option=>option.value===String(cashId)));
  rows()[0].children[1].children[1].children[0].events.click();
  type='income';$('type-income').events.change();assert.equal($('payment-field').hidden,true);assert.equal($('payment-method').value,'');
  await $('entry-form').events.submit({preventDefault(){}});
  const income=(await request('/api/entries?month=2040-02')).data.entries.find(e=>e.memo==='사용 중지 후 수정');
  assert.equal(income.type,'income');assert.equal(income.paymentMethodId,null);
  assert.doesNotMatch(rows()[0].children[0].children[1].children[1].textContent,/미지정|현금 지갑/);
  await $('manage-payments').events.click();
  methodRow('현금 지갑').children[1].children[1].events.click();await $('payment-confirm').events.click();
  type='expense';$('type-expense').events.change();assert.ok($('payment-method').children[0].children.some(option=>option.value===String(cashId)));
  $('payment-name').value='삭제할 수단';await $('payment-form').events.submit({preventDefault(){}});
  methodRow('삭제할 수단').children[1].children[2].events.click();$('payment-confirm-cancel').events.click();assert.ok(methodRow('삭제할 수단'));
  methodRow('삭제할 수단').children[1].children[2].events.click();
  offline=true;await $('payment-confirm').events.click();assert.equal($('payment-confirm-panel').hidden,false);assert.match($('payment-error').textContent,/서버/);
  offline=false;await $('payment-confirm').events.click();assert.equal(methodRow('삭제할 수단'),undefined);
  console.log('PASS: payment manager, failed-save preservation, expense selection, details, archived cross-month edits, reactivation, delete cancel/retry and income clearing');
} finally {if(server?.listening)await stop();await rm(dir,{recursive:true,force:true});}
