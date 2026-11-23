import assert from 'node:assert/strict';
import {mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from './server.mjs';

const folder = await mkdtemp(join(tmpdir(),'chagok-recurring-'));
const dbPath = join(folder,'test.sqlite');
let server;
async function start() {
  server = await createApp({dbPath});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
}
async function stop() {
  if(server?.listening)await new Promise(resolve => server.close(resolve));
}
async function request(path,expected,{method='GET',body}={}) {
  const response = await fetch('http://127.0.0.1:'+server.address().port+path,{
    method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined
  });
  const json = await response.json();
  assert.equal(response.status,expected,JSON.stringify(json));
  return json;
}
const month = key => request('/api/entries?month='+key,200);

try {
  await start();
  const ruleData = {name:'관리비',startsOn:'2020-01-31',amount:12000};
  const {rule} = await request('/api/recurring-rules',201,{method:'POST',body:ruleData});
  assert.equal((await month('2019-12')).recurring.length,0);
  assert.equal((await month('2020-02')).recurring[0].dueDate,'2020-02-29');
  assert.equal((await month('2020-03')).recurring[0].dueDate,'2020-03-31');
  assert.equal((await month('2021-02')).recurring[0].dueDate,'2021-02-28');
  assert.equal((await month('2020-02')).summary.expense,0);

  const february = {ruleId:rule.id,dueDate:'2020-02-29'};
  const entry = {type:'expense',amount:14000,memo:'관리비',date:'2020-03-01',recurring:february,requestId:randomUUID()};
  await request('/api/entries',404,{method:'POST',body:{...entry,recurring:{...february,dueDate:'2020-02-28'}}});
  await request('/api/entries',400,{method:'POST',body:{...entry,type:'income'}});
  await request('/api/entries',400,{method:'POST',body:{...entry,paymentMethodId:900}});
  assert.equal((await month('2020-02')).recurring[0].status,'pending');
  const submissions = [entry,{...entry,requestId:randomUUID()}];
  const responses = await Promise.all(submissions.map(body => fetch('http://127.0.0.1:'+server.address().port+'/api/entries',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  })));
  assert.deepEqual(responses.map(response => response.status).sort(),[201,409]);
  await Promise.all(responses.map(response => response.json()));
  const winner = submissions[responses.findIndex(response => response.status===201)];
  await request('/api/entries',200,{method:'POST',body:winner});
  assert.equal((await month('2020-02')).recurring[0].actualDate,'2020-03-01');
  assert.equal((await month('2020-02')).summary.expense,0);
  const march = await month('2020-03');
  assert.equal(march.summary.expense,14000);
  assert.equal(march.entries.length,1);
  await request('/api/entries/'+march.entries[0].id,200,{method:'DELETE'});
  assert.equal((await month('2020-02')).recurring[0].status,'pending');
  await request('/api/entries',201,{method:'POST',body:{...entry,requestId:randomUUID()}});

  const skip = {ruleId:rule.id,dueDate:'2020-03-31'};
  await request('/api/recurring-occurrences/skip',200,{method:'POST',body:skip});
  await request('/api/recurring-occurrences/skip',200,{method:'POST',body:skip});
  await request('/api/entries',409,{method:'POST',body:{...entry,recurring:skip}});
  await request('/api/recurring-occurrences/skip',400,{method:'POST',body:{ruleId:rule.id,dueDate:'9999-12-31'}});
  await request('/api/recurring-rules/'+rule.id,200,{method:'PUT',body:{...ruleData,amount:16000,endsOn:'2020-04-30'}});
  assert.equal((await month('2020-04')).recurring[0].amount,16000);
  assert.equal((await month('2020-05')).recurring.length,0);

  const original = {type:'expense',amount:125000,memo:'아파트 관리비',date:'2021-01-31',requestId:randomUUID()};
  await request('/api/entries',201,{method:'POST',body:original});
  const january = await month('2021-01');
  const sourceEntryId = january.entries.find(item => item.memo===original.memo).id;
  const conversion = {sourceEntryId,name:original.memo,startsOn:'2021-02-28',repeatDay:31};
  await request('/api/recurring-rules',400,{method:'POST',body:{...conversion,startsOn:'2021-01-31'}});
  await request('/api/recurring-rules',400,{method:'POST',body:{...conversion,repeatDay:24}});
  const conversions = await Promise.all([conversion,{...conversion,amount:125000}].map(body =>
    fetch('http://127.0.0.1:'+server.address().port+'/api/recurring-rules',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
    })
  ));
  assert.deepEqual(conversions.map(response => response.status).sort(),[200,201]);
  const results = await Promise.all(conversions.map(response => response.json()));
  const converted = results[0].rule;
  assert.equal(converted.id,results[1].rule.id);
  assert.equal(converted.repeatDay,31);
  assert.equal((await month('2021-01')).entries[0].recurringRuleId,converted.id);
  assert.equal((await month('2021-01')).summary.expense,125000);
  assert.equal((await month('2021-01')).recurring.length,0);
  assert.equal((await month('2021-02')).recurring[0].dueDate,'2021-02-28');
  assert.equal((await month('2021-03')).recurring[0].dueDate,'2021-03-31');
  const idFromOccurrence = (await month('2020-03')).entries[0].id;
  assert.equal((await request('/api/recurring-rules',200,{method:'POST',body:{sourceEntryId:idFromOccurrence}})).rule.id,rule.id);
  await request('/api/entries/'+sourceEntryId,200,{method:'PUT',body:{...original,amount:150000,memo:'수정한 원본'}});
  await request('/api/entries/'+sourceEntryId,200,{method:'DELETE'});
  assert.equal((await month('2021-02')).recurring[0].amount,converted.amount);
  await stop();
  await start();
  assert.equal((await month('2020-02')).recurring[0].actualAmount,14000);
  assert.equal((await month('2020-03')).recurring[0].status,'skipped');
  assert.equal((await month('2020-03')).summary.expense,14000);
  assert.equal((await request('/api/recurring-rules',200)).rules[0].endsOn,'2020-04-30');
  assert.equal((await month('2021-03')).recurring[0].name,original.memo);
  const ended = await request('/api/recurring-rules/'+rule.id,200);
  assert.equal(ended.rule.nextDueDate,null);
  const future = await request('/api/recurring-rules',201,{method:'POST',body:{name:'미래 일정',startsOn:'9998-02-28',repeatDay:31}});
  const futureDetail = await request('/api/recurring-rules/'+future.rule.id,200);
  assert.equal(futureDetail.rule.nextDueDate,'9998-02-28');
  const inboxPath = '/api/recurring-occurrences/inbox';
  const firstPage = await request(inboxPath,200);
  assert.equal(firstPage.items.length,20);
  assert.equal(firstPage.hasMore,true);
  const last = firstPage.items.at(-1);
  const nextPage = await request(inboxPath+'?after='+last.dueDate+'&afterId='+last.id,200);
  assert.equal(nextPage.total,firstPage.total);
  assert.ok(nextPage.items[0].dueDate>last.dueDate||nextPage.items[0].id>last.id);
  const manual = {...original,date:'2021-03-02',requestId:randomUUID()};
  await request('/api/entries',201,{method:'POST',body:manual});
  const manualMonth = await month('2021-03');
  const linkRef = {ruleId:converted.id,dueDate:'2021-02-28',entryId:manualMonth.entries[0].id};
  const candidates = await request('/api/recurring-occurrences/candidates?'+new URLSearchParams({
    ruleId:linkRef.ruleId,dueDate:linkRef.dueDate,start:'2021-02-21',end:'2021-03-07',q:'관리비'
  }),200);
  assert.deepEqual(candidates.entries.map(entry=>entry.id),[linkRef.entryId]);
  const linkPath = '/api/recurring-occurrences/link';
  await request(linkPath,200,{method:'POST',body:linkRef});
  await request(linkPath,200,{method:'POST',body:linkRef});
  await request(linkPath,409,{method:'POST',body:{...linkRef,dueDate:'2021-03-31'}});
  assert.equal((await month('2021-02')).recurring[0].linkedEntryId,linkRef.entryId);
  assert.equal((await month('2021-03')).summary.expense,manualMonth.summary.expense);
  assert.equal((await request(inboxPath,200)).total,firstPage.total-1);
  await request(linkPath,200,{method:'DELETE',body:linkRef});
  assert.equal((await request(inboxPath,200)).total,firstPage.total);
  await request(linkPath,200,{method:'POST',body:linkRef});
  await request('/api/entries/'+linkRef.entryId,200,{method:'DELETE'});
  assert.equal((await month('2021-02')).recurring[0].status,'pending');
  assert.equal((await request(inboxPath,200)).total,firstPage.total);
  const recordedBeforeDelete = await month('2020-03');
  await request('/api/recurring-rules/'+rule.id,200,{method:'DELETE'});
  await request('/api/recurring-rules/'+rule.id,200,{method:'DELETE'});
  await request('/api/recurring-rules/'+rule.id,404);
  await request('/api/recurring-occurrences/skip',404,{method:'POST',body:{ruleId:rule.id,dueDate:'2020-04-30'}});
  assert.equal((await month('2020-02')).recurring.length,0);
  assert.equal((await month('2020-03')).summary.expense,recordedBeforeDelete.summary.expense);
  assert.equal((await month('2020-03')).entries[0].recurringRuleId,null);
  assert.equal((await request(inboxPath,200)).total,firstPage.total-2);

  await request('/api/entries',201,{method:'POST',body:{...original,date:'2025-01-31',requestId:randomUUID()}});
  const activeSource = (await month('2025-01')).entries[0];
  const sourceData = {...conversion,sourceEntryId:activeSource.id,startsOn:'2025-02-28'};
  const oldSchedule = await request('/api/recurring-rules',201,{method:'POST',body:sourceData});
  await request('/api/recurring-rules/'+oldSchedule.rule.id,200,{method:'DELETE'});
  assert.equal((await month('2025-01')).entries[0].recurringRuleId,null);
  const replacement = await request('/api/recurring-rules',201,{method:'POST',body:sourceData});
  assert.notEqual(replacement.rule.id,oldSchedule.rule.id);
  assert.equal((await month('2025-01')).entries[0].recurringRuleId,replacement.rule.id);
  const now = new Date();
  const today = [now.getFullYear(),now.getMonth()+1,now.getDate()].map(v=>String(v).padStart(2,'0')).join('-');
  const upcomingMonth = offset => new Date(Date.UTC(now.getFullYear(),now.getMonth()+offset,1)).toISOString().slice(0,7);
  const nextMonth = upcomingMonth(1);
  const cadenceRule = (await request('/api/recurring-rules',201,{method:'POST',body:{name:'결제일 변경',startsOn:'2020-01-25'}})).rule;
  const cadencePath = '/api/recurring-rules/'+cadenceRule.id+'/payment-day';
  const oldRef = {ruleId:cadenceRule.id,dueDate:'2020-02-25'};
  await request('/api/recurring-occurrences/skip',200,{method:'POST',body:oldRef});
  await request(cadencePath,200,{method:'PUT',body:{effectiveMonth:nextMonth,repeatDay:31}});
  const lastDay = new Date(Date.UTC(now.getFullYear(),now.getMonth()+2,0)).getUTCDate();
  assert.equal((await month(nextMonth)).recurring.find(item=>item.id===cadenceRule.id).dueDate,nextMonth+'-'+lastDay);
  assert.equal((await month('2020-02')).recurring.find(item=>item.id===cadenceRule.id).status,'skipped');
  assert.equal((await month('2020-03')).recurring.find(item=>item.id===cadenceRule.id).dueDate,'2020-03-25');
  const processed = (await request('/api/recurring-rules',201,{method:'POST',body:{name:'처리된 일정',startsOn:today}})).rule;
  await request('/api/recurring-occurrences/skip',200,{method:'POST',body:{ruleId:processed.id,dueDate:today}});
  await request('/api/recurring-rules/'+processed.id+'/payment-day',409,{method:'PUT',body:{effectiveMonth:today.slice(0,7),repeatDay:31}});
  await request(cadencePath,200,{method:'PUT',body:{effectiveMonth:upcomingMonth(3),repeatDay:5}});
  await request(cadencePath,200,{method:'PUT',body:{effectiveMonth:nextMonth,repeatDay:27}});
  assert.equal((await month(upcomingMonth(3))).recurring.find(item=>item.id===cadenceRule.id).dueDate,upcomingMonth(3)+'-27');
  await stop();
  await start();
  assert.equal((await request('/api/recurring-rules/'+cadenceRule.id,200)).rule.dayChanges[0].repeatDay,27);
  console.log('PASS: recurring dates, future payment day changes, concurrency, cross-month posting, deletion, skips and restart');
} finally {
  await stop();
  await rm(dbPath,{force:true});
  await rmdir(folder);
}
