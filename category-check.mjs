import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const nodes=new Map();
const element=()=>({value:'',textContent:'',children:[],events:{},dataset:{},attributes:{},disabled:false,checked:false,hidden:false,classList:{add(){},remove(){}},addEventListener(name,fn){this.events[name]=fn;},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},setAttribute(key,value){this.attributes[key]=value;},focus(){}});
const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
$('type-expense').value='expense';$('type-expense').checked=true;
$('type-income').value='income';
const categories=[{id:1,type:'expense',name:'식비'},{id:2,type:'income',name:'급여'}];
const saved=[];
let failRead=false;
function chooseType(type){$('type-income').checked=type==='income';$('type-expense').checked=type==='expense';$('type-'+type).events.change();}
const options=()=>$('category').children[0].children.map(option=>option.textContent);
const summary=()=>({income:0,expense:0,balance:0,incomeCount:0,expenseCount:0});
vm.runInNewContext(await readFile(new URL('./dist/app.js',import.meta.url),'utf8'),{
  document:{getElementById:$,createElement:element,createDocumentFragment:element,createTextNode:text=>({textContent:text}),querySelectorAll:selector=>selector==='input[name="type"]'?[$('type-income'),$('type-expense')]:[],querySelector:()=>$('summary')},
  // Like the browser, FormData excludes disabled controls even if checked.
  FormData:class{get(name){return name==='type'?[$('type-income'),$('type-expense')].find(input=>input.checked&&!input.disabled)?.value??null:null;}},
  fetch:async(path,init)=>{
    if(init.method==='POST'){saved.push(JSON.parse(init.body));return {ok:true,json:async()=>({saved:true})};}
    if(failRead)throw new TypeError('offline');
    return {ok:true,json:async()=>({entries:[],categories,summary:summary()})};
  },
  localStorage:{getItem:()=>null},crypto:{randomUUID},AbortSignal,Intl,Date,setTimeout:()=>0,clearTimeout(){}
});
for(let i=0;i<100&&$('save-state').textContent!=='로컬 DB에 저장';i++)await new Promise(resolve=>setTimeout(resolve,1));
assert.deepEqual(options(),['미분류','식비']);
assert.match($('holiday-note').textContent,/공휴일 정보를 불러오지 못/);
async function submit(categoryId){$('category').value=String(categoryId);$('amount').value='1000';$('memo').value='연속 입력';await $('entry-form').events.submit({preventDefault(){}});}
for(const type of ['expense','income']) {
  chooseType(type);
  const id=type==='expense'?1:2,name=type==='expense'?'식비':'급여';
  await submit(id);
  assert.deepEqual(options(),['미분류',name],`${type}: categories must remain after saving while radios are disabled`);
  assert.equal($('category').disabled,false);
  await submit(id);
  assert.equal(saved.at(-1).categoryId,id);
  assert.equal(saved.at(-1).type,type);
  assert.deepEqual(options(),['미분류',name]);
}
// Successful save followed by a failed refresh must still leave choices usable.
failRead=true;chooseType('expense');await submit(1);
assert.deepEqual(options(),['미분류','식비']);assert.equal($('category').disabled,false);
console.log('PASS: consecutive income/expense saves preserve category options and assignments, including refresh failure');
