import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const library={};vm.runInNewContext(await readFile(new URL('./dist/analysis.js',import.meta.url),'utf8'),library);
const {aggregate,color}=library.ChagokAnalysis;
const month=new Date().toLocaleDateString('sv-SE').slice(0,7);
let records=[
  {id:1,type:'expense',date:month+'-01',categoryId:1,categoryName:'식비',amount:500,memo:'식사'},
  {id:2,type:'expense',date:month+'-02',categoryId:2,categoryName:'교통비',amount:300,memo:'교통'},
  {id:3,type:'expense',date:month+'-28',categoryId:null,categoryName:null,amount:200,memo:'기타'},
  {id:4,type:'income',date:month+'-10',categoryId:3,categoryName:'급여',amount:2000,memo:'급여'}
];
let result=aggregate(records,'expense',month);
assert.equal(result.total,1000);assert.equal(result.groups[0].name,'식비');assert.equal(result.groups[0].percent,'50%');
assert.equal(result.groups.at(-1).key,'uncategorized');assert.equal(result.groups.reduce((sum,g)=>sum+g.tenths,0),1000);
const thirds=[1,2,3].map(categoryId=>({type:'expense',date:month+'-01',categoryId,categoryName:'분류',amount:1}));
assert.equal(aggregate(thirds,'expense',month).groups.reduce((sum,g)=>sum+g.tenths,0),1000);
const big=[{...thirds[0],amount:Number.MAX_SAFE_INTEGER-1},{...thirds[1],amount:1}];
assert.equal(aggregate(big,'expense',month).groups[1].percent,'<0.1%');
assert.equal(aggregate([],'expense',month).groups.length,0);
assert.equal(aggregate(records,'income',month).total,2000);
assert.equal(color('uncategorized'),'#a58b9c');
assert.equal(color('uncategorized','#112233'),'#a58b9c');
assert.equal(color('1','#ABCDEF'),'#abcdef');
assert.equal(color('1','invalid'),'#3f6b57');
assert.equal(aggregate([{...records[0],categoryColor:'#123456'}],'expense',month).groups[0].color,'#123456');
const nodes=new Map();let failure=false;
const element=()=>({value:'',textContent:'',children:[],events:{},dataset:{},style:{},attributes:{},disabled:false,checked:false,hidden:false,open:false,classList:{add(){},remove(){}},addEventListener(name,fn){this.events[name]=fn;},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},setAttribute(key,value){this.attributes[key]=String(value);},focus(){},showModal(){this.open=true;},close(){this.open=false;}});
const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
$('type-expense').checked=true;
const summaryFor=entries=>({income:aggregate(entries,'income',month).total,expense:aggregate(entries,'expense',month).total,balance:1000,incomeCount:1,expenseCount:3});
vm.runInNewContext(await readFile(new URL('./dist/app.js',import.meta.url),'utf8'),{
  ChagokAnalysis:library.ChagokAnalysis,
  document:{getElementById:$,createElement:element,createElementNS:element,createDocumentFragment:element,createTextNode:text=>({textContent:text}),querySelectorAll:()=>[],querySelector:()=>$('summary')},
  FormData:class{get(){return 'expense';}},fetch:async path=>{if(failure)throw Error('offline');const query=new URL(path,'http://localhost').searchParams.get('month');const entries=records.filter(e=>e.date.startsWith(query));return {ok:true,json:async()=>({entries,categories:[],summary:summaryFor(entries)})};},
  localStorage:{getItem:()=>null},crypto:{randomUUID},AbortSignal,Intl,Date,setTimeout:()=>0,clearTimeout(){}
});
for(let i=0;i<100&&$('save-state').textContent!=='로컬 DB에 저장';i++)await new Promise(resolve=>setTimeout(resolve,1));
const rows=()=>$('analysis-list').children[0].children;
assert.equal($('analysis-center-amount').textContent,'1,000원');assert.equal(rows().length,3);
assert.equal($('analysis-chart').children.length,4);assert.equal($('analysis-details').disabled,true);
rows()[0].events.click();assert.equal($('analysis-center-name').textContent,'식비');assert.equal($('analysis-center-percent').textContent,'50%');
$('date').value=month+'-28';await $('date').events.change();
assert.equal($('analysis-center-name').textContent,'식비');assert.equal($('analysis-total').textContent,'총 1,000원');
$('analysis-details').events.click();assert.equal($('analysis-dialog').open,true);
assert.equal($('analysis-records').children[0].children.length,1);
await $('analysis-records').children[0].children[0].events.click();assert.equal($('date').value,month+'-01');assert.equal($('analysis-dialog').open,false);
rows()[0].events.click();assert.equal($('analysis-center-name').textContent,'총지출');
$('analysis-chart').children[1].events.keydown({key:'Enter',preventDefault(){}});assert.equal($('analysis-center-name').textContent,'식비');
records=records.map(record=>record.categoryId===1?{...record,categoryName:'식사비'}:record);
await $('retry-load').events.click();assert.equal($('analysis-center-name').textContent,'식사비');
records=records.map(record=>record.categoryId===1?{...record,categoryColor:'#123456'}:record);
await $('retry-load').events.click();
assert.equal($('analysis-chart').children[1].attributes.stroke,'#123456');
assert.equal(rows()[0].children[0].children[0].style.backgroundColor,'#123456');
records=records.map(record=>record.categoryId===1?{...record,categoryId:null,categoryName:null}:record);
await $('retry-load').events.click();assert.equal(rows().length,2);assert.equal($('analysis-center-name').textContent,'총지출');
assert.equal(rows()[0].children[0].children[1].textContent,'미분류');
$('analysis-income').events.click();assert.equal(rows().length,1);assert.equal($('analysis-center-name').textContent,'총수입');assert.equal($('analysis-center-amount').textContent,'2,000원');
rows()[0].events.click();await $('next-month').events.click();assert.equal($('analysis-status').hidden,false);assert.equal($('analysis-donut').hidden,true);
await $('prev-month').events.click();assert.equal($('analysis-center-name').textContent,'총수입');
failure=true;await $('retry-load').events.click();assert.equal($('analysis-donut').hidden,true);assert.equal($('analysis-details').disabled,true);assert.equal($('analysis-total').textContent,'—');
console.log('PASS: category totals and rounding, future dates, uncategorized, SVG segments, selection, keyboard, details navigation, rename/delete, tabs, month reset, empty and failure states');
