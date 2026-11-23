'use strict';
globalThis.ChagokRecurring = (() => {
  const $ = id => document.getElementById(id);
  const format = new Intl.NumberFormat('ko-KR');
  const shortDate = date => Number(date.slice(5,7))+'월 '+Number(date.slice(8))+'일';
  const repeatDate = (month,day) => {
    const [year,number] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year,number,0)).getUTCDate();
    return month+'-'+String(Math.min(day,last)).padStart(2,'0');
  };
  const money = amount => amount===null ? '금액 미정' : format.format(amount)+'원';
  function shiftMonth(month,offset) {
    const [year,number] = month.split('-').map(Number);
    const next = new Date(Date.UTC(year,number-1+offset,1));
    return next.getUTCFullYear()>9999?null:next.toISOString().slice(0,7);
  }
  const empty = message => Object.assign(document.createElement('p'),{className:'recurring-empty',textContent:message});
  const action = (label,name,handler) => {
    const button = Object.assign(document.createElement('button'),{type:'button',className:'secondary-button',textContent:label});
    button.setAttribute('aria-label',name+' '+label);
    button.addEventListener('click',handler);
    return button;
  };

  function init({today,api,refresh,openEntry,getOptions,notify,errorMessage}) {
    const dialog = $('recurring-dialog');
    const form = $('recurring-form');
    const body = $('recurring-month-section');
    const deleteConfirmation = $('recurring-delete-confirmation');
    const deleteTrigger = $('recurring-delete');
    const dayForm = $('recurring-day-form');
    const newDay = $('recurring-new-day');
    const effectiveMonth = $('recurring-effective-month');
    let editing = null;
    let returnEntryId = null;
    let rules = [];
    let month = '';
    let items = [];
    let lastDate;
    let busy = false;
    let loadVersion = 0;
    const pendingLabel = date => date<today ? '미기록' : date===today ? '오늘 결제' : '예정';

    function marker(cell,dayItems) {
      const open = dayItems.filter(item => item.status==='pending').length;
      const skipped = dayItems.filter(item => item.status==='skipped').length;
      if(!open&&!skipped)return;
      const date = cell.dataset.date;
      const label = open ? pendingLabel(date) : '건너뜀';
      const count = open || skipped;
      const node = Object.assign(document.createElement('span'),{className:'recurring-marker'});
      if(open&&date<today)node.classList.add('is-late');
      if(!open)node.classList.add('is-skipped');
      const full = Object.assign(document.createElement('span'),{className:'recurring-marker-full',textContent:label+' '+count+'건'});
      const compact = Object.assign(document.createElement('span'),{className:'recurring-marker-compact',textContent:(label==='오늘 결제'?'오늘':label)+' '+count});
      node.append(full,compact);
      node.setAttribute('aria-hidden','true');
      cell.setAttribute('aria-label',cell.getAttribute('aria-label')+', '+full.textContent+(open&&skipped?', 건너뜀 '+skipped+'건':''));
      cell.append(node);
    }

    function line(name,detail) {
      const row = Object.assign(document.createElement('div'),{className:'recurring-row'});
      const label = Object.assign(document.createElement('div'),{className:'recurring-label'});
      label.append(Object.assign(document.createElement('strong'),{textContent:name}),Object.assign(document.createElement('p'),{textContent:detail}));
      row.append(label);
      return row;
    }

    function occurrenceRow(item) {
      const status = item.status==='recorded'?'기록 완료':item.status==='skipped'?'건너뜀':pendingLabel(item.dueDate);
      const method = getOptions().paymentMethods.find(option => option.id===item.paymentMethodId);
      const details = [shortDate(item.dueDate)+' 예정',status];
      if(item.actualDate&&item.actualDate!==item.dueDate)details.push(shortDate(item.actualDate)+' 결제');
      if(item.status==='pending'&&method?.active)details.push(method.name);
      const row = line(item.name,details.join(' · '));
      row.append(Object.assign(document.createElement('span'),{className:'recurring-money',textContent:money(item.actualAmount??item.amount)}));
      if((item.status==='pending'&&item.dueDate<=today)||item.linkedEntryId){
        row.append(action('확인',item.name,() => {
          if(!dialog.open)dialog.showModal();
          review.open(item);
        }));
      }
      return row;
    }

    function renderMonth() {
      $('recurring-month-title').textContent = month ? Number(month.slice(5))+'월 결제 일정' : '이달 결제 일정';
      const summary = $('recurring-month-summary');
      if(summary){
        let total = 0n;
        let unknown = 0;
        let known = 0;
        for(const item of items){
          if(item.status==='skipped')continue;
          const amount = item.status==='recorded'?item.actualAmount:item.amount;
          if(amount==null)unknown++;
          else {
            total += BigInt(amount);
            known++;
          }
        }
        $('recurring-month-total').textContent = unknown&&!known?'금액 미정':money(total);
        $('recurring-month-unknown').textContent = '금액 미정 '+format.format(unknown)+'건';
        $('recurring-month-unknown').hidden = unknown===0;
        summary.hidden = items.length===0;
      }
      $('recurring-month-list').replaceChildren(...(items.length?items.map(occurrenceRow):[empty('이달에 표시할 반복 일정이 없어요.')]));
    }

    function renderRules() {
      const rows = rules.map(rule => {
        const nextChange = rule.dayChanges?.find(change=>change.effectiveMonth>today.slice(0,7));
        let detail = '매월 '+(rule.currentRepeatDay??rule.repeatDay)+'일 · '+money(rule.amount);
        if(nextChange)detail += ' · '+nextChange.effectiveMonth+'부터 '+nextChange.repeatDay+'일';
        if(rule.endsOn)detail += ' · '+rule.endsOn+' 종료';
        const row = line(rule.name,detail);
        const edit = action('수정',rule.name,() => showForm(rule));
        edit.dataset.recurringRule = rule.id;
        row.append(edit);
        return row;
      });
      $('recurring-rule-list').replaceChildren(...(rows.length?rows:[empty('등록한 반복 일정이 없어요.')]));
    }

    async function loadRules() {
      const version = ++loadVersion;
      $('recurring-retry').hidden = true;
      $('recurring-rule-list').replaceChildren(empty('일정을 불러오는 중이에요.'));
      try {
        const data = await api('/api/recurring-rules');
        if(version!==loadVersion)return;
        rules = data.rules;
        renderRules();
      } catch(error) {
        if(version!==loadVersion)return;
        $('recurring-rule-list').replaceChildren(empty(errorMessage(error)));
        $('recurring-retry').hidden = false;
      }
    }

    function options(id,values,selected,placeholder) {
      $(id).replaceChildren(new Option(placeholder,''),...values.map(item => new Option(item.name+(item.active===0?' · 사용 중지':''),item.id)));
      $(id).value = values.some(item => item.id===selected) ? selected : '';
    }

    function showForm(rule) {
      editing = rule ?? null;
      const {categories,paymentMethods} = getOptions();
      form.reset();
      $('recurring-name').setCustomValidity('');
      $('recurring-form-title').textContent = rule ? '일정 수정' : '일정 추가';
      $('recurring-name').value = rule?.name ?? '';
      $('recurring-start').value = rule?.startsOn ?? lastDate ?? today;
      $('recurring-start').readOnly = !!rule;
      $('recurring-amount').value = rule?.amount ?? '';
      $('recurring-end').value = rule?.endsOn ?? '';
      $('recurring-error').textContent = '';
      deleteTrigger.hidden = !rule;
      $('recurring-day-setting').hidden = !rule;
      $('recurring-current-day').textContent = rule?'매월 '+(rule.currentRepeatDay??rule.repeatDay)+'일':'';
      options('recurring-category',categories.filter(item => item.type==='expense'),rule?.categoryId,'미분류');
      options('recurring-payment',paymentMethods.filter(item => item.active||item.id===rule?.paymentMethodId),rule?.paymentMethodId,'미지정');
      body.hidden = true;
      form.hidden = false;
      $('recurring-name').focus();
    }

    function showList() {
      form.hidden = true;
      dayForm.hidden = true;
      deleteConfirmation.hidden = true;
      $('recurring-review').hidden = true;
      renderMonth();
      body.hidden = false;
    }

    function focusRule(id) {
      document.querySelector('[data-recurring-rule="'+id+'"]')?.focus();
    }

    async function openList(ruleId=null) {
      showList();
      if(!dialog.open)dialog.showModal();
      await Promise.all([loadRules(),review.load()]);
      if(ruleId&&dialog.open&&!body.hidden)focusRule(ruleId);
    }

    $('recurring-open').addEventListener('click',() => {
      returnEntryId = null;
      openList();
    });
    $('recurring-close').addEventListener('click',() => dialog.close());
    $('recurring-new').addEventListener('click',() => showForm(null));
    $('recurring-cancel').addEventListener('click',() => {
      showList();
      $('recurring-new').focus();
    });
    dialog.addEventListener('close',() => {
      if(returnEntryId!==null&&!$('entry-dialog').open)focusDetailTrigger(returnEntryId);
      returnEntryId = null;
    });
    $('recurring-retry').addEventListener('click',loadRules);
    function cancelDelete() {
      deleteConfirmation.hidden = true;
      form.hidden = false;
      deleteTrigger.focus();
    }
    function cancelDayChange() {
      dayForm.hidden = true;
      form.hidden = false;
      $('recurring-day-change').focus();
    }
    dialog.addEventListener('cancel',event => {
      if(busy)event.preventDefault();
      else if(!dayForm.hidden){
        event.preventDefault();
        cancelDayChange();
      }
      else if(!deleteConfirmation.hidden){
        event.preventDefault();
        cancelDelete();
      }
    });
    function previewDayChange() {
      const preview = $('recurring-day-preview');
      const warning = $('recurring-day-warning');
      warning.hidden = !effectiveMonth.value||!editing.dayChanges?.some(change=>change.effectiveMonth>=effectiveMonth.value);
      if(!effectiveMonth.value||!effectiveMonth.validity.valid||!newDay.validity.valid){
        preview.textContent = '적용 월과 결제일을 입력하면 예정일을 확인할 수 있어요.';
        return;
      }
      const dates = Array.from({length:3},(_,offset)=>shiftMonth(effectiveMonth.value,offset))
        .filter(Boolean).map(target=>repeatDate(target,Number(newDay.value)))
        .filter(date=>!editing.endsOn||date<=editing.endsOn);
      if(dates[0]&&dates[0]<today)preview.textContent = '첫 예정일이 이미 지났어요. 오늘 또는 이후 날짜를 선택해 주세요.';
      else preview.textContent = dates.length?dates.map(date=>Number(date.slice(0,4))+'년 '+shortDate(date)).join(' · '):'종료일 전까지 적용할 결제가 없어요.';
    }
    $('recurring-day-change').addEventListener('click',() => {
      const currentMonth = today.slice(0,7);
      const next = shiftMonth(currentMonth,1)??currentMonth;
      effectiveMonth.min = [currentMonth,editing.startsOn.slice(0,7)].sort().at(-1);
      effectiveMonth.max = editing.endsOn?.slice(0,7)??'9999-12';
      effectiveMonth.value = next>effectiveMonth.max&&effectiveMonth.max>=effectiveMonth.min?effectiveMonth.min:[next,effectiveMonth.min].sort().at(-1);
      newDay.value = editing.dayChanges?.findLast(change=>change.effectiveMonth<=effectiveMonth.value)?.repeatDay??editing.repeatDay;
      $('recurring-day-error').textContent = '';
      form.hidden = true;
      dayForm.hidden = false;
      previewDayChange();
      newDay.focus();
    });
    dayForm.addEventListener('input',previewDayChange);
    $('recurring-day-cancel').addEventListener('click',cancelDayChange);
    dayForm.addEventListener('submit',async event => {
      event.preventDefault();
      if(busy)return;
      busy = true;
      const id = editing.id;
      const data = {effectiveMonth:effectiveMonth.value,repeatDay:Number(newDay.value)};
      const controls = [...dayForm.elements,$('recurring-close')];
      controls.forEach(control=>control.disabled=true);
      $('recurring-day-error').textContent = '';
      try {
        await api('/api/recurring-rules/'+id+'/payment-day',data,'PUT');
        await Promise.all([loadRules(),refresh(),review.load()]);
        showList();
        focusRule(id);
        notify('매월 결제일을 변경했어요.');
      }catch(error){
        $('recurring-day-error').textContent = errorMessage(error);
      }finally{
        busy = false;
        controls.forEach(control=>control.disabled=false);
      }
    });
    deleteTrigger.addEventListener('click',() => {
      if(!editing)return;
      $('recurring-delete-summary').textContent = editing.name+' · 매월 '+(editing.currentRepeatDay??editing.repeatDay)+'일';
      $('recurring-delete-error').textContent = '';
      form.hidden = true;
      deleteConfirmation.hidden = false;
      $('recurring-delete-cancel').focus();
    });
    $('recurring-delete-cancel').addEventListener('click',cancelDelete);
    $('recurring-delete-apply').addEventListener('click',async () => {
      if(busy||!editing)return;
      busy = true;
      const controls = [$('recurring-close'),$('recurring-delete-cancel'),$('recurring-delete-apply')];
      controls.forEach(control => control.disabled = true);
      $('recurring-delete-error').textContent = '';
      try {
        await api('/api/recurring-rules/'+editing.id,undefined,'DELETE');
        await Promise.all([loadRules(),refresh(),review.load()]);
        showList();
        $('recurring-new').focus();
        notify('반복 일정을 삭제했어요.');
      }catch(error){
        $('recurring-delete-error').textContent = errorMessage(error);
      }finally{
        busy = false;
        controls.forEach(control => control.disabled = false);
        if(!deleteConfirmation.hidden)$('recurring-delete-cancel').focus();
      }
    });
    $('recurring-name').addEventListener('input',() => $('recurring-name').setCustomValidity(''));
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if(busy)return;
      const fields = Object.fromEntries(new FormData(form));
      const name = fields.name.trim();
      if(!name){
        $('recurring-name').setCustomValidity('일정 이름을 입력해 주세요.');
        $('recurring-name').reportValidity();
        return;
      }
      const data = {name,startsOn:fields.startsOn,endsOn:fields.endsOn||null,amount:fields.amount?Number(fields.amount):null,
        categoryId:fields.categoryId?Number(fields.categoryId):null,paymentMethodId:fields.paymentMethodId?Number(fields.paymentMethodId):null};
      busy = true;
      $('recurring-error').textContent = '';
      const controls = [...form.elements,$('recurring-close')].filter(control => !control.disabled);
      controls.forEach(control => control.disabled = true);
      try {
        await api(editing===null?'/api/recurring-rules':'/api/recurring-rules/'+editing.id,data,editing===null?'POST':'PUT');
        await Promise.all([loadRules(),refresh(),review.load()]);
        showList();
        $('recurring-new').focus();
        notify('반복 일정을 저장했어요.');
      } catch(error) {
        $('recurring-error').textContent = errorMessage(error);
      } finally {
        busy = false;
        controls.forEach(control => control.disabled = false);
      }
    });

    function render(nextMonth,date,nextItems) {
      const changed = nextMonth!==month||nextItems!==items;
      if(!changed&&lastDate===date)return;
      lastDate = date;
      if(changed){
        month = nextMonth;
        items = nextItems;
        if(dialog.open&&!body.hidden)renderMonth();
      }
      const rows = items.filter(item => item.dueDate===date&&(item.status!=='recorded'||item.linkedEntryId));
      $('recurring-day').hidden = !rows.length;
      $('recurring-day-list').replaceChildren(...rows.map(occurrenceRow));
    }

    function editor(item) {
      $('entry-dialog').classList.toggle('recurring-entry',!!item);
      $('recurring-context').hidden = !item;
      $('recurring-skip').hidden = !item;
      $('date').max = item ? today : '9999-12-31';
      if(!item)return;
      $('recurring-context').textContent = item.name+' · '+shortDate(item.dueDate)+' 결제 예정';
      $('entry-title').textContent = '반복 지출 기록';
    }

    function focusDetailTrigger(id) {
      const buttons = document.querySelectorAll('[data-entry-detail-id="'+id+'"]');
      [...buttons].find(button => button.getClientRects().length)?.focus();
    }
    const entryTitle = initExpenseDetail({api,refresh,getOptions,errorMessage,
      openSchedule(entry){
        returnEntryId = entry.id;
        openList(entry.recurringRuleId);
      },
      onClose(entry){if(!dialog.open)focusDetailTrigger(entry.id);}
    });
    const review = initReview({dialog,form,body,api,refresh,openEntry,notify,errorMessage,
      showList,loadRules,occurrenceRow,line});
    return {marker,render,editor,entryTitle,updateCount:review.updateCount};
  }

  function initReview({dialog,form,body,api,refresh,openEntry,notify,errorMessage,
    showList,loadRules,occurrenceRow,line}) {
    const root = '/api/recurring-occurrences/';
    const inbox = $('recurring-inbox-list');
    const search = $('recurring-search');
    const searchPanel = $('recurring-search-panel');
    const confirmation = $('recurring-link-confirm');
    const candidateList = $('recurring-candidates');
    const error = $('recurring-review-error');
    const record = $('recurring-review-record');
    const connect = $('recurring-review-link');
    const skip = $('recurring-review-skip');
    const unlink = $('recurring-review-unlink');
    const inboxMore = $('recurring-inbox-more');
    const candidateMore = $('recurring-candidates-more');
    let item, chosen, filters, cursor;
    let offset = 0;
    let searchVersion = 0;
    let inboxVersion = 0;
    let countVersion = 0;
    let writing = false;
    const fullDate = date => Number(date.slice(0,4))+'년 '+shortDate(date);
    const ref = () => ({ruleId:item.id,dueDate:item.dueDate});
    const transactionLabel = entry => [fullDate(entry.date),money(entry.amount),entry.paymentMethodName||'결제수단 미지정'].join(' · ');

    function count(total) {
      $('recurring-count').hidden = total===0;
      $('recurring-count').textContent = '확인 '+format.format(total)+'건';
      $('recurring-inbox-title').textContent = '확인할 결제 '+format.format(total)+'건';
    }
    async function updateCount() {
      const version = ++countVersion;
      try {
        const data = await api(root+'inbox?countOnly=1');
        if(version===countVersion)count(data.total);
      }catch{ /* The inbox can be retried independently of the calendar. */ }
    }
    async function load(append=false) {
      const version = ++inboxVersion;
      const countRequest = ++countVersion;
      const retry = $('recurring-inbox-retry');
      retry.hidden = true;
      inboxMore.disabled = true;
      if(!append){
        cursor = null;
        inboxMore.hidden = true;
        inbox.replaceChildren(empty('결제를 불러오는 중이에요.'));
      }
      try {
        const params = new URLSearchParams(cursor?{after:cursor.dueDate,afterId:cursor.id}:{});
        const data = await api(root+'inbox?'+params);
        if(version!==inboxVersion)return;
        if(countRequest===countVersion)count(data.total);
        const rows = data.items.map(occurrenceRow);
        if(append)inbox.append(...rows);
        else inbox.replaceChildren(...(rows.length?rows:[empty('확인할 결제가 없어요.')]));
        cursor = data.items.at(-1)??cursor;
        inboxMore.hidden = !data.hasMore;
        if(append&&rows.length)rows[0].querySelector('button')?.focus();
      }catch(cause){
        if(version!==inboxVersion)return;
        if(!append)inbox.replaceChildren(empty(errorMessage(cause)));
        retry.hidden = false;
      }finally{if(version===inboxVersion)inboxMore.disabled=false;}
    }
    function open(next) {
      item = next;
      searchVersion++;
      form.hidden = true;
      body.hidden = true;
      $('recurring-review').hidden = false;
      searchPanel.hidden = true;
      confirmation.hidden = true;
      error.textContent = '';
      $('recurring-review-title').textContent = next.name;
      $('recurring-review-summary').textContent = fullDate(next.dueDate)+' 예정 · '+money(next.amount)
        +(next.linkedEntryId?' · '+fullDate(next.actualDate)+' 결제 '+money(next.actualAmount):'');
      record.hidden = connect.hidden = skip.hidden = next.status!=='pending';
      unlink.hidden = !next.linkedEntryId;
      $('recurring-review-title').focus();
    }
    function back() {
      searchVersion++;
      showList();
      load();
      if(!$('recurring-rule-list').childElementCount)loadRules();
      $('recurring-inbox-title').focus();
    }
    async function searchEntries(append=false) {
      const version = ++searchVersion;
      if(!append){
        filters = Object.fromEntries(new FormData(search));
        offset = 0;
        candidateList.replaceChildren(empty('지출을 찾는 중이에요.'));
      }
      candidateMore.hidden = true;
      error.textContent = '';
      try {
        const params = new URLSearchParams({...ref(),...filters,offset});
        const data = await api(root+'candidates?'+params);
        if(version!==searchVersion)return;
        const rows = data.entries.map(entry => {
          const row = line(entry.memo||'지출',transactionLabel(entry));
          row.append(action('선택',entry.memo||'지출',() => {
            chosen = entry;
            searchPanel.hidden = true;
            confirmation.hidden = false;
            $('recurring-link-preview').textContent = (entry.memo||'지출')+' · '+transactionLabel(entry);
            $('recurring-link-apply').focus();
          }));
          return row;
        });
        if(append)candidateList.append(...rows);
        else candidateList.replaceChildren(...(rows.length?rows:[empty('연결할 지출이 없어요.')]));
        offset += rows.length;
        candidateMore.hidden = !data.hasMore;
        if(append&&rows.length)rows[0].querySelector('button')?.focus();
      }catch(cause){
        if(version!==searchVersion)return;
        if(!append)candidateList.replaceChildren();
        error.textContent = errorMessage(cause);
        candidateMore.hidden = !append;
      }
    }
    function dateNear(date,days) {
      const shifted = new Date(date+'T00:00:00Z');
      shifted.setUTCDate(shifted.getUTCDate()+days);
      if(shifted.getUTCFullYear()<1000)return '1000-01-01';
      if(shifted.getUTCFullYear()>9999)return '9999-12-31';
      return shifted.toISOString().slice(0,10);
    }
    async function resolve(path,payload,method,message) {
      if(writing)return;
      writing = true;
      error.textContent = '';
      const controls = [...$('recurring-review').querySelectorAll('button,input'),$('recurring-close')];
      controls.forEach(control=>control.disabled=true);
      try {
        await api(root+path,{...ref(),...payload},method);
        await refresh();
        back();
        notify(message);
      }catch(cause){error.textContent=errorMessage(cause);}
      finally{
        writing = false;
        controls.forEach(control=>control.disabled=false);
      }
    }
    inboxMore.addEventListener('click',()=>load(true));
    $('recurring-inbox-retry').addEventListener('click',()=>load());
    $('recurring-review-back').addEventListener('click',back);
    dialog.addEventListener('cancel',event=>{if(writing)event.preventDefault();});
    dialog.addEventListener('close',()=>{if(!dialog.open)searchVersion++;});
    record.addEventListener('click',()=>{
      $('entry-dialog').addEventListener('close',()=>{if(dialog.open)back();},{once:true});
      openEntry(item,record);
    });
    connect.addEventListener('click',()=>{
      search.reset();
      search.elements.start.value = dateNear(item.dueDate,-7);
      search.elements.end.value = dateNear(item.dueDate,7);
      searchPanel.hidden = false;
      confirmation.hidden = true;
      search.elements.q.focus();
      searchEntries();
    });
    skip.addEventListener('click',()=>resolve('skip',{},'POST','이번 결제를 건너뛰었어요.'));
    unlink.addEventListener('click',()=>resolve('link',{entryId:item.linkedEntryId},'DELETE','지출 연결을 해제했어요.'));
    $('recurring-link-apply').addEventListener('click',()=>resolve('link',{entryId:chosen.id},'POST','기존 지출을 연결했어요.'));
    $('recurring-link-cancel').addEventListener('click',()=>{
      confirmation.hidden = true;
      searchPanel.hidden = false;
      candidateList.querySelector('button')?.focus();
    });
    search.addEventListener('submit',event=>{event.preventDefault();searchEntries();});
    candidateMore.addEventListener('click',()=>searchEntries(true));
    return {open,load,updateCount};
  }

  function initExpenseDetail({api,refresh,getOptions,errorMessage,openSchedule,onClose}) {
    const dialog = $('expense-detail-dialog');
    const toggle = $('expense-repeat-toggle');
    const form = $('expense-repeat-form');
    const start = $('expense-repeat-start');
    const day = $('expense-repeat-day');
    const status = $('expense-repeat-status');
    const view = $('expense-repeat-view');
    const close = $('expense-detail-close');
    let selected = null;
    let saving = false;

    async function showLinked(entry) {
      $('expense-repeat-toggle-label').hidden = true;
      form.hidden = true;
      $('expense-repeat-linked').hidden = false;
      status.textContent = '연결된 일정을 불러오는 중이에요.';
      try {
        const {rule} = await api('/api/recurring-rules/'+entry.recurringRuleId);
        if(selected!==entry||!dialog.open)return;
        const next = rule.nextDueDate;
        const nextLabel = next ? '다음 예정 '+Number(next.slice(0,4))+'년 '+shortDate(next) : '예정된 결제 없음';
        status.textContent = '매월 '+(rule.nextRepeatDay??rule.currentRepeatDay??rule.repeatDay)+'일 · '+nextLabel;
      }catch{
        if(selected===entry&&dialog.open)status.textContent = '연결된 반복 일정이 있어요.';
      }
    }

    function open(entry) {
      selected = {...entry};
      $('expense-detail-name').textContent = entry.memo||'지출';
      $('expense-detail-amount').textContent = money(entry.amount);
      $('expense-detail-date').textContent = entry.date;
      $('expense-detail-category').textContent = entry.categoryName||'미분류';
      $('expense-detail-payment').textContent = entry.paymentMethodName||'미지정';
      form.reset();
      toggle.checked = false;
      form.hidden = true;
      $('expense-repeat-linked').hidden = true;
      $('expense-repeat-error').textContent = '';
      const canRepeat = !entry.recurringRuleId&&!entry.date.startsWith('9999-12');
      $('expense-repeat-toggle-label').hidden = !canRepeat;
      if(canRepeat){
        const [year,month,originalDay] = entry.date.split('-').map(Number);
        const next = new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);
        day.value = originalDay;
        start.min = next+'-01';
        start.value = repeatDate(next,originalDay);
        $('expense-repeat-amount').value = entry.amount;
      }
      dialog.showModal();
      if(entry.recurringRuleId)showLinked(selected);
    }

    close.addEventListener('click',() => dialog.close());
    dialog.addEventListener('cancel',event => {if(saving)event.preventDefault();});
    dialog.addEventListener('close',() => {
      if(!dialog.open&&selected)onClose(selected);
    });
    view.addEventListener('click',() => {
      dialog.close();
      openSchedule(selected);
    });
    toggle.addEventListener('change',() => {form.hidden = !toggle.checked;});
    start.addEventListener('change',() => {
      if(start.value&&repeatDate(start.value.slice(0,7),Number(day.value))!==start.value)day.value = Number(start.value.slice(8));
    });
    day.addEventListener('input',() => {
      if(start.value&&day.validity.valid)start.value = repeatDate(start.value.slice(0,7),Number(day.value));
    });
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if(saving||!toggle.checked)return;
      const entry = selected;
      const fields = new FormData(form);
      const activePayment = getOptions().paymentMethods.some(method => method.id===entry.paymentMethodId&&method.active);
      const data = {sourceEntryId:entry.id,name:entry.memo||entry.categoryName||'지출',startsOn:fields.get('startsOn'),
        repeatDay:Number(fields.get('repeatDay')),amount:fields.get('amount')?Number(fields.get('amount')):null,
        categoryId:entry.categoryId,paymentMethodId:activePayment?entry.paymentMethodId:null};
      const controls = [...form.elements,toggle,close,view];
      saving = true;
      controls.forEach(control => control.disabled = true);
      $('expense-repeat-error').textContent = '';
      try {
        const {rule} = await api('/api/recurring-rules',data);
        entry.recurringRuleId = rule.id;
        await Promise.all([showLinked(entry),refresh()]);
      }catch(error){
        $('expense-repeat-error').textContent = errorMessage(error);
      }finally{
        saving = false;
        controls.forEach(control => control.disabled = false);
        (entry.recurringRuleId?view:$('expense-repeat-save')).focus();
      }
    });

    return (entry,busy) => {
      if(entry.type!=='expense')return null;
      const button = Object.assign(document.createElement('button'),{type:'button',className:'entry-detail-trigger',textContent:entry.memo||'지출',disabled:busy});
      button.setAttribute('aria-label',(entry.memo||'지출')+' 상세 보기');
      button.setAttribute('aria-haspopup','dialog');
      button.dataset.entryDetailId = entry.id;
      button.addEventListener('click',() => open(entry));
      return button;
    };
  }
  return {init};
})();
