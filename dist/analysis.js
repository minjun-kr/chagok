'use strict';
globalThis.ChagokAnalysis=(()=>{
  function aggregateBy(entries,type,month,describe) {
    const grouped=new Map();
    entries.filter(entry=>entry.type===type&&entry.date.slice(0,7)===month).forEach(entry=>{
      const description=describe(entry);
      const {key}=description;
      const group=grouped.get(key)||{...description,amount:0,count:0};
      group.amount+=entry.amount;group.count++;grouped.set(key,group);
      group.entries?.push(entry);
    });
    const groups=[...grouped.values()].sort((a,b)=>b.amount-a.amount||a.key.localeCompare(b.key));
    const total=groups.reduce((sum,group)=>sum+group.amount,0);
    if(total) {
      const denominator=BigInt(total);
      groups.forEach(group=>{
        const scaled=BigInt(group.amount)*1000n;
        group.tenths=Number(scaled/denominator);group.remainder=scaled%denominator;
      });
      const remaining=1000-groups.reduce((sum,group)=>sum+group.tenths,0);
      [...groups].sort((a,b)=>a.remainder===b.remainder?a.key.localeCompare(b.key):(a.remainder>b.remainder?-1:1)).slice(0,remaining).forEach(group=>group.tenths++);
      groups.forEach(group=>{delete group.remainder;group.percent=group.tenths===0?'<0.1%':`${group.tenths/10}%`;});
    }
    return {total,groups};
  }
  return Object.freeze({
    aggregate(entries,type,month) {
      return aggregateBy(entries,type,month,entry=>({
        key:entry.categoryId==null?'uncategorized':String(entry.categoryId),
        name:entry.categoryName||'미분류',color:entry.categoryColor
      }));
    },
    aggregatePayments(entries,month) {
      return aggregateBy(entries,'expense',month,entry=>({
        key:entry.paymentMethodId==null?'unspecified':String(entry.paymentMethodId),
        name:entry.paymentMethodName||'미지정',entries:[]
      }));
    },
    color(key,customColor) {
      if(key==='uncategorized')return '#a58b9c';
      return typeof customColor==='string'&&/^#[0-9a-f]{6}$/i.test(customColor)?customColor.toLowerCase():'#3f6b57';
    }
  });
})();

globalThis.ChagokComparison=(()=>{
  const daysInMonth=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
  const label=month=>Number(month.slice(5))+'월';
  const formatter=new Intl.NumberFormat('ko-KR');
  const compact=new Intl.NumberFormat('ko-KR',{notation:'compact',maximumFractionDigits:1});
  const money=value=>formatter.format(value)+'원';
  const colors={current:'#246653',previous:'#886239'};

  function previousMonth(month) {
    const date=new Date(month+'-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth()-1);
    return date.toISOString().slice(0,7);
  }
  function cumulative(entries,month,end) {
    const amounts=Array(end+1).fill(0);
    for(const entry of entries) {
      if(entry.type!=='expense'||entry.date.slice(0,7)!==month)continue;
      const day=Number(entry.date.slice(8));
      if(day<=end)amounts[day]+=entry.amount;
    }
    for(let day=1;day<=end;day++)amounts[day]+=amounts[day-1];
    return amounts;
  }

  function init({api,today,reload}) {
    const $=id=>document.getElementById('comparison-'+id);
    const slider=$('day'),chart=$('chart');
    let month,currentEntries=null,series=null,active=false,failed=false,loading=false,version=0;
    const currentMonth=today.slice(0,7);
    const hide=(message,retry=false)=>{
      $('status').textContent=message;
      $('status').hidden=false;
      $('retry').hidden=!retry;
      $('content').hidden=true;
    };
    function draw() {
      if(!series||$('content').hidden)return;
      const {width,height}=chart.getBoundingClientRect();
      if(!width||!height)return;
      const scale=Math.min(devicePixelRatio,2);
      chart.width=Math.round(width*scale);
      chart.height=Math.round(height*scale);
      const ctx=chart.getContext('2d');
      ctx.scale(scale,scale);
      const left=59,right=width-15,top=12,bottom=height-26;
      const maximum=Math.max(series.current.at(-1),series.previous.at(-1));
      const unit=10**Math.floor(Math.log10(maximum/4));
      const interval=Math.max(1,Math.ceil(maximum/4/unit)*unit);
      const x=day=>left+day/series.span*(right-left);
      const y=value=>bottom-value/(interval*4)*(bottom-top);
      ctx.font='11px system-ui';
      ctx.fillStyle='#526c60';
      ctx.strokeStyle='#dbe8df';
      for(let i=0;i<=4;i++) {
        const value=i*interval;
        ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(right,y(value));ctx.stroke();
        ctx.fillText(compact.format(value),0,y(value)+4);
      }
      for(const day of new Set([1,Math.ceil(series.span/2),series.span])) {
        ctx.textAlign=day===series.span?'right':'center';
        ctx.fillText(day+'일',x(day),height-6);
      }
      const day=Number(slider.value);
      ctx.beginPath();ctx.moveTo(x(day),top);ctx.lineTo(x(day),bottom);ctx.strokeStyle='#8da297';ctx.stroke();
      function line(values,color,dash) {
        const selected=Math.min(day,values.length-1);
        ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2.5;ctx.setLineDash(dash);
        ctx.beginPath();ctx.moveTo(x(0),y(0));
        for(let index=1;index<values.length;index++)ctx.lineTo(x(index),y(values[index]));
        ctx.stroke();ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(x(selected),y(values[selected]),4,0,Math.PI*2);ctx.fill();
      }
      line(series.current,colors.current,[]);
      line(series.previous,colors.previous,[6,4]);
    }
    function renderDay() {
      const day=Number(slider.value);
      const currentDay=Math.min(day,series.current.length-1);
      const previousDay=Math.min(day,series.previous.length-1);
      const current=series.current[currentDay],previous=series.previous[previousDay];
      const difference=current-previous;
      const dayText=day+'일';
      slider.setAttribute('aria-valuetext',dayText);
      $('day-label').textContent=dayText;
      $('current-date').textContent=label(month)+' '+currentDay+'일까지';
      $('previous-date').textContent=label(series.month)+' '+previousDay+'일까지';
      $('current-total').textContent=money(current);
      $('previous-total').textContent=money(previous);
      $('delta').dataset.direction=difference>0?'up':difference<0?'down':'same';
      $('delta').textContent=difference===0?'전월과 지출이 같아요':'전월보다 '+money(Math.abs(difference))+(difference>0?' 더 썼어요':' 덜 썼어요');
      draw();
    }
    async function load() {
      if(!active||!month||loading||series)return;
      if(!currentEntries)return;
      const prev=previousMonth(month);
      if(prev<'1000-01') {
        hide('이전 달을 비교할 수 없어요.');
        return;
      }
      const todayDay=Number(today.slice(8));
      const thisMonth=month===currentMonth;
      const end=thisMonth?todayDay:daysInMonth(month);
      const previousEnd=thisMonth?Math.min(todayDay,daysInMonth(prev)):daysInMonth(prev);
      const period=(key,last)=>key.slice(0,4)+'년 '+label(key)+' 1–'+last+'일';
      $('period').textContent=period(month,end)+' · '+period(prev,previousEnd)
        +(thisMonth?' (같은 날짜까지)':month>currentMonth?' (예정 지출 포함)':' (두 달 전체)');
      loading=true;
      const request=++version;
      hide('비교 데이터를 불러오는 중이에요.');
      try {
        const {entries}=await api('/api/entries?month='+encodeURIComponent(prev));
        if(request!==version)return;
        const current=cumulative(currentEntries,month,end);
        const previous=cumulative(entries,prev,previousEnd);
        series={month:prev,current,previous,span:Math.max(end,previousEnd)};
        if(!current.at(-1)&&!previous.at(-1)) {
          hide('비교 기간에 지출 기록이 없어요.');
          return;
        }
        $('current-label').textContent=label(month);
        $('previous-label').textContent=label(prev);
        slider.max=String(series.span);
        slider.value=slider.max;
        $('status').hidden=true;
        $('content').hidden=false;
        renderDay();
      } catch {
        if(request===version)hide('전월 기록을 불러오지 못했어요.',true);
      } finally {
        if(request===version)loading=false;
      }
    }
    slider.addEventListener('input',renderDay);
    chart.addEventListener('click',event=>{
      const box=chart.getBoundingClientRect();
      const day=Math.round((event.clientX-box.left-59)/(box.width-74)*series.span);
      slider.value=String(Math.max(1,Math.min(series.span,day)));
      renderDay();
    });
    new ResizeObserver(draw).observe(chart);
    $('retry').addEventListener('click',()=>failed?reload():load());
    return {
      update(nextMonth,entries=null,hasError=false) {
        version++;
        month=nextMonth;
        currentEntries=entries;
        failed=hasError;
        loading=false;
        series=null;
        $('period').textContent='';
        hide(failed?'선택한 달의 기록을 불러오지 못했어요.':'기록을 불러오는 중이에요.',failed);
        load();
      },
      activate(value) {
        active=value;
        if(active){load();draw();}
      }
    };
  }
  return Object.freeze({init});
})();
