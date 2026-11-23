import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const nodes=new Map(),events={};let current='2026-11',selected=null;
const element=()=>({value:'',textContent:'',children:[],events:{},attributes:{},dataset:{},disabled:false,hidden:false,focused:false,addEventListener(n,f){this.events[n]=f;},append(...a){this.children.push(...a);},replaceChildren(...a){this.children=a;},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;},contains(target){return target===this||this.children.some(child=>child.contains?.(target));}});
const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
const document={getElementById:$,createElement:element,createDocumentFragment:element,addEventListener(n,f){events[n]=f;}};
const sandbox={document};vm.runInNewContext(await readFile(new URL('./dist/month-picker.js',import.meta.url),'utf8'),sandbox);
let picker;
picker=sandbox.ChagokMonthPicker.init({getMonth:()=>current,onSelect:async value=>{selected=value;current=value;picker.sync(value);}});
$('month-picker-container').append($('month-toggle'),$('month-popover'));
$('month-popover').append($('month-year'),$('month-options'),$('month-popover-close'));
const months=()=>$('month-options').children[0].children;
const event=key=>({key,preventDefault(){this.prevented=true;}});
assert.equal($('month-label').textContent,'2026년 11월');assert.equal($('month-toggle').attributes['aria-expanded'],'false');
$('month-toggle').events.click();assert.equal($('month-popover').hidden,false);assert.equal(months().length,12);assert.equal(months()[10].attributes['aria-pressed'],'true');assert.equal(months()[10].focused,true);
months()[0].events.keydown(event('ArrowLeft'));assert.equal(months()[11].focused,true);
months()[0].events.keydown(event('ArrowDown'));assert.equal(months()[3].focused,true);
months()[0].events.keydown(event('End'));assert.equal(months()[11].focused,true);
$('month-year-next').events.click();assert.equal($('month-year').value,'2027');assert.ok(months().every(button=>button.attributes['aria-pressed']==='false'));assert.equal(current,'2026-11','Browsing years does not change the viewed month');
$('month-popover-close').events.click();assert.equal($('month-popover').hidden,true);assert.equal(current,'2026-11');
$('month-toggle').events.click();assert.equal($('month-year').value,'2026');
for(const year of ['','999','10000','2026.5','-2026']) {
  $('month-year').value=year;$('month-year').events.input();assert.equal($('month-year-error').hidden,false);assert.ok(months().every(button=>button.disabled));
  await months()[1].events.click();assert.equal(selected,null);
}
$('month-year').value='1000';$('month-year').events.input();assert.equal($('month-year-prev').disabled,true);assert.equal($('month-year-next').disabled,false);
await months()[0].events.click();assert.equal(selected,'1000-01');assert.equal($('month-label').textContent,'1000년 1월');
$('month-toggle').events.click();$('month-year').value='9999';$('month-year').events.change();assert.equal($('month-year-next').disabled,true);
await months()[11].events.click();assert.equal(selected,'9999-12');assert.equal($('month-toggle').attributes['aria-expanded'],'false');
$('month-toggle').events.keydown(event('ArrowDown'));assert.equal($('month-popover').hidden,false);
events.keydown(event('Escape'));assert.equal($('month-popover').hidden,true);assert.equal($('month-toggle').focused,true);
$('month-toggle').events.click();events.click({target:$('month-year')});assert.equal($('month-popover').hidden,false);
events.click({target:element()});assert.equal($('month-popover').hidden,true);
$('month-toggle').events.click();events.focusin({target:element()});assert.equal($('month-popover').hidden,true);
$('month-toggle').events.click();picker.sync('2040-02');assert.equal($('month-label').textContent,'2040년 2월');assert.equal($('month-popover').hidden,true);
console.log('PASS: month picker draft years, direct selection, year limits, invalid input, keyboard navigation, Escape, outside dismissal and external sync');
