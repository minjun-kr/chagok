'use strict';
globalThis.ChagokMonthPicker=Object.freeze({
  init({getMonth,onSelect}) {
    const $=id=>document.getElementById(id);
    let open=false,buttons=[];
    const readYear=()=>/^\d{4}$/.test(String($('month-year').value))&&Number($('month-year').value)>=1000&&Number($('month-year').value)<=9999?Number($('month-year').value):null;
    function close(restoreFocus=false) {
      open=false;$('month-popover').hidden=true;$('month-toggle').setAttribute('aria-expanded','false');
      if(restoreFocus)$('month-toggle').focus();
    }
    function renderMonths() {
      const year=readYear(),selected=getMonth();
      $('month-year-error').hidden=year!==null;$('month-year-error').textContent=year===null?'연도는 1000~9999년으로 입력해 주세요.':'';
      $('month-year-prev').disabled=year===null||year===1000;$('month-year-next').disabled=year===null||year===9999;
      const fragment=document.createDocumentFragment();buttons=[];
      for(let month=1;month<=12;month++) {
        const value=String(year)+'-'+String(month).padStart(2,'0');
        const button=document.createElement('button');button.type='button';button.className='month-option';button.textContent=month+'월';button.disabled=year===null;button.dataset.month=String(month);
        button.setAttribute('aria-pressed',String(year!==null&&value===selected));button.setAttribute('aria-label',year===null?month+'월':year+'년 '+month+'월');
        button.addEventListener('click',async()=>{if(year===null)return;close(true);await onSelect(value);});
        button.addEventListener('keydown',event=>{
          const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3};
          if(!Object.hasOwn(offsets,event.key)&&event.key!=='Home'&&event.key!=='End')return;
          event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?11:(month-1+offsets[event.key]+12)%12;buttons[index]?.focus();
        });
        buttons.push(button);fragment.append(button);
      }
      $('month-options').replaceChildren(fragment);
    }
    function show() {
      $('month-year').value=getMonth().slice(0,4);renderMonths();
      open=true;$('month-popover').hidden=false;$('month-toggle').setAttribute('aria-expanded','true');buttons[Number(getMonth().slice(5))-1]?.focus();
    }
    $('month-toggle').addEventListener('click',()=>{if(open)close(true);else show();});
    $('month-toggle').addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();show();}});
    $('month-popover-close').addEventListener('click',()=>close(true));
    $('month-year').addEventListener('input',renderMonths);
    $('month-year').addEventListener('change',renderMonths);
    $('month-year').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(readYear()!==null)buttons[Number(getMonth().slice(5))-1]?.focus();}});
    for(const [id,offset] of [['month-year-prev',-1],['month-year-next',1]])$(id).addEventListener('click',()=>{
      const year=readYear();if(year===null||year+offset<1000||year+offset>9999)return;
      $('month-year').value=String(year+offset);renderMonths();
    });
    document.addEventListener('keydown',event=>{if(open&&event.key==='Escape'){event.preventDefault();close(true);}});
    document.addEventListener('click',event=>{if(open&&!$('month-picker-container').contains(event.target))close();});
    document.addEventListener('focusin',event=>{if(open&&!$('month-picker-container').contains(event.target))close();});
    function sync(value) {
      $('month-label').textContent=`${value.slice(0,4)}년 ${Number(value.slice(5))}월`;
      $('month-toggle').setAttribute('aria-label',`${value.slice(0,4)}년 ${Number(value.slice(5))}월, 월 선택`);close();
    }
    sync(getMonth());return {sync};
  }
});
