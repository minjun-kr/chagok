'use strict';
globalThis.ChagokBudget=(()=>{
  const fmt=new Intl.NumberFormat('ko-KR');
  const money=value=>fmt.format(value)+'원';
  const state=(spent,amount)=>spent>amount?'over':amount>0&&BigInt(spent)*5n>=BigInt(amount)*4n?'warning':'normal';
  function percentage(spent,amount) {
    if(!amount)return spent?'초과':'0%';
    const tenths=(BigInt(spent)*1000n+BigInt(amount)/2n)/BigInt(amount);
    return fmt.format(tenths/10n)+(tenths%10n?'.'+tenths%10n:'')+'%';
  }
  function summarize({month,budget,entries,categories}) {
    const grouped=new Map();let spent=0;
    for(const entry of entries) {
      if(entry.type!=='expense'||entry.date.slice(0,7)!==month||entry.deletedAt||entry.deleted_at)continue;
      spent+=entry.amount;
      const key=entry.categoryId==null?'uncategorized':String(entry.categoryId);
      const item=grouped.get(key)||{key,name:entry.categoryName||'미분류',spent:0};item.spent+=entry.amount;grouped.set(key,item);
    }
    const assigned=(budget?.categories||[]).map(row=>{
      const category=categories.find(item=>item.id===row.categoryId&&item.type==='expense');
      return category?{key:String(row.categoryId),name:category.name,amount:row.amount,spent:grouped.get(String(row.categoryId))?.spent||0}:null;
    }).filter(Boolean);
    assigned.sort((a,b)=>Number(b.spent>b.amount)-Number(a.spent>a.amount)||((b.amount?b.spent/b.amount:b.spent?Infinity:0)-(a.amount?a.spent/a.amount:a.spent?Infinity:0))||a.name.localeCompare(b.name,'ko'));
    const keys=new Set(assigned.map(row=>row.key));
    const unassigned=[...grouped.values()].filter(row=>!keys.has(row.key)).sort((a,b)=>b.spent-a.spent||a.name.localeCompare(b.name,'ko'));
    return {spent,assigned,unassigned,overCount:assigned.filter(row=>row.spent>row.amount).length};
  }
  function init({api,refresh,getMonth,openCategory}) {
    const $=id=>document.getElementById(id);
    let current=null,expanded=false,editorMonth=null,busy=false,draftInputs=[],persisted=false;
    const failure=error=>error.name==='TypeError'?'서버에 연결할 수 없어요. 입력 내용을 유지했으니 다시 시도해 주세요.':error.name==='TimeoutError'?'응답을 확인하지 못했어요. 다시 시도해 주세요.':error.message;
    const previous=month=>{
      const [year,num]=month.split('-').map(Number);
      return num===1?String(year-1).padStart(4,'0')+'-12':String(year).padStart(4,'0')+'-'+String(num-1).padStart(2,'0');
    };
    function track(spent,amount) {
      const node=document.createElement('span');node.className='budget-track';
      const bar=document.createElement('span');bar.style.width=(amount?Math.min(100,spent/amount*100):spent?100:0)+'%';node.append(bar);node.setAttribute('aria-hidden','true');return node;
    }
    function render(data) {
      if(current?.month!==data.month)expanded=false;
      current=data;
      $('budget-heading').textContent=`${Number(data.month.slice(5))}월 예산`;
      $('budget-open').disabled=false;$('budget-retry').hidden=true;
      $('budget-content').hidden=!data.budget;$('budget-status').hidden=!!data.budget;
      $('budget-status').textContent='이번 달 예산을 정해보세요.';
      $('budget-card').dataset.state='normal';
      if(!data.budget){$('summary-budget-remaining').textContent='미설정';$('summary-budget-track').hidden=true;$('summary-budget-status').textContent='월 예산이 설정되지 않았어요.';return;}
      const result=summarize(data),amount=data.budget.amount,{spent}=result;
      $('budget-card').dataset.state=state(spent,amount);
      $('summary-budget-remaining').textContent=spent>amount?money(spent-amount)+' 초과':money(amount-spent);
      $('summary-budget-status').textContent=percentage(spent,amount)+' 사용';
      $('summary-budget-track').hidden=false;$('summary-budget-bar').style.width=(amount?Math.min(100,spent/amount*100):spent?100:0)+'%';
      $('summary-budget-track').dataset.state=state(spent,amount);
      $('budget-remaining').textContent=spent>amount?`예산보다 ${money(spent-amount)} 초과`:`남은 예산 ${money(amount-spent)}`;
      $('budget-used').textContent=`${money(amount)} 중 ${money(spent)} 사용`;
      $('budget-percent').textContent=percentage(spent,amount);
      const width=amount?Math.min(100,spent/amount*100):spent?100:0;
      $('budget-bar').style.width=width+'%';
      $('budget-progress').setAttribute('aria-valuenow',String(width));
      $('budget-progress').setAttribute('aria-valuetext',`${money(amount)} 중 ${money(spent)} 사용 · ${percentage(spent,amount)}`);
      $('budget-alert').textContent=result.overCount?`초과한 항목 ${result.overCount}개`:spent===amount&&amount>0?'예산을 모두 사용했어요.':state(spent,amount)==='warning'?`예산의 ${percentage(spent,amount)}를 사용했어요.`:'';
      const fragment=document.createDocumentFragment();
      for(const row of result.assigned) {
        const button=document.createElement('button');button.type='button';button.className='budget-category';button.dataset.key=row.key;button.dataset.state=state(row.spent,row.amount);button.disabled=!row.spent;
        const heading=document.createElement('span');heading.className='budget-category-heading';
        const name=document.createElement('strong');name.textContent=row.name;
        const remaining=document.createElement('span');remaining.textContent=row.spent>row.amount?money(row.spent-row.amount)+' 초과':money(row.amount-row.spent)+' 남음';heading.append(name,remaining);
        const usage=document.createElement('span');usage.className='budget-category-usage';usage.textContent=`${money(row.spent)} / ${money(row.amount)}`;
        button.setAttribute('aria-label',`${row.name}, ${usage.textContent}, ${remaining.textContent}${row.spent?', 지출 내역 보기':', 지출 내역 없음'}`);
        button.append(heading,usage,track(row.spent,row.amount));button.addEventListener('click',()=>{if(row.spent)openCategory(row.key);});fragment.append(button);
      }
      if(!result.assigned.length){const text=document.createElement('p');text.className='category-description';text.textContent='설정한 카테고리별 예산이 없어요. 예산 설정에서 추가할 수 있어요.';fragment.append(text);}
      $('budget-category-list').replaceChildren(fragment);
      const unassigned=document.createDocumentFragment();
      const heading=document.createElement('p');heading.className='budget-unassigned-title';heading.textContent=`예산 미설정 지출 · 총 ${money(result.unassigned.reduce((sum,row)=>sum+row.spent,0))}`;unassigned.append(heading);
      result.unassigned.forEach(row=>{const button=document.createElement('button');button.type='button';button.className='budget-link';button.textContent=`${row.name} ${money(row.spent)}`;button.addEventListener('click',()=>openCategory(row.key));unassigned.append(button);});
      $('budget-unassigned').replaceChildren(unassigned);toggle(expanded);
    }
    function toggle(value) {expanded=value;$('budget-details').hidden=!expanded;$('budget-toggle').setAttribute('aria-expanded',String(expanded));$('budget-toggle').textContent=expanded?'카테고리별 현황 접기 ⌃':'카테고리별 현황 보기 ⌄';}
    function parse(value) {
      const raw=value.replace(/,/g,'').trim();
      if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>999999999999)throw Error('예산은 0~999,999,999,999원의 정수로 입력해 주세요.');
      return Number(raw);
    }
    function draft() {
      const amount=parse($('budget-amount').value),categories=[];
      let allocated=0;
      for(const {categoryId,input} of draftInputs)if(input.value.trim()!==''){const value=parse(input.value);allocated+=value;categories.push({categoryId,amount:value});}
      if(!Number.isSafeInteger(allocated))throw Error('카테고리 배정 합계가 너무 커요.');
      return {amount,categories,allocated};
    }
    function allocation() {
      let valid=false;
      try {
        const data=draft(),remaining=data.amount-data.allocated;valid=remaining>=0;
        $('budget-allocated').textContent=money(data.allocated);
        $('budget-unallocated-label').textContent=remaining<0?'배정 초과':'미배정 예산';
        $('budget-unallocated').textContent=money(Math.abs(remaining));
        $('budget-error').textContent=valid?'':'카테고리 배정 합계가 월 전체 예산을 초과했어요.';
      }catch(error){$('budget-allocated').textContent='—';$('budget-unallocated').textContent='—';$('budget-error').textContent=$('budget-amount').value?error.message:'';}
      $('budget-save').disabled=busy||!valid;
      return valid;
    }
    function setBusy(value) {
      busy=value;
      for(const id of ['budget-amount','budget-close','budget-cancel','budget-copy','budget-delete','budget-delete-cancel','budget-delete-confirm'])$(id).disabled=value;
      $('budget-copy').disabled=value||editorMonth==='1000-01';draftInputs.forEach(({input})=>input.disabled=value);
      if(value)$('budget-save').disabled=true;
      else { // Keep a request failure visible until the next input or retry.
        const error=$('budget-error').textContent;allocation();if(error)$('budget-error').textContent=error;
      }
    }
    function moneyInput(input) {
      input.addEventListener('input',()=>{
        const raw=input.value.replace(/,/g,'');
        if(/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw)))input.value=fmt.format(Number(raw));
        allocation();
      });
    }
    moneyInput($('budget-amount'));
    function fill(budget) {
      $('budget-amount').value=budget?fmt.format(budget.amount):'';
      for(const {categoryId,input} of draftInputs){const row=budget?.categories.find(row=>row.categoryId===categoryId);input.value=row?fmt.format(row.amount):'';}
      allocation();
    }
    $('budget-open').addEventListener('click',()=>{
      if(busy||!current||current.month!==getMonth())return;
      editorMonth=current.month;persisted=!!current.budget;
      $('budget-dialog-title').textContent=`${editorMonth.slice(0,4)}년 ${Number(editorMonth.slice(5))}월 예산 설정`;
      $('budget-error').textContent='';$('budget-copy-status').textContent='';$('budget-delete-panel').hidden=true;$('budget-delete').hidden=!persisted;
      const fragment=document.createDocumentFragment();draftInputs=[];
      current.categories.filter(category=>category.type==='expense').forEach(category=>{
        const row=document.createElement('div');row.className='budget-input-row';
        const label=document.createElement('label');label.textContent=category.name;label.setAttribute('for','budget-category-'+category.id);
        const input=document.createElement('input');input.id='budget-category-'+category.id;input.className='field';input.inputMode='numeric';input.maxLength=15;input.autocomplete='off';input.placeholder='미설정';input.setAttribute('aria-label',category.name+' 예산');
        const unit=document.createElement('span');unit.textContent='원';moneyInput(input);row.append(label,input,unit);fragment.append(row);draftInputs.push({categoryId:category.id,input});
      });
      $('budget-inputs').replaceChildren(fragment);$('budget-no-categories').hidden=!!draftInputs.length;
      fill(current.budget);setBusy(false);$('budget-dialog').showModal();$('budget-amount').focus();
    });
    for(const id of ['budget-close','budget-cancel'])$(id).addEventListener('click',()=>{if(!busy)$('budget-dialog').close();});
    $('budget-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    $('budget-toggle').addEventListener('click',()=>toggle(!expanded));
    $('budget-retry').addEventListener('click',refresh);
    $('budget-copy').addEventListener('click',async()=>{
      if(busy||editorMonth==='1000-01')return;
      setBusy(true);$('budget-error').textContent='';$('budget-copy-status').textContent='';
      try {
        const {budget}=await api('/api/budgets?month='+previous(editorMonth));
        if(!budget)$('budget-copy-status').textContent='지난달에 설정한 예산이 없어요. 현재 입력은 유지돼요.';
        else {fill(budget);$('budget-copy-status').textContent='지난달 예산을 불러왔어요. 저장하면 이 달에 반영돼요.';}
      }catch(error){$('budget-error').textContent=failure(error);}finally{setBusy(false);}
    });
    $('budget-form').addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!allocation())return;
      const {amount,categories}=draft();setBusy(true);$('budget-error').textContent='';
      try {await api('/api/budgets/'+editorMonth,{amount,categories},'PUT');$('budget-dialog').close();await refresh();}
      catch(error){$('budget-error').textContent=failure(error);}finally{setBusy(false);}
    });
    $('budget-delete').addEventListener('click',()=>{if(!busy&&persisted){$('budget-delete-panel').hidden=false;$('budget-delete-cancel').focus();}});
    $('budget-delete-cancel').addEventListener('click',()=>{if(!busy)$('budget-delete-panel').hidden=true;});
    $('budget-delete-confirm').addEventListener('click',async()=>{
      if(busy||!persisted)return;setBusy(true);$('budget-error').textContent='';
      try {await api('/api/budgets/'+editorMonth,undefined,'DELETE');$('budget-dialog').close();await refresh();}
      catch(error){$('budget-error').textContent=failure(error);}finally{setBusy(false);}
    });
    function loading() {$('summary-budget-remaining').textContent='—';$('summary-budget-track').hidden=true;$('budget-status').hidden=false;$('budget-status').textContent='예산을 불러오는 중이에요.';$('budget-content').hidden=true;$('budget-retry').hidden=true;$('budget-open').disabled=true;}
    function error() {$('summary-budget-remaining').textContent='조회 실패';$('summary-budget-track').hidden=true;$('budget-status').hidden=false;$('budget-status').textContent='예산을 불러오지 못했어요.';$('budget-content').hidden=true;$('budget-retry').hidden=false;$('budget-open').disabled=true;}
    return {render,loading,error};
  }
  return Object.freeze({init,summarize,percentage});
})();
