'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const formatter = new Intl.NumberFormat('ko-KR');
  let entries = [];
  let calendarMode='calendar',dayType='all',calendarWeekEntries=null,calendarWeekVersion=0,entryReturnFocus=null;
  let monthlyBudget = null;
  let budgetUI = null;
  let monthlyUI = null;
  let comparisonUI = null;
  let monthPickerUI = null;
  let recurringUI = null;
  let recurringItems = [];
  let recurringEntry = null;
  let summary = {income:0,expense:0,balance:0,incomeCount:0,expenseCount:0};
  let loadVersion = 0;
  let pendingSubmission;
  let toastTimer;
  let selectedDate = localDate;
  let loadedMonth = null;
  let weekVersion = 0;
  let editingId = null;
  let pendingDelete = null;
  let mutationBusy = false;
  let categories = [];
  let paymentMethods = [];
  let paymentEditingId = null;
  let paymentBusy = false;
  let paymentAction = null;
  let editingPaymentMethodId = null;
  let categoryEditingId = null;
  let categoryDeleteTarget = null;
  let categoryBusy = false;
  let categoryPalette = [];
  let personalHolidays = [];
  let personalEditingId = null;
  let personalBusy = false;
  let analysisType = 'expense';
  let analysisSelection = null;
  let paymentAnalysisSelection = null;
  let analysisMonth = null;
  let analysisData = {total:0,groups:[]};
  const holidays = globalThis.ChagokHolidays;
  const holidayNames = date => holidays?.dates[date] || [];
  const weekdayNames = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
  const dateLabel = date => {const [year,month,day]=date.split('-');return `${year}년 ${Number(month)}월 ${Number(day)}일`;};
  const compact = new Intl.NumberFormat('ko-KR',{notation:'compact',maximumFractionDigits:1});
  const monthValid = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= '1000-01' && month <= '9999-12';
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  async function api(path, body, method = body?'POST':'GET') {
    const response = await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || '서버 요청에 실패했어요.');
    return data;
  }
  async function loadMonth() {
    const period=$('month').value;
    comparisonUI?.update(period);
    calendarWeekEntries=null;++calendarWeekVersion;
    monthPickerUI?.sync(period);
    const monthName=`${Number(period.slice(5))}월`;
    $('balance-label').textContent=monthName+' 차액';$('income-label').textContent=monthName+' 총수입';$('expense-label').textContent=monthName+' 총지출';
    for(const id of ['income','expense','balance'])$(id).textContent='—';
    $('income-count').textContent='';$('expense-count').textContent='';
    loadWeek();
    if(analysisMonth!==period){
      analysisSelection=null;
      paymentAnalysisSelection=null;
      analysisMonth=period;
    }
    const version=++loadVersion;
    $('save-state').textContent = 'DB 불러오는 중';
    $('load-error').hidden = true;
    $('records').hidden = true; $('empty').hidden = true;
    loadedMonth=null;
    budgetUI?.loading();
    monthlyUI?.loading($('month').value);
    renderAnalysis('기록을 불러오는 중이에요.');
    renderPaymentAnalysis('기록을 불러오는 중이에요.');
    renderCalendar();
    $('calendar-status').textContent = '기록을 불러오는 중이에요.';
    $('calendar-status').hidden=false;
    document.querySelector('.summary').setAttribute('aria-busy','true');
    try {
      const data = await api('/api/entries?month='+encodeURIComponent($('month').value));
      if(version!==loadVersion) return;
      entries=data.entries;summary=data.summary;categories=data.categories;paymentMethods=data.paymentMethods||[];categoryPalette=data.palette||[];personalHolidays=data.personalHolidays||[];loadedMonth=$('month').value;
      recurringItems=data.recurring||[];
      recurringUI?.updateCount();
      monthlyBudget=data.budget??null;
      renderCategoryOptions();
      renderPaymentOptions();
      render();
      comparisonUI?.update(period,entries);
      $('records').hidden = false;
      $('save-state').textContent = '로컬 DB에 저장';
    } catch {
      if(version!==loadVersion) return;
      $('save-state').textContent = 'DB 연결 확인 필요';
      $('load-error').hidden = false;
      for(const id of ['income','expense','balance']) $(id).textContent = '—';
      $('income-count').textContent='조회하지 못했어요'; $('expense-count').textContent='조회하지 못했어요';
      $('record-count').textContent='—';
      $('day-summary').textContent='기록을 불러오지 못했어요.';
      $('calendar-status').textContent='기록을 불러오지 못했어요. 다시 불러오기를 눌러 주세요.';
      $('calendar-status').hidden=false;
      renderAnalysis('기록을 불러오지 못했어요. 달력의 다시 불러오기를 눌러 주세요.');
      renderPaymentAnalysis('기록을 불러오지 못했어요.',true);
      comparisonUI?.update(period,null,true);
      budgetUI?.error();
      monthlyUI?.error();
    } finally { if(version===loadVersion) document.querySelector('.summary').setAttribute('aria-busy','false'); }
  }
  $('month').value = localDate.slice(0,7);
  $('date').value = localDate;
  function render() {
    loadWeek();
    const month = $('month').value;
    const selected = entries.filter(e => e.date === selectedDate).sort((a,b) => b.createdAt-a.createdAt || b.id-a.id);
    renderCalendar();
    renderAnalysis();
    renderPaymentAnalysis();
    budgetUI?.render({month,budget:monthlyBudget,entries,categories});
    monthlyUI?.render({month,entries,categories,paymentMethods});
    $('day-title').textContent = dateLabel(selectedDate);
    $('calendar-status').textContent = '';
    $('calendar-status').hidden=true;
    const dayIncome=selected.filter(e=>e.type==='income').reduce((sum,e)=>sum+e.amount,0);
    const dayExpense=selected.filter(e=>e.type==='expense').reduce((sum,e)=>sum+e.amount,0);
    $('day-summary').textContent=`수입 ${formatter.format(dayIncome)}원 · 지출 ${formatter.format(dayExpense)}원`;
    for (const [id,value] of [['income',summary.income],['expense',summary.expense],['balance',summary.balance]]) {
      $(id).replaceChildren(document.createTextNode(formatter.format(value)),Object.assign(document.createElement('span'),{textContent:'원'}));
    }
    $('income-count').textContent = `${summary.incomeCount}건`;
    $('expense-count').textContent = `${summary.expenseCount}건`;
    $('record-count').textContent = selected.length;
    const visible=selected.filter(e=>dayType==='all'||e.type===dayType);
    $('empty').hidden = visible.length > 0;
    const fragment = document.createDocumentFragment();
    visible.forEach(entry => {
      const income = entry.type === 'income';
      const row = document.createElement('div');
      row.className = 'record';
      row.dataset.id=String(entry.id);
      const info = document.createElement('div'); info.className = 'record-info';
      const icon = document.createElement('span'); icon.className = `record-icon ${income?'income-icon':'expense-icon'}`; icon.textContent = income?'↓':'↑'; icon.setAttribute('aria-hidden','true');
      const text = document.createElement('div'); text.className = 'record-text';
      const memo = document.createElement('div'); memo.className = 'record-memo';
      const detailTrigger=recurringUI?.entryTitle(entry,mutationBusy);
      if(detailTrigger)memo.append(detailTrigger);
      else memo.textContent=entry.memo||(income?'수입':'지출');
      const date = document.createElement('div'); date.className = 'record-date'; date.textContent = `${Number(entry.date.slice(5,7))}월 ${Number(entry.date.slice(8))}일 · ${income?'수입':'지출'} · ${entry.categoryName || '미분류'}`+(income?'':` · ${entry.paymentMethodName||'미지정'}`);
      text.append(memo,date); info.append(icon,text);
      const amount = document.createElement('span'); amount.className = `record-amount ${income?'income':''}`; amount.textContent = `${income?'+':'−'}${formatter.format(entry.amount)}원`;
      const controls=document.createElement('div');controls.className='record-controls';
      const actions=document.createElement('div');actions.className='record-actions';
      for(const [action,label,handler] of [['edit','수정',()=>beginEdit(entry)],['delete','삭제',()=>askDelete(entry)]]) {
        const button=document.createElement('button');button.type='button';button.className=`record-action ${action}`;
        button.textContent=label;button.dataset.action=action;button.disabled=mutationBusy;
        button.setAttribute('aria-label',`${entry.memo || (income?'수입':'지출')} ${formatter.format(entry.amount)}원 ${label}`);
        button.addEventListener('click',handler);actions.append(button);
      }
      controls.append(amount,actions);row.append(info,controls);fragment.append(row);
    });
    $('records').replaceChildren(fragment);
    if(calendarMode==='week')refreshCalendarWeek();
  }
  const analysisViews=['category','weekly','payment','comparison'];
  function selectAnalysisView(view) {
    for(const name of analysisViews) {
      const active=name===view;
      $('tab-'+name).setAttribute('aria-selected',String(active));
      $('tab-'+name).setAttribute('tabindex',active?'0':'-1');
      $(name+'-analysis').hidden=!active;
    }
    comparisonUI?.activate(view==='comparison');
  }
  for(const [index,name] of analysisViews.entries()) {
    $('tab-'+name).addEventListener('click',()=>selectAnalysisView(name));
    $('tab-'+name).addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const offset=event.key==='ArrowLeft'?-1:1;
      const next=event.key==='Home'?analysisViews[0]:event.key==='End'?analysisViews.at(-1):
        analysisViews[(index+offset+analysisViews.length)%analysisViews.length];
      selectAnalysisView(next);$('tab-'+next).focus();
    });
  }
  selectAnalysisView('category');
  async function loadWeek() {
    const version=++weekVersion,date=selectedDate;
    $('weekly-range').textContent=`${dateLabel(date)}이 속한 주`;
    $('weekly-total').textContent='—';$('weekly-chart').hidden=true;
    $('weekly-status').hidden=false;$('weekly-status').textContent='기록을 불러오는 중이에요.';
    $('retry-week').hidden=true;
    for(const [id,offset] of [['prev-week',-7],['next-week',7]]) {
      const target=new Date(date+'T00:00:00Z');target.setUTCDate(target.getUTCDate()+offset);
      $(id).disabled=target.getUTCFullYear()<1000||target.getUTCFullYear()>9999;
    }
    try {
      const data=await api('/api/weekly-expenses?date='+encodeURIComponent(date));
      if(version!==weekVersion)return;
      $('weekly-range').textContent=`${dateLabel(data.start)} ~ ${dateLabel(data.end)}`;
      $('weekly-total').textContent=formatter.format(BigInt(data.total))+'원';
      const max=Math.max(...data.days.map(day=>day.amount));
      const fragment=document.createDocumentFragment();
      data.days.forEach((day,index)=>{
        const button=document.createElement('button');button.type='button';button.className='weekly-day';
        button.disabled=!monthValid(day.date.slice(0,7));
        button.setAttribute('aria-pressed',String(day.date===date));
        button.setAttribute('aria-label',`${dateLabel(day.date)} ${['월','화','수','목','금','토','일'][index]}요일 지출 ${formatter.format(day.amount)}원`);
        const amount=document.createElement('span');amount.className='weekly-amount';amount.textContent=formatter.format(day.amount)+'원';
        const track=document.createElement('span');track.className='weekly-track';track.setAttribute('aria-hidden','true');
        const bar=document.createElement('span');bar.className='weekly-bar';bar.style.height=(max?day.amount/max*100:0)+'%';track.append(bar);
        const label=document.createElement('span');label.textContent=['월','화','수','목','금','토','일'][index];
        const number=document.createElement('span');number.className='weekly-date';number.textContent=`${Number(day.date.split('-')[1])}/${Number(day.date.split('-')[2])}`;
        button.append(amount,track,label,number);button.addEventListener('click',()=>selectDate(day.date));fragment.append(button);
      });
      $('weekly-chart').replaceChildren(fragment);$('weekly-chart').hidden=false;
      $('weekly-status').textContent=max?'':'이 주에는 지출 기록이 없어요.';
      $('weekly-status').hidden=!!max;
    }catch {
      if(version!==weekVersion)return;
      $('weekly-status').textContent='주간 지출을 불러오지 못했어요.';$('retry-week').hidden=false;
    }
  }
  for(const [id,offset] of [['prev-week',-7],['next-week',7]])$(id).addEventListener('click',()=>{
    const target=new Date(selectedDate+'T00:00:00Z');target.setUTCDate(target.getUTCDate()+offset);
    return selectDate(target.toISOString().slice(0,10));
  });
  $('retry-week').addEventListener('click',loadWeek);
  const paymentPalette=['#286854','#438779','#765d96','#a2703a','#4d729c','#9a5964','#5d7339'];
  function renderPaymentAnalysis(message='',retry=false) {
    const month=$('month').value;
    const status=$('payment-analysis-status');
    $('payment-analysis-month').textContent=month.slice(0,4)+'년 '+Number(month.slice(5))+'월';
    const {total,groups}=(!message&&globalThis.ChagokAnalysis?.aggregatePayments(entries,month))||{total:0,groups:[]};
    $('payment-analysis-content').hidden=!groups.length;
    status.hidden=groups.length>0;
    status.textContent=message||'이 달에는 지출 기록이 없어요.';
    $('payment-analysis-retry').hidden=!retry;
    if(!groups.length) {
      if(!message)paymentAnalysisSelection=null;
      return;
    }

    const selected=groups.find(group=>group.key===paymentAnalysisSelection);
    paymentAnalysisSelection=selected?.key??null;
    const legend=document.createDocumentFragment();
    let offset=0;
    const segments=groups.map((group,index)=>{
      const color=group.key==='unspecified'?'#787b85':paymentPalette[index%paymentPalette.length];
      const active=group===selected;
      const next=index===groups.length-1?100:Math.min(100,offset+group.amount/total*100);
      const fill=selected&&!active?color+'55':color;
      const segment=fill+' '+offset+'% '+next+'%';
      offset=next;

      const row=document.createElement('button');
      row.type='button';
      row.className='payment-analysis-method';
      row.dataset.paymentAnalysisKey=group.key;
      row.setAttribute('aria-pressed',String(active));
      row.setAttribute('aria-controls','payment-analysis-detail');
      const marker=document.createElement('span');
      marker.className='analysis-marker';
      marker.style.backgroundColor=color;
      marker.setAttribute('aria-hidden','true');
      const name=document.createElement('strong');
      name.textContent=group.name;
      const percent=document.createElement('strong');
      percent.textContent=group.percent;
      const meta=document.createElement('span');
      meta.className='payment-analysis-meta';
      meta.textContent=formatter.format(group.amount)+'원 · '+group.count+'건';
      row.append(marker,name,percent,meta);
      row.addEventListener('click',()=>selectPaymentAnalysis(active?null:group.key,group.key));
      legend.append(row);
      return segment;
    });
    $('payment-analysis-donut').style.background=groups.length===1?segments[0].split(' ')[0]:
      'conic-gradient('+segments.join(',')+')';
    $('payment-analysis-legend').replaceChildren(legend);
    $('payment-analysis-center-label').textContent=selected?.name??'월 지출 합계';
    $('payment-analysis-center-value').textContent=selected?.percent??formatter.format(total)+'원';
    $('payment-analysis-reset').hidden=!selected;
    $('payment-analysis-detail').hidden=!selected;
    if(!selected) {
      $('payment-analysis-records').replaceChildren();
      return;
    }

    $('payment-analysis-detail-title').textContent=selected.name+' 거래';
    $('payment-analysis-detail-summary').textContent=formatter.format(selected.amount)+'원 · '+selected.count+'건';
    const records=document.createDocumentFragment();
    const sorted=[...selected.entries].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
    for(const entry of sorted) {
      const row=document.createElement('li');
      const info=document.createElement('div');
      const memo=document.createElement('strong');
      memo.textContent=entry.memo||entry.categoryName||'지출';
      const date=document.createElement('span');
      date.className='payment-analysis-meta';
      date.textContent=dateLabel(entry.date);
      const amount=document.createElement('strong');
      amount.textContent=formatter.format(entry.amount)+'원';
      info.append(memo,date);
      row.append(info,amount);
      records.append(row);
    }
    $('payment-analysis-records').replaceChildren(records);
  }
  function selectPaymentAnalysis(key,focusKey) {
    paymentAnalysisSelection=key;
    renderPaymentAnalysis();
    document.querySelector('[data-payment-analysis-key="'+focusKey+'"]')?.focus();
  }
  $('payment-analysis-reset').addEventListener('click',()=>selectPaymentAnalysis(null,paymentAnalysisSelection));
  $('payment-analysis-retry').addEventListener('click',loadMonth);
  function renderAnalysis(message='') {
    const month=$('month').value,typeLabel=analysisType==='income'?'수입':'지출';
    $('analysis-month').textContent=`${month.slice(0,4)}년 ${Number(month.slice(5))}월 · ${typeLabel}`;
    for(const type of ['income','expense'])$('analysis-'+type).setAttribute('aria-pressed',String(type===analysisType));
    $('analysis-list').replaceChildren();$('analysis-chart').replaceChildren();
    $('analysis-reset').hidden=true;$('analysis-details').disabled=true;
    $('analysis-details').textContent='카테고리를 선택해 주세요';
    if(message||!globalThis.ChagokAnalysis) {
      $('analysis-status').textContent=message||'분석 기능을 불러오지 못했어요. 새로고침해 주세요.';
      $('analysis-status').hidden=false;$('analysis-donut').hidden=true;$('analysis-total').textContent='—';
      return;
    }
    analysisData=globalThis.ChagokAnalysis.aggregate(entries,analysisType,month);
    const {total,groups}=analysisData;
    if(!groups.some(group=>group.key===analysisSelection))analysisSelection=null;
    const selected=groups.find(group=>group.key===analysisSelection);
    $('analysis-total').textContent=`총 ${formatter.format(total)}원`;
    $('analysis-status').hidden=groups.length>0;
    $('analysis-status').textContent=`이 달에는 ${typeLabel} 기록이 없어요.`;
    $('analysis-donut').hidden=groups.length===0;
    $('analysis-center-name').textContent=selected?selected.name:`총${typeLabel}`;
    $('analysis-center-amount').textContent=`${formatter.format(selected?selected.amount:total)}원`;
    $('analysis-center-amount').className=(selected?selected.amount:total)>=1e9?'large-amount':'';
    $('analysis-center-percent').textContent=selected?selected.percent:'';
    const svg=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
    $('analysis-chart').append(svg('circle',{cx:120,cy:120,r:86,fill:'none',stroke:'#edf1e8','stroke-width':34,'aria-hidden':'true'}));
    const fragment=document.createDocumentFragment();let offset=0;
    groups.forEach(group=>{
      const color=globalThis.ChagokAnalysis.color(group.key,group.color),length=group.amount/total*100;
      const pressed=group.key===analysisSelection;
      const slice=svg('circle',{cx:120,cy:120,r:86,fill:'none',stroke:color,'stroke-width':pressed?40:34,pathLength:100,'stroke-dasharray':`${length} ${100-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 120 120)',class:'donut-slice',role:'button',tabindex:0,'aria-pressed':pressed,'aria-label':`${group.name} ${formatter.format(group.amount)}원 ${group.percent} ${group.count}건`,'data-key':group.key,opacity:analysisSelection!==null&&!pressed?0.35:1});
      offset+=length;
      const toggle=source=>{
        analysisSelection=analysisSelection===group.key?null:group.key;renderAnalysis();
        document.querySelector(source==='chart'?`#analysis-chart [data-key="${group.key}"]`:`[data-analysis-key="${group.key}"]`)?.focus();
      };
      slice.addEventListener('click',()=>toggle('chart'));
      slice.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle('chart');}});
      $('analysis-chart').append(slice);
      const row=document.createElement('button');row.type='button';row.className='analysis-category';row.dataset.analysisKey=group.key;row.setAttribute('aria-pressed',String(pressed));
      const name=document.createElement('span');name.className='analysis-category-name';
      const marker=document.createElement('span');marker.className='analysis-marker';marker.style.backgroundColor=color;marker.setAttribute('aria-hidden','true');
      const label=document.createElement('span');label.textContent=group.name;name.append(marker,label);
      const value=document.createElement('strong');value.textContent=`${formatter.format(group.amount)}원`;
      const percent=document.createElement('span');percent.className='analysis-percent';percent.textContent=group.percent;
      row.setAttribute('aria-label',`${group.name} ${formatter.format(group.amount)}원 ${group.percent}, ${group.count}건`);
      row.addEventListener('click',()=>toggle('list'));row.append(name,value,percent);fragment.append(row);
    });
    $('analysis-list').replaceChildren(fragment);
    $('analysis-reset').hidden=!selected;
    $('analysis-details').disabled=!selected;
    if(selected)$('analysis-details').textContent=`${selected.name} 내역 보기 · ${selected.count}건`;
  }
  for(const type of ['income','expense'])$('analysis-'+type).addEventListener('click',()=>{
    if(analysisType===type)return;
    analysisType=type;analysisSelection=null;renderAnalysis(loadedMonth===$('month').value?'':'기록을 불러온 뒤 확인해 주세요.');
  });
  $('analysis-reset').addEventListener('click',()=>{analysisSelection=null;renderAnalysis();});
  $('analysis-close').addEventListener('click',()=>$('analysis-dialog').close());
  function openAnalysisDetails() {
    const group=analysisData.groups.find(item=>item.key===analysisSelection);
    if(!group||loadedMonth!==$('month').value)return;
    const month=$('month').value;
    $('analysis-dialog-title').textContent=`${month.slice(0,4)}년 ${Number(month.slice(5))}월 · ${group.name}`;
    $('analysis-dialog-summary').textContent=`${analysisType==='income'?'수입':'지출'} ${formatter.format(group.amount)}원 · ${group.count}건 · 월 전체의 ${group.percent}`;
    const fragment=document.createDocumentFragment();
    entries.filter(entry=>entry.type===analysisType&&(entry.categoryId===null||entry.categoryId===undefined?'uncategorized':String(entry.categoryId))===group.key).forEach(entry=>{
      const row=document.createElement('button');row.type='button';row.className='analysis-transaction';
      const date=document.createElement('span');date.textContent=dateLabel(entry.date);
      const memo=document.createElement('span');memo.textContent=(entry.memo||'내용 없음')+(entry.type==='expense'?` · ${entry.paymentMethodName||'미지정'}`:'');
      const amount=document.createElement('strong');amount.textContent=`${formatter.format(entry.amount)}원`;
      row.setAttribute('aria-label',`${dateLabel(entry.date)} ${entry.memo} ${formatter.format(entry.amount)}원, 날짜로 이동`);
      row.addEventListener('click',async()=>{$('analysis-dialog').close();for(const id of ['analysis-overview-dialog','budget-overview-dialog'])if($(id).open)$(id).close();monthlyUI?.chooseView('calendar');await selectDate(entry.date);$('day-title').focus();});
      row.append(date,memo,amount);fragment.append(row);
    });
    $('analysis-records').replaceChildren(fragment);$('analysis-dialog').showModal();
  }
  $('analysis-details').addEventListener('click',openAnalysisDetails);
  function renderCalendar() {
    const month=$('month').value;
    $('day-title').textContent=dateLabel(selectedDate);
    const [year,number]=month.split('-').map(Number);
    const supported=holidays?.years.includes(year);
    $('holiday-note').textContent=!holidays?'공휴일 정보를 불러오지 못했어요.':supported?'':`${year}년 공휴일 정보 미지원`;
    $('holiday-note').hidden=!!holidays&&supported;
    const personalByDate=new Map(loadedMonth===month?(calendarMode==='week'&&calendarWeekEntries?.key===selectedDate?calendarWeekEntries.personalHolidays:personalHolidays).map(holiday=>[holiday.date,holiday]):[]);
    const selectedPersonal=personalByDate.get(selectedDate);
    $('personal-day-label').textContent=loadedMonth!==month?'개인 휴일 정보를 불러오지 못했거나 불러오는 중이에요.':selectedPersonal?`개인 휴일 · ${selectedPersonal.name}`:'';
    $('personal-open').textContent=selectedPersonal?'개인 휴일 수정':'개인 휴일 지정';
    $('personal-open').disabled=mutationBusy||loadedMonth!==month;
    const selectedWeekday=weekdayNames[new Date(`${selectedDate}T12:00:00`).getDay()];
    const selectedHolidays=holidayNames(selectedDate);
    $('day-holiday').textContent=[selectedWeekday,...selectedHolidays].join(' · ');
    $('day-holiday').className=`day-holiday${selectedHolidays.length?' is-holiday':''}`;
    const first=new Date(year,number-1,1).getDay();
    const weekStart=new Date(selectedDate+'T12:00:00Z');weekStart.setUTCDate(weekStart.getUTCDate()-weekStart.getUTCDay());
    const dateISO=d=>d.toISOString().slice(0,10);
    const weekEnd=new Date(weekStart);weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
    $('calendar-week-navigation').hidden=calendarMode!=='week';
    $('calendar-week-range').textContent=`${dateLabel(dateISO(weekStart))} ~ ${dateLabel(dateISO(weekEnd))}`;
    $('calendar-prev-week').disabled=weekStart.getUTCFullYear()<=1000&&weekStart.getUTCMonth()===0&&weekStart.getUTCDate()<8;
    $('calendar-next-week').disabled=weekEnd.getUTCFullYear()>=9999&&weekEnd.getUTCMonth()===11&&weekEnd.getUTCDate()>24;
    document.querySelector('.calendar-column').classList[calendarMode==='week'?'add':'remove']('is-week');
    const days=new Date(year,number,0).getDate();
    const totals=new Map();
    const visibleRecurring=loadedMonth===month?(calendarMode==='week'&&calendarWeekEntries?.key===selectedDate?calendarWeekEntries.recurring:recurringItems):[];
    const recurringByDate=new Map();
    for(const item of visibleRecurring){
      const day=recurringByDate.get(item.dueDate)||[];
      day.push(item);recurringByDate.set(item.dueDate,day);
    }
    if(loadedMonth===month) (calendarMode==='week'&&calendarWeekEntries?.key===selectedDate?calendarWeekEntries.entries:entries).forEach(entry=>{
      const day=totals.get(entry.date)||{income:0,expense:0};
      day[entry.type]+=entry.amount;totals.set(entry.date,day);
    });
    $('calendar-title').textContent=calendarMode==='week'?'주간 지출':'월간 지출';
    $('calendar-grid').setAttribute('aria-label',`${year}년 ${number}월 달력`);
    $('prev-month').disabled=month==='1000-01';$('next-month').disabled=month==='9999-12';
    const fragment=document.createDocumentFragment();
    const cellCount=calendarMode==='week'?7:Math.ceil((first+days)/7)*7;
    for(let index=0;index<cellCount;index++) {
      const target=new Date(weekStart);target.setUTCDate(target.getUTCDate()+index);
      const day=calendarMode==='week'?target.getUTCDate():index-first+1;
      if((calendarMode!=='week'&&(day<1||day>days))||(calendarMode==='week'&&(target.getUTCFullYear()<1000||target.getUTCFullYear()>9999))) {
        const blank=document.createElement('div');blank.className='calendar-blank';blank.setAttribute('aria-hidden','true');fragment.append(blank);continue;
      }
      const date=calendarMode==='week'?dateISO(target):`${month}-${String(day).padStart(2,'0')}`;
      const weekday=index%7;
      const names=holidayNames(date);
      const personal=personalByDate.get(date);
      const amounts=totals.get(date)||{income:0,expense:0};
      const amountsKnown=loadedMonth===month&&(date.slice(0,7)===month||calendarWeekEntries?.key===selectedDate);
      const button=document.createElement('button');button.type='button';button.className=`calendar-day${weekday===0?' is-sunday':weekday===6?' is-saturday':''}${names.length?' is-holiday':''}${personal?' is-personal':''}`;
      button.dataset.date=date;
      button.setAttribute('aria-pressed',String(date===selectedDate));
      if(date===localDate) button.setAttribute('aria-current','date');
      button.setAttribute('aria-label',`${dateLabel(date)} ${weekdayNames[weekday]}${names.length?', 공휴일: '+names.join(', '):''}${personal?', 개인 휴일: '+personal.name:''}${date===localDate?', 오늘':''}${amountsKnown?`, 수입 ${formatter.format(amounts.income)}원, 지출 ${formatter.format(amounts.expense)}원`:', 기록 조회 중'}`);
      const header=document.createElement('span');header.className='day-number';header.textContent=calendarMode==='week'?`${Number(date.slice(5,7))}/${day}`:String(day);
      button.append(header);
      if(date===localDate){const todayTag=document.createElement('span');todayTag.className='today-tag';todayTag.textContent='오늘';button.append(todayTag);}
      if(names.length) {
        const label=document.createElement('span');label.className='holiday-name';label.textContent=names.join(' · ');label.title=names.join(' · ');label.setAttribute('aria-hidden','true');button.append(label);
      }
      if(personal) {
        const label=document.createElement('span');label.className='holiday-name personal-holiday-name';label.textContent=personal.name;label.title=`개인 휴일: ${personal.name}`;label.setAttribute('aria-hidden','true');button.append(label);
      }
      for(const [type,sign] of [['income','+'],['expense','−']]) {
        if(!amounts[type]) continue;
        const amount=document.createElement('span');amount.className=`day-amount ${type}`;
        const full=document.createElement('span');full.className='amount-full';full.textContent=sign+formatter.format(amounts[type]);
        const short=document.createElement('span');short.className='amount-short';short.textContent=sign+compact.format(amounts[type]);
        amount.title=`${type==='income'?'수입':'지출'} ${formatter.format(amounts[type])}원`;
        amount.setAttribute('aria-hidden','true');amount.append(full,short);button.append(amount);
      }
      if(!amountsKnown&&calendarMode==='week'){const pending=document.createElement('span');pending.className='day-pending';pending.textContent='—';pending.setAttribute('aria-hidden','true');button.append(pending);}
      recurringUI?.marker(button,recurringByDate.get(date)||[]);
      button.addEventListener('click',async event=>{
        await selectDate(date);
        document.querySelector(`.calendar-day[data-date="${date}"]`)?.focus();
        if(event?.detail&&recurringByDate.get(date)?.some(item=>item.status!=='recorded'||item.linkedEntryId)){
          $('recurring-day')?.scrollIntoView({block:'nearest'});
        }
      });
      button.addEventListener('keydown',async event=>{
        const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
        if(!Object.hasOwn(offsets,event.key))return;
        event.preventDefault();
        const next=new Date(date+'T12:00:00');next.setDate(next.getDate()+offsets[event.key]);
        if(next.getFullYear()<1000||next.getFullYear()>9999)return;
        const nextDate=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
        await selectDate(nextDate);
        document.querySelector(`[data-date="${nextDate}"]`)?.focus();
      });
      fragment.append(button);
    }
    $('calendar-grid').replaceChildren(fragment);
    recurringUI?.render(month,selectedDate,loadedMonth===month?recurringItems:[]);
  }
  async function refreshCalendarWeek() {
    const key=selectedDate,version=++calendarWeekVersion;
    if(calendarMode!=='week'||loadedMonth!==$('month').value)return;
    const start=new Date(key+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-start.getUTCDay());
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
    const months=[...new Set([start,end].filter(d=>d.getUTCFullYear()>=1000&&d.getUTCFullYear()<=9999).map(d=>d.toISOString().slice(0,7)))].filter(m=>m!==loadedMonth);
    try {
      const adjacent=await Promise.all(months.map(month=>api('/api/entries?month='+encodeURIComponent(month))));
      if(version!==calendarWeekVersion||key!==selectedDate||calendarMode!=='week')return;
      calendarWeekEntries={key,entries:[...entries,...adjacent.flatMap(data=>data.entries)],personalHolidays:[...personalHolidays,...adjacent.flatMap(data=>data.personalHolidays||[])],recurring:[...recurringItems,...adjacent.flatMap(data=>data.recurring||[])]};renderCalendar();
    }catch {
      if(version!==calendarWeekVersion||key!==selectedDate||calendarMode!=='week')return;
      $('calendar-status').textContent='인접한 달의 기록을 불러오지 못했어요.';$('calendar-status').hidden=false;$('load-error').hidden=false;
    }
  }
  for(const [id,offset] of [['calendar-prev-week',-7],['calendar-next-week',7]])$(id).addEventListener('click',()=>{
    const date=new Date(selectedDate+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);selectDate(date.toISOString().slice(0,10));
  });
  document.querySelectorAll('[data-day-type]').forEach(button=>button.addEventListener('click',()=>{
    dayType=button.dataset.dayType;document.querySelectorAll('[data-day-type]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));if(loadedMonth===$('month').value)render();
  }));
  function showEntry(returnFocus=document.activeElement) {
    entryReturnFocus=returnFocus;
    if(!$('entry-dialog').open)$('entry-dialog').showModal();
    $('amount').focus();
  }
  function restoreEntryFocus() {
    if(entryReturnFocus?.isConnected)entryReturnFocus.focus();
    else if(monthlyUI)monthlyUI.focus();
    else $('entry-open').focus();
  }
  function closeEntry() {
    if(mutationBusy)return;
    $('entry-dialog').close();resetEditor();restoreEntryFocus();
  }
  for(const id of ['entry-open','day-entry-open'])$(id).addEventListener('click',()=>{if(!mutationBusy){resetEditor();showEntry();}});
  $('entry-close').addEventListener('click',closeEntry);
  $('entry-dialog').addEventListener('cancel',event=>{event.preventDefault();closeEntry();});
  for(const [open,close,dialog] of [['budget-overview-open','budget-overview-close','budget-overview-dialog'],['analysis-open','analysis-overview-close','analysis-overview-dialog']]){
    $(open).addEventListener('click',()=>$(dialog).showModal());$(close).addEventListener('click',()=>$(dialog).close());
  }
  async function selectDate(date) {
    if(!validDate(date)||!monthValid(date.slice(0,7)))return;
    selectedDate=date;$('date').value=date;$('day-title').textContent=dateLabel(date);
    if($('month').value!==date.slice(0,7)) {
      $('month').value=date.slice(0,7);
      await loadMonth();
    } else if(loadedMonth===$('month').value) render();
    else {renderCalendar();loadWeek();}
  }
  function selectMonth(month) {
    if(!monthValid(month))month=localDate.slice(0,7);
    const [year,number]=month.split('-').map(Number);
    const day=Math.min(Number(selectedDate.slice(8)),new Date(year,number,0).getDate());
    selectedDate=`${month}-${String(day).padStart(2,'0')}`;
    $('month').value=month;$('date').value=selectedDate;$('day-title').textContent=dateLabel(selectedDate);
    return loadMonth();
  }
  $('month').addEventListener('change',()=>selectMonth($('month').value));
  function changeMonth(direction) {
    const [year,month] = $('month').value.split('-').map(Number);
    const next = new Date(year,month-1+direction,1);
    if(next.getFullYear()<1000 || next.getFullYear()>9999) return;
    return selectMonth(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`);
  }
  $('prev-month').addEventListener('click',() => changeMonth(-1));
  $('next-month').addEventListener('click',() => changeMonth(1));
  $('today-month').addEventListener('click',()=>selectDate(localDate));
  $('date').addEventListener('change',()=>selectDate($('date').value));
  $('amount').addEventListener('input',event => {
    const raw = event.target.value.replace(/,/g,'');
    if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) event.target.value = formatter.format(Number(raw));
  });
  function setBusy(busy) {
    mutationBusy=busy;
    monthlyUI?.setBusy(busy);
    $('personal-open').disabled=busy||loadedMonth!==$('month').value;
    for(const id of ['amount','date','memo','category','manage-categories','payment-method','manage-payments','type-income','type-expense','submit-entry','cancel-edit','entry-close','entry-open','day-entry-open','confirm-delete','cancel-delete']) $(id).disabled=busy;
    document.querySelectorAll('.record-action,.entry-detail-trigger').forEach(button=>button.disabled=busy);
    if(recurringUI)$('recurring-skip').disabled=busy;
  }
  function resetEditor() {
    editingId=null;pendingSubmission=null;
    recurringEntry=null;recurringUI?.editor(null);
    monthlyUI?.setEditing(null);
    editingPaymentMethodId=null;
    $('entry-title').textContent='새 기록';
    $('cancel-edit').hidden=true;$('submit-entry').textContent='＋ 기록 추가';
    $('amount').value='';$('memo').value='';$('form-error').textContent='';$('date').value=selectedDate;
    renderCategoryOptions('');
    renderPaymentOptions('');
  }
  function openRecurringEntry(item,source) {
    if(mutationBusy)return;
    resetEditor();
    recurringEntry={ruleId:item.id,dueDate:item.dueDate};
    $('type-expense').checked=true;
    $('amount').value=item.amount===null?'':formatter.format(item.amount);
    $('date').value=item.dueDate;
    $('memo').value=item.name;
    renderCategoryOptions(item.categoryId);
    renderPaymentOptions(item.paymentMethodId);
    recurringUI.editor(item);
    showEntry(source);
  }
  function beginEdit(entry) {
    if(mutationBusy)return;
    editingId=entry.id;pendingSubmission=null;
    monthlyUI?.setEditing(entry.id);
    editingPaymentMethodId=entry.paymentMethodId??null;
    $('entry-title').textContent='기록 수정';
    $('cancel-edit').hidden=false;$('submit-entry').textContent='변경 내용 저장';
    $('type-income').checked=entry.type==='income';$('type-expense').checked=entry.type==='expense';
    renderCategoryOptions(entry.categoryId===null?'':String(entry.categoryId));
    renderPaymentOptions(entry.paymentMethodId==null?'':String(entry.paymentMethodId));
    $('memo').placeholder=entry.type==='income'?'어떤 수입인가요?':'어디에 사용했나요?';
    $('amount').value=formatter.format(entry.amount);$('date').value=entry.date;$('memo').value=entry.memo;
    $('form-error').textContent='';showEntry();
  }
  function askDelete(entry) {
    if(mutationBusy)return;
    pendingDelete=entry;
    $('delete-preview').textContent=`${dateLabel(entry.date)} · ${entry.memo || (entry.type==='income'?'수입':'지출')} · ${entry.type==='income'?'수입':'지출'} ${formatter.format(entry.amount)}원`;
    $('delete-error').textContent='';$('delete-dialog').showModal();$('cancel-delete').focus();
  }
  function errorMessage(error) {
    if(error.name==='TimeoutError')return '응답을 확인하지 못했어요. 다시 시도하기 전에 기록을 확인해 주세요.';
    return error.name==='TypeError'?'서버에 연결할 수 없어요. 서버 실행 여부를 확인해 주세요.':error.message;
  }
  function setPersonalBusy(busy) {
    personalBusy=busy;
    for(const id of ['personal-date','personal-name','personal-save','personal-remove','personal-close','personal-delete-cancel','personal-delete-confirm'])$(id).disabled=busy;
  }
  $('personal-open').addEventListener('click',()=>{
    if(mutationBusy||loadedMonth!==$('month').value)return;
    const holiday=personalHolidays.find(item=>item.date===selectedDate);
    personalEditingId=holiday?.id??null;
    $('personal-title').textContent=holiday?'개인 휴일 수정':'개인 휴일 지정';
    $('personal-date').value=selectedDate;$('personal-name').value=holiday?.name||'연차';
    $('personal-remove').hidden=!holiday;$('personal-delete-panel').hidden=true;$('personal-error').textContent='';
    $('personal-dialog').showModal();$('personal-name').focus();
  });
  $('personal-close').addEventListener('click',()=>{if(!personalBusy)$('personal-dialog').close();});
  $('personal-dialog').addEventListener('cancel',event=>{if(personalBusy)event.preventDefault();});
  $('personal-form').addEventListener('submit',async event=>{
    event.preventDefault();if(personalBusy)return;
    const date=$('personal-date').value,name=$('personal-name').value.trim();
    if(!validDate(date)||!monthValid(date.slice(0,7))){$('personal-error').textContent='올바른 날짜를 선택해 주세요.';return;}
    if(!name||name.length>30){$('personal-error').textContent='개인 휴일 이름은 1~30자로 입력해 주세요.';return;}
    const id=personalEditingId;setPersonalBusy(true);$('personal-error').textContent='';
    try {
      await api(id===null?'/api/personal-holidays':`/api/personal-holidays/${id}`,{date,name},id===null?'POST':'PUT');
      $('personal-dialog').close();
      selectedDate=date;$('month').value=date.slice(0,7);$('date').value=date;
      notify(id===null?'개인 휴일을 지정했어요.':'개인 휴일을 수정했어요.');
      await loadMonth();$('day-title').focus();
    }catch(error){$('personal-error').textContent=errorMessage(error);}
    finally{setPersonalBusy(false);}
  });
  $('personal-remove').addEventListener('click',()=>{
    if(personalBusy||personalEditingId===null)return;
    const original=personalHolidays.find(item=>item.id===personalEditingId);
    if(!original){$('personal-error').textContent='개인 휴일을 다시 불러온 뒤 확인해 주세요.';return;}
    $('personal-delete-preview').textContent=`${dateLabel(original.date)} · ${original.name} 개인 휴일을 삭제할까요?`;
    $('personal-delete-panel').hidden=false;$('personal-delete-cancel').focus();
  });
  $('personal-delete-cancel').addEventListener('click',()=>{if(!personalBusy)$('personal-delete-panel').hidden=true;});
  $('personal-delete-confirm').addEventListener('click',async()=>{
    if(personalBusy||personalEditingId===null)return;
    setPersonalBusy(true);$('personal-error').textContent='';
    try {
      await api(`/api/personal-holidays/${personalEditingId}`,undefined,'DELETE');
      $('personal-dialog').close();notify('개인 휴일을 삭제했어요.');
      await loadMonth();$('day-title').focus();
    }catch(error){$('personal-error').textContent=errorMessage(error);}
    finally{setPersonalBusy(false);}
  });
  $('cancel-edit').addEventListener('click',()=>{if(!mutationBusy)closeEntry();});
  $('cancel-delete').addEventListener('click',()=>{if(!mutationBusy){pendingDelete=null;$('delete-dialog').close();}});
  $('delete-dialog').addEventListener('cancel',event=>{if(mutationBusy)event.preventDefault();else pendingDelete=null;});
  $('confirm-delete').addEventListener('click',async()=>{
    if(mutationBusy||!pendingDelete)return;
    const target=pendingDelete;
    setBusy(true);$('confirm-delete').textContent='삭제하는 중…';
    try {
      await api(`/api/entries/${target.id}`,undefined,'DELETE');
      if(editingId===target.id)resetEditor();
      pendingDelete=null;$('delete-dialog').close();notify('기록을 삭제했어요.');
      await loadMonth();
      monthlyUI?monthlyUI.focus():$('day-title').focus();
    }catch(error){$('delete-error').textContent=errorMessage(error);}
    finally {setBusy(false);$('confirm-delete').textContent='삭제하기';}
  });
  document.querySelectorAll('input[name="type"]').forEach(input => input.addEventListener('change',() => { $('memo').placeholder = input.value === 'income' ? '어떤 수입인가요?' : '어디에 사용했나요?';renderCategoryOptions();renderPaymentOptions(); }));
  $('entry-form').addEventListener('submit',async event => {
    event.preventDefault();
    if (mutationBusy) return;
    const rawAmount = $('amount').value.replace(/,/g,'');
    const amount = Number(rawAmount);
    if (!/^\d+$/.test(rawAmount) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999999) {
      $('form-error').textContent = '금액은 1원부터 999,999,999,999원까지 정수로 입력해 주세요.'; $('amount').focus(); return;
    }
    const date = $('date').value;
    if (!validDate(date)) { $('form-error').textContent = '올바른 날짜를 선택해 주세요.'; $('date').focus(); return; }
    const type = new FormData($('entry-form')).get('type');
    const entry={type,amount,date,memo:$('memo').value.trim(),categoryId:$('category').value?Number($('category').value):null,paymentMethodId:type==='expense'&&$('payment-method').value?Number($('payment-method').value):null};
    if(recurringEntry)entry.recurring=recurringEntry;
    const fingerprint=JSON.stringify(entry);
    if(pendingSubmission?.fingerprint!==fingerprint) pendingSubmission={fingerprint,requestId:crypto.randomUUID()};
    const updateId=editingId;
    setBusy(true); $('submit-entry').textContent='저장하는 중…';
    try {
      if(updateId!==null) await api(`/api/entries/${updateId}`,entry,'PUT');
      else await api('/api/entries',{...entry,requestId:pendingSubmission.requestId});
      pendingSubmission=null;
      $('month').value = date.slice(0,7);
      selectedDate=date;$('date').value=date;
      resetEditor();
      notify(updateId!==null?'기록을 수정했어요.':'기록을 저장했어요.');
      await loadMonth();
      $('entry-dialog').close();
      monthlyUI?.afterSave({...entry,id:updateId});
    } catch(error) { $('form-error').textContent=errorMessage(error); }
    finally { setBusy(false);$('submit-entry').textContent=editingId!==null?'변경 내용 저장':'＋ 기록 추가';if($('entry-dialog').open)$('amount').focus();else restoreEntryFocus(); }
  });
  function notify(message) {
    $('toast').textContent=message; $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);
  }
  function renderCategoryOptions(selected=$('category').value) {
    // Disabled radios are excluded from FormData during save/refresh.
    const type=$('type-income').checked?'income':'expense';
    const options=categories.filter(category=>category.type===type);
    const fragment=document.createDocumentFragment();
    const empty=document.createElement('option');empty.value='';empty.textContent='미분류';fragment.append(empty);
    options.forEach(category=>{const option=document.createElement('option');option.value=String(category.id);option.textContent=category.name;fragment.append(option);});
    $('category').replaceChildren(fragment);
    $('category').value=options.some(category=>String(category.id)===String(selected))?String(selected):'';
  }
  function renderPaymentOptions(selected=$('payment-method').value) {
    const expense=!$('type-income').checked;
    const original=editingPaymentMethodId;
    const available=paymentMethods.filter(method=>method.active||method.id===original);
    const fragment=document.createDocumentFragment();
    const empty=document.createElement('option');empty.value='';empty.textContent='미지정';fragment.append(empty);
    available.forEach(method=>{const option=document.createElement('option');option.value=String(method.id);option.textContent=method.name+(method.active?'':' · 사용 중지');fragment.append(option);});
    $('payment-method').replaceChildren(fragment);
    $('payment-method').value=expense&&available.some(method=>String(method.id)===String(selected))?String(selected):'';
    $('payment-field').hidden=!expense;
    $('payment-method').disabled=mutationBusy||!expense;
  }
  function setPaymentBusy(busy) {
    paymentBusy=busy;
    for(const id of ['payment-name','payment-save','payment-edit-cancel','payment-close','payment-reload','payment-confirm','payment-confirm-cancel'])$(id).disabled=busy;
    document.querySelectorAll('.payment-action').forEach(button=>button.disabled=busy);
  }
  function resetPaymentEditor() {
    paymentEditingId=null;$('payment-name').value='';$('payment-save').textContent='결제수단 등록';$('payment-edit-cancel').hidden=true;
  }
  function renderPaymentList() {
    const fragment=document.createDocumentFragment();
    paymentMethods.forEach(method=>{
      const row=document.createElement('div');row.className='category-row';row.dataset.id=String(method.id);
      const label=document.createElement('div');label.className='category-label';
      const name=document.createElement('span');name.className='category-title-name';name.textContent=method.name;
      const detail=document.createElement('small');detail.textContent=`${method.active?'사용 중':'사용 중지'} · ${method.usageCount}건 연결 (삭제된 기록 포함)`;label.append(name,detail);
      const actions=document.createElement('div');actions.className='record-actions';
      const addAction=(title,handler,disabled=false)=>{const button=document.createElement('button');button.type='button';button.className='payment-action';button.textContent=title;button.disabled=paymentBusy||disabled;button.setAttribute('aria-label',method.name+' '+title);button.addEventListener('click',()=>{if(!paymentBusy)handler();});actions.append(button);};
      addAction('수정',()=>{paymentEditingId=method.id;$('payment-name').value=method.name;$('payment-save').textContent='변경 내용 저장';$('payment-edit-cancel').hidden=false;paymentAction=null;$('payment-confirm-panel').hidden=true;$('payment-error').textContent='';$('payment-name').focus();});
      const confirm=(kind)=>{paymentAction={kind,method};$('payment-confirm-preview').textContent=kind==='delete'?`‘${method.name}’ 결제수단을 삭제할까요?`:`‘${method.name}’ 결제수단을 ${method.active?'사용 중지':'다시 사용'}할까요? 과거 거래는 유지돼요.`;$('payment-confirm-panel').hidden=false;$('payment-error').textContent='';$('payment-confirm-cancel').focus();};
      addAction(method.active?'사용 중지':'다시 사용',()=>confirm('toggle'));
      addAction('삭제',()=>confirm('delete'),method.usageCount>0);
      row.append(label,actions);fragment.append(row);
    });
    $('payment-list').replaceChildren(fragment);$('payment-empty').hidden=paymentMethods.length>0;
  }
  async function reloadPayments() {
    const data=await api('/api/payment-methods');paymentMethods=data.paymentMethods;renderPaymentOptions();renderPaymentList();
  }
  $('manage-payments').addEventListener('click',async()=>{
    if(mutationBusy)return;
    resetPaymentEditor();paymentAction=null;$('payment-confirm-panel').hidden=true;$('payment-error').textContent='';
    $('payment-dialog').showModal();renderPaymentList();setPaymentBusy(true);
    try{await reloadPayments();}catch(error){$('payment-error').textContent=errorMessage(error);}finally{setPaymentBusy(false);$('payment-name').focus();}
  });
  $('payment-close').addEventListener('click',()=>{if(!paymentBusy)$('payment-dialog').close();});
  $('payment-dialog').addEventListener('cancel',event=>{if(paymentBusy)event.preventDefault();});
  $('payment-edit-cancel').addEventListener('click',()=>{if(!paymentBusy){resetPaymentEditor();$('payment-error').textContent='';}});
  $('payment-reload').addEventListener('click',async()=>{
    if(paymentBusy)return;setPaymentBusy(true);$('payment-error').textContent='';
    try{await reloadPayments();await loadMonth();}catch(error){$('payment-error').textContent=errorMessage(error);}finally{setPaymentBusy(false);}
  });
  $('payment-form').addEventListener('submit',async event=>{
    event.preventDefault();if(paymentBusy)return;
    const name=$('payment-name').value.trim();
    if(!name||name.length>30||name==='미지정'){$('payment-error').textContent='결제수단 이름은 미지정을 제외한 1~30자로 입력해 주세요.';$('payment-name').focus();return;}
    const id=paymentEditingId;setPaymentBusy(true);$('payment-error').textContent='';
    try {
      const data=await api(id===null?'/api/payment-methods':`/api/payment-methods/${id}`,{name},id===null?'POST':'PUT');
      paymentMethods=data.paymentMethods;resetPaymentEditor();paymentAction=null;$('payment-confirm-panel').hidden=true;
      renderPaymentOptions();renderPaymentList();notify(id===null?'결제수단을 등록했어요.':'결제수단 이름을 수정했어요.');await loadMonth();
    }catch(error){$('payment-error').textContent=errorMessage(error);}finally{setPaymentBusy(false);$('payment-name').focus();}
  });
  $('payment-confirm-cancel').addEventListener('click',()=>{if(!paymentBusy){paymentAction=null;$('payment-confirm-panel').hidden=true;}});
  $('payment-confirm').addEventListener('click',async()=>{
    if(paymentBusy||!paymentAction)return;
    const {kind,method}=paymentAction;setPaymentBusy(true);$('payment-error').textContent='';
    try {
      const data=await api(`/api/payment-methods/${method.id}`,kind==='delete'?undefined:{active:!method.active},kind==='delete'?'DELETE':'PUT');
      paymentMethods=data.paymentMethods;if(paymentEditingId===method.id)resetPaymentEditor();paymentAction=null;$('payment-confirm-panel').hidden=true;
      renderPaymentOptions();renderPaymentList();notify(kind==='delete'?'결제수단을 삭제했어요.':'결제수단 사용 상태를 변경했어요.');await loadMonth();
    }catch(error){$('payment-error').textContent=errorMessage(error);}finally{setPaymentBusy(false);}
  });
  function setCategoryBusy(busy) {
    categoryBusy=busy;
    for(const id of ['category-name','category-color','category-save','category-edit-cancel','category-close','category-reload','category-delete-confirm','category-delete-cancel'])$(id).disabled=busy;
    $('category-type').disabled=busy||categoryEditingId!==null;
    document.querySelectorAll('.category-action').forEach(button=>button.disabled=busy);
    document.querySelectorAll('.category-swatch').forEach(button=>button.disabled=busy);
  }
  function setCategoryColor(color) {
    $('category-color').value=/^#[0-9a-f]{6}$/i.test(color||'')?color.toLowerCase():'#3f6b57';
    renderCategoryPalette();
  }
  function renderCategoryPalette() {
    const current=$('category-color').value||'#3f6b57';
    $('category-color-value').textContent=current;
    const fragment=document.createDocumentFragment();
    categoryPalette.forEach(item=>{
      const button=document.createElement('button');button.type='button';button.className='category-swatch';button.style.backgroundColor=item.value;
      button.setAttribute('aria-label',`${item.name} ${item.value}`);button.setAttribute('aria-pressed',String(current===item.value));button.title=`${item.name} · ${item.value}`;button.disabled=categoryBusy;
      button.addEventListener('click',()=>{if(categoryBusy)return;setCategoryColor(item.value);document.querySelector(`[data-swatch="${item.value}"]`)?.focus();});
      button.dataset.swatch=item.value;fragment.append(button);
    });
    $('category-palette').replaceChildren(fragment);
  }
  $('category-color').addEventListener('input',()=>renderCategoryPalette());
  $('category-color').addEventListener('change',()=>renderCategoryPalette());
  function resetCategoryEditor() {
    categoryEditingId=null;$('category-name').value='';$('category-save').textContent='카테고리 등록';
    $('category-edit-cancel').hidden=true;$('category-type').disabled=categoryBusy;
    const used=new Set(categories.filter(category=>category.type===$('category-type').value).map(category=>category.color));
    setCategoryColor((categoryPalette.find(item=>!used.has(item.value))||categoryPalette[0])?.value||'#3f6b57');
  }
  function renderCategoryList() {
    const type=$('category-type').value;
    const list=categories.filter(category=>category.type===type);
    const fragment=document.createDocumentFragment();
    list.forEach(category=>{
      const row=document.createElement('div');row.className='category-row';row.dataset.id=String(category.id);
      const label=document.createElement('div');label.className='category-label';
      const name=document.createElement('span');name.textContent=category.name;name.className='category-title-name';
      const marker=document.createElement('span');marker.className='category-color-marker';marker.style.backgroundColor=category.color||'#3f6b57';marker.setAttribute('aria-hidden','true');name.append(marker);
      const count=document.createElement('small');count.textContent=`${category.usageCount}건 사용 중`;label.append(name,count);
      const actions=document.createElement('div');actions.className='record-actions';
      const edit=document.createElement('button');edit.type='button';edit.className='category-action';edit.textContent='수정';edit.disabled=categoryBusy;edit.setAttribute('aria-label',category.name+' 이름과 색상 수정');
      edit.addEventListener('click',()=>{
        if(categoryBusy)return;
        categoryEditingId=category.id;$('category-type').disabled=true;$('category-name').value=category.name;
        setCategoryColor(category.color);
        $('category-save').textContent='변경 내용 저장';$('category-edit-cancel').hidden=false;$('category-error').textContent='';
        categoryDeleteTarget=null;$('category-delete-panel').hidden=true;$('category-name').focus();
      });
      const remove=document.createElement('button');remove.type='button';remove.className='category-action delete';remove.textContent='삭제';remove.disabled=categoryBusy;remove.setAttribute('aria-label',category.name+' 카테고리 삭제');
      remove.addEventListener('click',()=>{
        if(categoryBusy)return;
        categoryDeleteTarget=category;$('category-delete-panel').hidden=false;
        $('category-delete-preview').textContent=`‘${category.name}’ 카테고리를 삭제할까요? 사용 중인 ${category.usageCount}건은 미분류로 바뀌며, 거래와 금액은 유지돼요. 이 카테고리의 월별 예산 배정도 해제돼요.`;
        $('category-error').textContent='';$('category-delete-cancel').focus();
      });
      actions.append(edit,remove);row.append(label,actions);fragment.append(row);
    });
    $('category-list').replaceChildren(fragment);
    $('category-empty').hidden=list.length>0;
  }
  async function reloadCategories() {
    const data=await api('/api/categories');categories=data.categories;categoryPalette=data.palette||[];
    renderCategoryOptions();renderCategoryList();renderCategoryPalette();
  }
  $('manage-categories').addEventListener('click',async()=>{
    if(mutationBusy)return;
    $('category-type').value=new FormData($('entry-form')).get('type');resetCategoryEditor();
    categoryDeleteTarget=null;$('category-delete-panel').hidden=true;$('category-error').textContent='';
    $('category-dialog').showModal();renderCategoryList();setCategoryBusy(true);
    try{await reloadCategories();resetCategoryEditor();}catch(error){$('category-error').textContent=errorMessage(error);}
    finally{setCategoryBusy(false);$('category-name').focus();}
  });
  $('category-type').addEventListener('change',()=>{if(categoryBusy)return;resetCategoryEditor();categoryDeleteTarget=null;$('category-delete-panel').hidden=true;$('category-error').textContent='';renderCategoryList();});
  $('category-close').addEventListener('click',()=>{if(!categoryBusy)$('category-dialog').close();});
  $('category-dialog').addEventListener('cancel',event=>{if(categoryBusy)event.preventDefault();});
  $('category-edit-cancel').addEventListener('click',()=>{if(!categoryBusy){resetCategoryEditor();$('category-error').textContent='';}});
  $('category-reload').addEventListener('click',async()=>{
    if(categoryBusy)return;setCategoryBusy(true);$('category-error').textContent='';
    try{await reloadCategories();await loadMonth();}catch(error){$('category-error').textContent=errorMessage(error);}finally{setCategoryBusy(false);}
  });
  $('category-form').addEventListener('submit',async event=>{
    event.preventDefault();if(categoryBusy)return;
    const name=$('category-name').value.trim();
    if(!name||name.length>30){$('category-error').textContent='카테고리 이름은 1~30자로 입력해 주세요.';$('category-name').focus();return;}
    const color=$('category-color').value;
    if(!/^#[0-9a-f]{6}$/i.test(color)){$('category-error').textContent='올바른 색상을 선택해 주세요.';return;}
    const id=categoryEditingId;setCategoryBusy(true);$('category-error').textContent='';
    try {
      const data=await api(id===null?'/api/categories':`/api/categories/${id}`,{name,type:$('category-type').value,color},id===null?'POST':'PUT');
      categories=data.categories;categoryPalette=data.palette||[];resetCategoryEditor();categoryDeleteTarget=null;$('category-delete-panel').hidden=true;
      renderCategoryOptions();renderCategoryList();notify(id===null?'카테고리를 등록했어요.':'카테고리 이름과 색상을 수정했어요.');
      await loadMonth();
    }catch(error){$('category-error').textContent=errorMessage(error);}
    finally{setCategoryBusy(false);$('category-name').focus();}
  });
  $('category-delete-cancel').addEventListener('click',()=>{if(!categoryBusy){categoryDeleteTarget=null;$('category-delete-panel').hidden=true;}});
  $('category-delete-confirm').addEventListener('click',async()=>{
    if(categoryBusy||!categoryDeleteTarget)return;
    const target=categoryDeleteTarget;setCategoryBusy(true);$('category-error').textContent='';
    try {
      await api(`/api/categories/${target.id}`,undefined,'DELETE');
      if(categoryEditingId===target.id)resetCategoryEditor();
      categories=categories.filter(category=>category.id!==target.id);categoryDeleteTarget=null;$('category-delete-panel').hidden=true;
      renderCategoryOptions();renderCategoryList();notify('카테고리를 삭제했어요. 연결된 기록은 미분류로 변경됐어요.');
      await loadMonth();
    }catch(error){$('category-error').textContent=errorMessage(error);}
    finally{setCategoryBusy(false);}
  });
  $('retry-load').addEventListener('click',loadMonth);
  budgetUI=globalThis.ChagokBudget?.init({api,refresh:loadMonth,getMonth:()=>$('month').value,openCategory:key=>{
    if(loadedMonth!==$('month').value)return;
    analysisType='expense';analysisSelection=key;renderAnalysis();openAnalysisDetails();
  }});
  monthlyUI=globalThis.ChagokMonthly?.init({getMonth:()=>$('month').value,today:localDate,onRetry:loadMonth,onInput:()=>{resetEditor();showEntry();},getEntryTitle:(entry,busy)=>recurringUI?.entryTitle(entry,busy),onViewChange:view=>{calendarMode=view;if(loadedMonth===$('month').value){renderCalendar();if(view==='week')refreshCalendarWeek();}},onEdit:async entry=>{
    if(mutationBusy||loadedMonth!==$('month').value)return;
    await selectDate(entry.date);beginEdit(entry);
  },onDelete:entry=>{if(loadedMonth===$('month').value)askDelete(entry);},onCalendar:async date=>{
    await selectDate(date);$('day-title').focus();
  }});
  monthPickerUI=globalThis.ChagokMonthPicker?.init({getMonth:()=>$('month').value,onSelect:selectMonth});
  comparisonUI=globalThis.ChagokComparison?.init({api,today:localDate,reload:loadMonth});
  recurringUI=globalThis.ChagokRecurring?.init({today:localDate,api,refresh:loadMonth,openEntry:openRecurringEntry,
    getOptions:()=>({categories,paymentMethods}),notify,errorMessage});
  if(recurringUI)$('recurring-skip').addEventListener('click',async()=>{
    if(!recurringEntry||mutationBusy)return;
    setBusy(true);
    $('form-error').textContent='';
    try {
      await api('/api/recurring-occurrences/skip',recurringEntry);
      $('entry-dialog').close();resetEditor();
      notify('이번 결제를 건너뛰었어요.');
      await loadMonth();
    }catch(error){$('form-error').textContent=errorMessage(error);}
    finally{setBusy(false);if($('entry-dialog').open)$('recurring-skip').focus();else restoreEntryFocus();}
  });
  loadMonth();
})();
