import {createApp} from './server.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const dir=await mkdtemp(join(tmpdir(),'chagok-budget-'));let server,base;
const dbPath=join(dir,'test.sqlite');
async function start(){server=await createApp({dbPath});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;}
async function stop(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
async function request(path,body,method=body?'POST':'GET',headers={}){const res=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json',...headers}:headers,body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};}
const postEntry=overrides=>request('/api/entries',{type:'expense',amount:100,date:'2040-02-29',memo:'예산 테스트',requestId:randomUUID(),...overrides});
const path='/api/budgets/2040-02';
try {
  await start();
  assert.equal((await fetch(base+'/budget.js')).status,200);
  assert.equal((await request('/api/budgets?month=2040-02')).data.budget,null);
  for(const month of ['0999-12','2040-13','2040-2','no']) {
    assert.equal((await request('/api/budgets?month='+month)).status,400);
    assert.equal((await request('/api/budgets/'+month,undefined,'DELETE')).status,400);
  }
  await request('/api/categories',{type:'expense',name:'식비'});await request('/api/categories',{type:'expense',name:'교통비'});await request('/api/categories',{type:'income',name:'급여'});
  const categories=(await request('/api/categories')).data.categories;
  const food=categories.find(c=>c.name==='식비'),transport=categories.find(c=>c.name==='교통비'),salary=categories.find(c=>c.name==='급여');
  await postEntry({amount:800,categoryId:food.id});await postEntry({amount:200,categoryId:transport.id});await postEntry({amount:50});await postEntry({type:'income',amount:5000,categoryId:salary.id});
  const original=(await request('/api/entries?month=2040-02')).data;
  const budget={amount:1200,categories:[{categoryId:food.id,amount:1000},{categoryId:transport.id,amount:0}]};
  assert.equal((await request(path,budget,'PUT')).status,200);
  assert.deepEqual((await request('/api/entries?month=2040-02')).data.summary,original.summary);
  for(const bad of [null,{}, {...budget,amount:-1},{...budget,amount:1.5},{...budget,amount:'1200'},{...budget,amount:1e12},{...budget,amount:999},
    {amount:1200,categories:[{categoryId:food.id,amount:1},{categoryId:food.id,amount:1}]},
    {amount:1200,categories:[{categoryId:salary.id,amount:1}]},{amount:1200,categories:[{categoryId:999999,amount:1}]},
    {amount:1200,categories:[{categoryId:food.id,amount:-1}]},{amount:1200,categories:[null]}]) {
    assert.equal((await request(path,bad??{amount:null},'PUT')).status,400);
    assert.equal((await request('/api/budgets?month=2040-02')).data.budget.amount,1200);
  }
  assert.equal((await request(path,budget,'PUT',{Origin:'https://example.com'})).status,403);
  await request('/api/budgets/2040-01',{amount:500,categories:[{categoryId:food.id,amount:300}]},'PUT');
  await stop();await start();
  const saved=(await request('/api/budgets?month=2040-02')).data.budget;
  assert.equal(saved.categories.find(c=>c.categoryId===transport.id).amount,0);
  assert.equal((await request('/api/budgets?month=2040-01')).data.budget.amount,500);
  const sandbox={};vm.runInNewContext(await readFile(new URL('./dist/budget.js',import.meta.url),'utf8'),sandbox);
  const Budget=sandbox.ChagokBudget;
  const data=()=>request('/api/entries?month=2040-02').then(r=>({...r.data,month:'2040-02'}));
  let model=Budget.summarize(await data());assert.equal(model.spent,1050);assert.equal(model.overCount,1);assert.equal(model.assigned[0].name,'교통비');assert.equal(model.unassigned[0].spent,50);
  assert.equal(Budget.percentage(1300,1000),'130%');assert.equal(Budget.percentage(0,0),'0%');assert.equal(Budget.percentage(1,0),'초과');
  // Future entries count; deleting entries and categories updates the model without changing budget totals.
  const expense=original.entries.find(e=>e.categoryId===food.id);
  await request(`/api/entries/${expense.id}`,{...expense,amount:1100},'PUT');assert.equal(Budget.summarize(await data()).overCount,2);
  await request(`/api/entries/${expense.id}`,undefined,'DELETE');assert.equal(Budget.summarize(await data()).spent,250);
  await request(`/api/categories/${transport.id}`,undefined,'DELETE');
  model=Budget.summarize(await data());assert.equal(model.overCount,0);assert.equal(model.unassigned[0].spent,250);
  assert.equal((await request('/api/budgets?month=2040-02')).data.budget.amount,1200);
  assert.equal((await request('/api/budgets?month=2040-02')).data.budget.categories.length,1);
  console.log('PASS: monthly budget persistence, isolated months, atomic validation, expense categories, zero budgets, future spending, edits/deletes and category removal');

  // Render and operate the budget module against actual HTTP/SQLite.
  const nodes=new Map();
  const element=()=>({value:'',textContent:'',children:[],events:{},dataset:{},attributes:{},style:{},hidden:false,disabled:false,open:false,addEventListener(n,f){this.events[n]=f;},replaceChildren(...a){this.children=a;},append(...a){this.children.push(...a);},setAttribute(k,v){this.attributes[k]=v;},focus(){},showModal(){this.open=true;},close(){this.open=false;}});
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  sandbox.document={getElementById:$,createElement:element,createDocumentFragment:element};
  let offline=false,month='2040-02',openedCategory=null,refreshCount=0;
  const api=async(url,body,method)=>{if(offline)throw Object.assign(new Error('offline'),{name:'TypeError'});const r=await request(url,body,method);if(r.status>=400)throw Error(r.data.error);return r.data;};
  let ui;
  const refresh=async()=>{refreshCount++;const response=await api('/api/entries?month='+month);ui.render({...response,month});};
  ui=Budget.init({api,refresh,getMonth:()=>month,openCategory:key=>openedCategory=key});
  ui.loading();assert.equal($('budget-open').disabled,true);await refresh();assert.equal($('budget-remaining').textContent,'남은 예산 950원');
  $('budget-toggle').events.click();assert.equal($('budget-details').hidden,false);assert.equal($('budget-toggle').attributes['aria-expanded'],'true');
  $('budget-unassigned').children[0].children[1].events.click();assert.equal(openedCategory,'uncategorized');
  $('budget-open').events.click();assert.equal($('budget-dialog').open,true);
  const inputs=()=>$('budget-inputs').children[0].children.map(row=>row.children[1]);
  assert.equal(inputs()[0].value,'1,000');
  $('budget-amount').value='500';$('budget-amount').events.input();assert.equal($('budget-save').disabled,true);assert.match($('budget-error').textContent,/초과/);
  $('budget-amount').value='2000';$('budget-amount').events.input();inputs()[0].value='0';inputs()[0].events.input();assert.equal($('budget-save').disabled,false);
  offline=true;await $('budget-form').events.submit({preventDefault(){}});assert.equal($('budget-dialog').open,true);assert.equal(inputs()[0].value,'0');assert.match($('budget-error').textContent,/서버/);
  offline=false;await $('budget-form').events.submit({preventDefault(){}});assert.equal($('budget-dialog').open,false);
  assert.equal((await request('/api/budgets?month=2040-02')).data.budget.categories[0].amount,0);
  $('budget-open').events.click();await $('budget-copy').events.click();assert.equal($('budget-amount').value,'500');assert.equal(inputs()[0].value,'300');
  assert.equal((await request('/api/budgets?month=2040-02')).data.budget.amount,2000,'Copy does not save');
  $('budget-cancel').events.click();$('budget-open').events.click();assert.equal($('budget-amount').value,'2,000');
  inputs()[0].value='';inputs()[0].events.input();await $('budget-form').events.submit({preventDefault(){}});
  assert.equal((await request('/api/budgets?month=2040-02')).data.budget.categories.length,0,'Blank differs from zero');
  $('budget-open').events.click();$('budget-delete').events.click();$('budget-delete-cancel').events.click();assert.equal($('budget-delete-panel').hidden,true);
  $('budget-delete').events.click();offline=true;await $('budget-delete-confirm').events.click();assert.equal($('budget-delete-panel').hidden,false);assert.equal($('budget-dialog').open,true);
  offline=false;const finance=(await data()).summary;await $('budget-delete-confirm').events.click();
  assert.equal($('budget-content').hidden,true);assert.equal($('budget-status').textContent,'이번 달 예산을 정해보세요.');assert.deepEqual((await data()).summary,finance);
  $('budget-open').events.click();$('budget-amount').value='100';await $('budget-copy').events.click();assert.equal($('budget-amount').value,'500');$('budget-cancel').events.click();
  month='2041-01';await refresh();$('budget-open').events.click();$('budget-amount').value='123';await $('budget-copy').events.click();assert.equal($('budget-amount').value,'123');assert.match($('budget-copy-status').textContent,/없어요/);
  $('budget-cancel').events.click();month='1000-01';await refresh();$('budget-open').events.click();assert.equal($('budget-copy').disabled,true);$('budget-cancel').events.click();
  ui.error();assert.equal($('budget-content').hidden,true);assert.equal($('budget-retry').hidden,false);assert.equal($('budget-open').disabled,true);
  await $('budget-retry').events.click();assert.equal($('budget-open').disabled,false);assert.ok(refreshCount>5);
  // Exact and over-budget states include accessible progress text.
  for(const [amount,spent,expected] of [[100,80,'warning'],[100,100,'warning'],[100,125,'over'],[0,0,'normal'],[0,10,'over']]) {
    ui.render({month,budget:{amount,categories:[]},categories:[],entries:[{type:'expense',date:month+'-01',amount:spent}]});
    assert.equal($('budget-card').dataset.state,expected);assert.equal($('budget-bar').style.width,(amount?Math.min(100,spent/amount*100):spent?100:0)+'%');assert.match($('budget-progress').attributes['aria-valuetext'],/사용/);
  }
  console.log('PASS: budget card, expand/details, validation, zero vs blank, copy preview/cancel, save failure, delete retry, empty/error states, month boundaries and progress');
}finally{if(server?.listening)await stop();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
