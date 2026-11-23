'use strict';
globalThis.ChagokMonthly=(()=>{
  const fmt=new Intl.NumberFormat('ko-KR');
  const money=value=>fmt.format(value)+'원';
  const categoryKey=entry=>entry.categoryId==null?'uncategorized':String(entry.categoryId);
  const paymentKey=entry=>entry.paymentMethodId==null?'unspecified':String(entry.paymentMethodId);
  const defaults=()=>({query:'',type:'all',category:'all',payment:'all',sort:'desc'});
  function matches(entry,filters,month) {
    return entry.date.slice(0,7)===month&&!entry.deletedAt&&!entry.deleted_at&&
      (filters.type==='all'||entry.type===filters.type)&&
      (filters.category==='all'||categoryKey(entry)===filters.category)&&
      (filters.payment==='all'||entry.type==='expense'&&paymentKey(entry)===filters.payment)&&
      (entry.memo||'').toLocaleLowerCase('ko').includes(filters.query.trim().toLocaleLowerCase('ko'));
  }
  function select(entries,filters,month) {
    const direction=filters.sort==='asc'?1:-1;
    return entries.filter(entry=>matches(entry,filters,month)).sort((a,b)=>direction*(a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0)||a.id-b.id));
  }
  function totals(entries) {return entries.reduce((sum,entry)=>{sum[entry.type]+=entry.amount;return sum;},{income:0,expense:0});}
  function init({onEdit,onDelete,onCalendar,onInput,onRetry,today,onViewChange,getEntryTitle}) {
    const $=id=>document.getElementById(id);
    let filters=defaults(),view='calendar',data=null,month=null,ready=false,busy=false,editingId=null,limit=50;
    const rowNodes=new Map();
    function chooseView(value) {
      view=value;
      for(const name of ['calendar','week','monthly']) {
        const active=name===view;$('view-'+name).setAttribute('aria-selected',String(active));$('view-'+name).setAttribute('tabindex',active?'0':'-1');
      }
      $('calendar-view').hidden=view==='monthly';$('monthly-view').hidden=view!=='monthly';
      onViewChange?.(view);
    }
    for(const name of ['calendar','week','monthly']) {
      $('view-'+name).addEventListener('click',()=>chooseView(name));
      $('view-'+name).addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const names=['calendar','week','monthly'],index=names.indexOf(view);const next=event.key==='Home'?'calendar':event.key==='End'?'monthly':names[(index+(event.key==='ArrowRight'?1:2))%3];chooseView(next);$('view-'+next).focus();
      });
    }
    function fillSelect(id,options,selected) {
      const fragment=document.createDocumentFragment();
      options.forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;fragment.append(option);});
      $(id).replaceChildren(fragment);$(id).value=options.some(([value])=>value===selected)?selected:'all';return $(id).value;
    }
    function options(prefix,type,category,payment) {
      const categories=(data?.categories||[]).filter(item=>type==='all'||item.type===type);
      const categoryOptions=[['all','전체'],['uncategorized','미분류'],...categories.map(item=>[String(item.id),item.name+(type==='all'?` · ${item.type==='income'?'수입':'지출'}`:'')])];
      const selected=fillSelect(prefix+'category',categoryOptions,category);
      const payments=[['all','전체'],['unspecified','미지정'],...(data?.paymentMethods||[]).map(item=>[String(item.id),item.name+(item.active?'':' · 사용 중지')])];
      const selectedPayment=fillSelect(prefix+'payment',payments,type==='income'?'all':payment);
      $(prefix+'payment-label').hidden=type==='income';$(prefix+'payment').disabled=!ready||type==='income';
      return {category:selected,payment:selectedPayment};
    }
    function syncControls() {
      $('monthly-search').value=filters.query;$('monthly-type').value=filters.type;$('monthly-sort').value=filters.sort;
      const selected=options('monthly-',filters.type,filters.category,filters.payment);Object.assign(filters,selected);
      const count=Number(filters.type!=='all')+Number(filters.category!=='all')+Number(filters.payment!=='all');
      $('monthly-filter-open').textContent=count?`필터 ${count}`:'필터';
      $('monthly-reset').hidden=!count&&!filters.query.trim();
    }
    function reset({keepSort=true}={}) {
      const sort=filters.sort;filters=defaults();if(keepSort)filters.sort=sort;
      limit=50;$('monthly-scroll').scrollTop=0;$('monthly-action-status').textContent='';syncControls();
    }
    function changed() {limit=50;$('monthly-scroll').scrollTop=0;$('monthly-action-status').textContent='';syncControls();if(ready)renderRows();}
    $('monthly-search').addEventListener('input',()=>{filters.query=$('monthly-search').value;changed();});
    for(const key of ['type','category','payment','sort'])$('monthly-'+key).addEventListener('change',()=>{filters[key]=$('monthly-'+key).value;changed();});
    $('monthly-reset').addEventListener('click',()=>{reset();if(ready)renderRows();});
    $('monthly-more').addEventListener('click',()=>{if(ready){limit+=50;renderRows();}});
    $('monthly-retry').addEventListener('click',onRetry);
    $('monthly-empty-action').addEventListener('click',()=>{
      if(!ready)return;
      if(data.entries.length){reset();renderRows();$('monthly-search').focus();}else onInput();
    });
    function dayLabel(date) {
      const [,month,day]=date.split('-');const weekday=['일','월','화','수','목','금','토'][new Date(date+'T00:00:00Z').getUTCDay()];
      return `${Number(month)}월 ${Number(day)}일 ${weekday}요일`;
    }
    function renderRows() {
      if(!ready)return;
      const scroll=$('monthly-scroll').scrollTop||0;
      const result=select(data.entries,filters,month),sum=totals(result);
      $('monthly-result').textContent=`총 ${fmt.format(data.entries.length)}건 중 ${fmt.format(result.length)}건 · 결과 수입 ${money(sum.income)} · 결과 지출 ${money(sum.expense)}`;
      $('monthly-status').hidden=!!result.length;
      $('monthly-status').textContent=data.entries.length?'조건에 맞는 기록이 없어요.':'이 달에는 아직 기록이 없어요.';
      $('monthly-empty-action').hidden=!!result.length;$('monthly-empty-action').textContent=data.entries.length?'필터 초기화':'기록 입력하기';
      $('monthly-scroll').hidden=!result.length;$('monthly-retry').hidden=true;
      const daily=new Map();result.forEach(entry=>{const day=daily.get(entry.date)||{income:0,expense:0};day[entry.type]+=entry.amount;daily.set(entry.date,day);});
      const fragment=document.createDocumentFragment();let lastDate=null,group=null;rowNodes.clear();
      result.slice(0,limit).forEach(entry=>{
        if(entry.date!==lastDate) {
          lastDate=entry.date;group=document.createElement('section');group.className='monthly-day';group.dataset.date=entry.date;
          const header=document.createElement('div');header.className='monthly-day-heading';
          const title=document.createElement('h3');title.textContent=dayLabel(entry.date);
          if(entry.date>today){const badge=document.createElement('span');badge.className='monthly-future';badge.textContent='예정 날짜';title.append(badge);}
          const jump=document.createElement('button');jump.type='button';jump.className='monthly-link';jump.textContent='달력에서 보기';jump.disabled=busy;jump.setAttribute('aria-label',dayLabel(entry.date)+' 달력에서 보기');
          jump.addEventListener('click',async()=>{if(busy)return;chooseView('calendar');await onCalendar(entry.date);});header.append(title,jump);
          const sum=document.createElement('p');sum.className='monthly-day-total';sum.textContent=`조회 조건 기준 · 수입 ${money(daily.get(entry.date).income)} / 지출 ${money(daily.get(entry.date).expense)}`;
          group.append(header,sum);fragment.append(group);
        }
        const row=document.createElement('article');row.className='monthly-record';row.dataset.id=String(entry.id);row.dataset.editing=String(entry.id===editingId);
        const info=document.createElement('div');info.className='monthly-record-info';
        const title=document.createElement('div');title.className='monthly-record-title';
        const detailTrigger=getEntryTitle?.(entry,busy);
        if(detailTrigger)title.append(detailTrigger);
        else title.textContent=entry.memo||(entry.type==='income'?'수입':'지출');
        if(entry.id===editingId){const badge=document.createElement('span');badge.className='monthly-editing';badge.textContent='수정 중';title.append(badge);}
        const meta=document.createElement('p');meta.className='monthly-record-meta';meta.textContent=`${entry.type==='income'?'수입':'지출'} · ${entry.categoryName||'미분류'}`+(entry.type==='expense'?` · ${entry.paymentMethodName||'미지정'}`:'');info.append(title,meta);
        const controls=document.createElement('div');controls.className='monthly-record-controls';
        const amount=document.createElement('strong');amount.className='monthly-amount '+entry.type;amount.textContent=(entry.type==='income'?'+':'−')+money(entry.amount);
        const actions=document.createElement('div');actions.className='record-actions';
        for(const [action,label,handler] of [['edit','수정',onEdit],['delete','삭제',onDelete]]) {
          const button=document.createElement('button');button.type='button';button.className='record-action';button.dataset.action=action;button.textContent=label;button.disabled=busy;
          button.setAttribute('aria-label',`${dayLabel(entry.date)} ${entry.memo||(entry.type==='income'?'수입':'지출')} ${money(entry.amount)} ${label}`);
          button.addEventListener('click',async()=>{if(!busy)await handler(entry);});actions.append(button);
        }
        controls.append(amount,actions);row.append(info,controls);group.append(row);rowNodes.set(entry.id,row);
      });
      $('monthly-list').replaceChildren(fragment);$('monthly-more').hidden=result.length<=limit;$('monthly-more').textContent=`더 보기 (${Math.min(limit,result.length)} / ${result.length}건)`;
      $('monthly-scroll').scrollTop=scroll;
    }
    function render(value) {
      if(month!==value.month){month=value.month;reset();}
      data=value;ready=true;
      $('monthly-title').textContent=`${month.slice(0,4)}년 ${Number(month.slice(5))}월 전체 내역`;
      enableControls();syncControls();renderRows();
    }
    function enableControls() {for(const id of ['monthly-search','monthly-type','monthly-category','monthly-sort','monthly-filter-open','monthly-reset'])$(id).disabled=!ready;}
    function loading(value) {
      if(month!==value){month=value;reset();}
      ready=false;enableControls();$('monthly-payment').disabled=true;
      $('monthly-result').textContent='';$('monthly-scroll').hidden=true;$('monthly-empty-action').hidden=true;$('monthly-status').hidden=false;$('monthly-status').textContent='기록을 불러오는 중이에요.';$('monthly-retry').hidden=true;
    }
    function error() {ready=false;enableControls();$('monthly-payment').disabled=true;$('monthly-result').textContent='';$('monthly-scroll').hidden=true;$('monthly-empty-action').hidden=true;$('monthly-status').hidden=false;$('monthly-status').textContent='월 전체 내역을 불러오지 못했어요. 서버 연결을 확인한 뒤 다시 시도해 주세요.';$('monthly-retry').hidden=false;}
    function setEditing(id) {editingId=id;if(ready)renderRows();}
    function setBusy(value) {busy=value;if(ready)renderRows();}
    function afterSave(entry) {
      if(!ready||entry.id==null)return;
      if(!matches(entry,filters,month)){$('monthly-action-status').textContent='수정한 기록이 현재 조회 조건에서 제외됐어요.';return;}
      const index=select(data.entries,filters,month).findIndex(item=>item.id===entry.id);
      if(index>=limit){limit=Math.ceil((index+1)/50)*50;renderRows();}
      if(view==='monthly')rowNodes.get(entry.id)?.scrollIntoView?.({block:'nearest'});
    }
    $('monthly-filter-open').addEventListener('click',()=>{
      if(!ready)return;
      $('monthly-mobile-type').value=filters.type;options('monthly-mobile-',filters.type,filters.category,filters.payment);$('monthly-filter-dialog').showModal();$('monthly-mobile-type').focus();
    });
    $('monthly-mobile-type').addEventListener('change',()=>options('monthly-mobile-',$('monthly-mobile-type').value,$('monthly-mobile-category').value,$('monthly-mobile-payment').value));
    $('monthly-filter-close').addEventListener('click',()=>$('monthly-filter-dialog').close());
    $('monthly-filter-reset').addEventListener('click',()=>{$('monthly-mobile-type').value='all';options('monthly-mobile-','all','all','all');});
    $('monthly-filter-apply').addEventListener('click',()=>{
      if(!ready)return;
      filters.type=$('monthly-mobile-type').value;filters.category=$('monthly-mobile-category').value;filters.payment=filters.type==='income'?'all':$('monthly-mobile-payment').value;
      $('monthly-filter-dialog').close();changed();
    });
    chooseView('calendar');
    return {render,loading,error,setEditing,setBusy,afterSave,focus:()=>(view==='monthly'?$('monthly-title'):$('day-title')).focus(),chooseView};
  }
  return Object.freeze({init,select,matches,totals,defaults});
})();
