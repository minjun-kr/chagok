const conflict = message => Object.assign(new Error(message), {status:409});
const missing = () => Object.assign(new Error('반복 지출 일정을 찾을 수 없어요.'), {status:404});
const localDate = () => {
  const date = new Date();
  return [date.getFullYear(),date.getMonth()+1,date.getDate()].map(value => String(value).padStart(2,'0')).join('-');
};

function dueDate(month, repeatDay) {
  const [year,number] = month.split('-').map(Number);
  const day = Math.min(repeatDay,new Date(Date.UTC(year,number,0)).getUTCDate());
  return month+'-'+String(day).padStart(2,'0');
}
const monthIndex = date => Number(date.slice(0,4))*12+Number(date.slice(5,7))-1;
const monthAt = index => String(Math.floor(index/12)).padStart(4,'0')+'-'+String(index%12+1).padStart(2,'0');

export function createRecurring(db, {validDate,invalid,checkCategory,checkPayment,save}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
      starts_on TEXT NOT NULL,
      ends_on TEXT CHECK(ends_on >= starts_on),
      amount INTEGER CHECK(amount BETWEEN 1 AND 999999999999),
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      payment_method_id INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS recurring_occurrences (
      rule_id INTEGER NOT NULL REFERENCES recurring_rules(id),
      due_date TEXT NOT NULL,
      skipped INTEGER NOT NULL CHECK(skipped IN (0,1)),
      entry_id INTEGER UNIQUE REFERENCES entries(id),
      CHECK((skipped=1 AND entry_id IS NULL) OR (skipped=0 AND entry_id IS NOT NULL)),
      PRIMARY KEY(rule_id,due_date)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS recurring_occurrences_date ON recurring_occurrences(due_date);
    CREATE UNIQUE INDEX IF NOT EXISTS recurring_occurrences_month ON recurring_occurrences(rule_id,substr(due_date,1,7));
    CREATE TABLE IF NOT EXISTS recurring_day_changes (
      rule_id INTEGER NOT NULL REFERENCES recurring_rules(id),
      effective_month TEXT NOT NULL,
      repeat_day INTEGER NOT NULL CHECK(repeat_day BETWEEN 1 AND 31),
      PRIMARY KEY(rule_id,effective_month)
    ) STRICT;
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(recurring_rules)').all();
    if(!columns.some(column => column.name==='repeat_day')){
      db.exec('ALTER TABLE recurring_rules ADD COLUMN repeat_day INTEGER CHECK(repeat_day BETWEEN 1 AND 31)');
    }
    if(!columns.some(column => column.name==='source_entry_id')){
      db.exec('ALTER TABLE recurring_rules ADD COLUMN source_entry_id INTEGER REFERENCES entries(id)');
    }
    if(!columns.some(column => column.name==='deleted_at')){
      db.exec('ALTER TABLE recurring_rules ADD COLUMN deleted_at INTEGER');
      db.exec('DROP INDEX IF EXISTS recurring_rules_source_entry');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS recurring_rules_source_entry ON recurring_rules(source_entry_id) WHERE source_entry_id IS NOT NULL AND deleted_at IS NULL');
    if(!db.prepare('PRAGMA table_info(recurring_occurrences)').all().some(column=>column.name==='linked_existing')){
      db.exec('ALTER TABLE recurring_occurrences ADD COLUMN linked_existing INTEGER NOT NULL DEFAULT 0 CHECK(linked_existing IN (0,1))');
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const ruleColumns = `id,name,starts_on AS startsOn,ends_on AS endsOn,amount,category_id AS categoryId,
    payment_method_id AS paymentMethodId,COALESCE(repeat_day,CAST(substr(starts_on,9,2) AS INTEGER)) AS repeatDay`;
  const allRules = db.prepare('SELECT '+ruleColumns+' FROM recurring_rules WHERE deleted_at IS NULL ORDER BY starts_on,id');
  const findRule = db.prepare('SELECT '+ruleColumns+' FROM recurring_rules WHERE id=? AND deleted_at IS NULL');
  const linkedRule = db.prepare(`SELECT COALESCE(
    (SELECT id FROM recurring_rules WHERE source_entry_id=? AND deleted_at IS NULL),
    (SELECT r.id FROM recurring_occurrences o JOIN recurring_rules r ON r.id=o.rule_id WHERE o.entry_id=? AND r.deleted_at IS NULL)
  ) AS id`);
  const deleteRule = db.prepare('UPDATE recurring_rules SET deleted_at=COALESCE(deleted_at,?) WHERE id=?');
  const sourceEntry = db.prepare("SELECT date FROM entries WHERE id=? AND deleted_at IS NULL AND type='expense'");
  const saveRule = db.prepare('INSERT INTO recurring_rules(name,starts_on,ends_on,amount,category_id,payment_method_id,repeat_day,source_entry_id) VALUES(?,?,?,?,?,?,?,?)');
  const updateRule = db.prepare('UPDATE recurring_rules SET name=?,ends_on=?,amount=?,category_id=?,payment_method_id=? WHERE id=?');
  const occurrenceColumns = 'o.rule_id AS ruleId,o.due_date AS dueDate,o.skipped,o.entry_id AS entryId,o.linked_existing AS linkedExisting,e.request_id AS requestId,e.date AS actualDate,e.amount AS actualAmount,e.deleted_at AS deletedAt,e.type AS entryType';
  const occurrenceFrom = ' FROM recurring_occurrences o LEFT JOIN entries e ON e.id=o.entry_id';
  const monthRows = db.prepare('SELECT '+occurrenceColumns+occurrenceFrom+' WHERE o.due_date BETWEEN ? AND ?');
  const findOccurrence = db.prepare('SELECT '+occurrenceColumns+occurrenceFrom+' WHERE o.rule_id=? AND substr(o.due_date,1,7)=?');
  const laterOccurrences = db.prepare('SELECT '+occurrenceColumns+occurrenceFrom+' WHERE o.rule_id=? AND o.due_date>=?');
  const dayChanges = db.prepare('SELECT effective_month AS effectiveMonth,repeat_day AS repeatDay FROM recurring_day_changes WHERE rule_id=? ORDER BY effective_month');
  const removeLaterChanges = db.prepare('DELETE FROM recurring_day_changes WHERE rule_id=? AND effective_month>?');
  const saveDayChange = db.prepare(`INSERT INTO recurring_day_changes(rule_id,effective_month,repeat_day) VALUES(?,?,?)
    ON CONFLICT(rule_id,effective_month) DO UPDATE SET repeat_day=excluded.repeat_day`);
  const mark = db.prepare(`INSERT INTO recurring_occurrences(rule_id,due_date,skipped,entry_id,linked_existing) VALUES(?,?,?,?,?)
    ON CONFLICT(rule_id,substr(due_date,1,7)) DO UPDATE SET due_date=excluded.due_date,
    skipped=excluded.skipped,entry_id=excluded.entry_id,linked_existing=excluded.linked_existing`);
  const occupied = db.prepare('SELECT 1 FROM recurring_occurrences WHERE entry_id=?');
  const unlinkRow = db.prepare('DELETE FROM recurring_occurrences WHERE rule_id=? AND due_date=? AND linked_existing=1 AND entry_id=?');
  const candidateRows = db.prepare(`SELECT e.id,e.date,e.memo,e.amount,p.name AS paymentMethodName
    FROM entries e LEFT JOIN payment_methods p ON p.id=e.payment_method_id
    WHERE e.type='expense' AND e.deleted_at IS NULL AND e.date BETWEEN ? AND ?
      AND instr(lower(e.memo),lower(?))>0
      AND NOT EXISTS(SELECT 1 FROM recurring_occurrences o WHERE o.entry_id=e.id)
    ORDER BY ((trim(e.memo)=?) + (e.amount IS ?)) DESC,abs(julianday(e.date)-julianday(?)),e.date DESC,e.id DESC
    LIMIT ? OFFSET ?`);
  const entryId = db.prepare('SELECT id FROM entries WHERE request_id=?');
  const state = row => row?.skipped ? 'skipped' : row?.entryType==='expense'&&row.deletedAt===null ? 'recorded' : 'pending';
  const dayFor = (rule,changes,month) => changes.findLast(change=>change.effectiveMonth<=month)?.repeatDay ?? rule.repeatDay;
  const describeRule = (rule,changes=dayChanges.all(rule.id)) => ({
    ...rule,dayChanges:changes,currentRepeatDay:dayFor(rule,changes,localDate().slice(0,7))
  });

  function readRule(id) {
    const rule = findRule.get(id);
    if(!rule)throw missing();
    const today = localDate();
    const described = describeRule(rule);
    let index = monthIndex(rule.startsOn>today?rule.startsOn:today);
    for(;index<=monthIndex('9999-12');index++){
      const month = monthAt(index);
      const nextRepeatDay = dayFor(rule,described.dayChanges,month);
      const nextDueDate = dueDate(month,nextRepeatDay);
      if(rule.endsOn&&nextDueDate>rule.endsOn)return {...described,nextDueDate:null};
      if(nextDueDate>=today&&state(findOccurrence.get(id,month))==='pending'){
        return {...described,nextDueDate,nextRepeatDay};
      }
    }
    return {...described,nextDueDate:null};
  }

  function list(month) {
    const rows = new Map(monthRows.all(month+'-01',month+'-31').map(row => [row.ruleId,row]));
    return allRules.all().flatMap(rule => {
      const row = rows.get(rule.id);
      const status = state(row);
      const date = status==='pending'?dueDate(month,dayFor(rule,dayChanges.all(rule.id),month)):row.dueDate;
      if(month<rule.startsOn.slice(0,7) || (rule.endsOn&&date>rule.endsOn&&status==='pending'))return [];
      return [{...rule,dueDate:date,status,actualDate:status==='recorded'?row.actualDate:null,actualAmount:status==='recorded'?row.actualAmount:null,
        linkedEntryId:status==='recorded'&&row.linkedExisting?row.entryId:null}];
    }).sort((a,b) => a.dueDate.localeCompare(b.dueDate) || a.id-b.id);
  }

  function changeDay(id,data) {
    const rule = findRule.get(id);
    if(!rule)throw missing();
    const {effectiveMonth,repeatDay} = data??{};
    if(typeof effectiveMonth!=='string'||!validDate(effectiveMonth+'-01')||
       !Number.isInteger(repeatDay)||repeatDay<1||repeatDay>31)throw invalid('적용 시작 월과 새 결제일을 확인해 주세요.');
    const today = localDate();
    const firstDue = dueDate(effectiveMonth,repeatDay);
    if(effectiveMonth<rule.startsOn.slice(0,7)||firstDue<today)throw invalid('첫 적용일은 일정 시작 월 이후이면서 오늘 또는 이후여야 해요.');
    if(rule.endsOn&&firstDue>rule.endsOn)throw invalid('종료일 이내에 결제할 수 있는 월과 날짜를 선택해 주세요.');
    if(laterOccurrences.all(id,effectiveMonth+'-01').some(row=>state(row)!=='pending')){
      throw conflict('이미 처리한 결제가 있어요. 해당 결제보다 뒤의 월부터 적용해 주세요.');
    }
    removeLaterChanges.run(id,effectiveMonth);
    saveDayChange.run(id,effectiveMonth,repeatDay);
    return readRule(id);
  }

  function writeRule(data,id) {
    const current = id === null ? null : findRule.get(id);
    if(id!==null&&!current)throw missing();
    const sourceId = data?.sourceEntryId ?? null;
    let source;
    if(sourceId!==null){
      if(current||!Number.isSafeInteger(sourceId)||sourceId<1)throw invalid('올바른 원본 지출을 선택해 주세요.');
      const existing = linkedRule.get(sourceId,sourceId).id;
      if(existing!==null)return {rule:findRule.get(existing),created:false};
      source = sourceEntry.get(sourceId);
      if(!source)throw Object.assign(new Error('원본 지출을 찾을 수 없어요. 내역을 새로 불러와 주세요.'),{status:404});
    }
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if(!name||name.length>80)throw invalid('일정 이름은 1~80자로 입력해 주세요.');
    const startsOn = current?.startsOn ?? data.startsOn;
    if(!validDate(startsOn))throw invalid('올바른 첫 결제 예정일을 선택해 주세요.');
    if(current&&data.startsOn!==undefined&&data.startsOn!==startsOn)throw invalid('등록한 일정의 첫 결제일은 변경할 수 없어요.');
    const repeatDay = data.repeatDay ?? current?.repeatDay ?? Number(startsOn.slice(8));
    if(!Number.isInteger(repeatDay)||repeatDay<1||repeatDay>31||startsOn!==dueDate(startsOn.slice(0,7),repeatDay)){
      throw invalid('첫 결제 예정일과 매월 결제일을 확인해 주세요.');
    }
    if(current&&repeatDay!==current.repeatDay)throw invalid('등록한 일정의 매월 결제일은 변경할 수 없어요.');
    if(source&&startsOn.slice(0,7)<=source.date.slice(0,7))throw invalid('첫 결제 예정일은 원본 거래의 다음 달부터 선택해 주세요.');
    const endsOn = data.endsOn ?? null;
    if(endsOn!==null&&(!validDate(endsOn)||endsOn<startsOn))throw invalid('종료일은 첫 결제일과 같거나 이후여야 해요.');
    const amount = data.amount ?? null;
    if(amount!==null&&(!Number.isSafeInteger(amount)||amount<1||amount>999999999999))throw invalid('기본 금액은 1원부터 999,999,999,999원까지 입력해 주세요.');
    const defaults = {...data,type:'expense'};
    const categoryId = checkCategory(defaults);
    const paymentId = checkPayment(defaults,current?.paymentMethodId);
    if(current)updateRule.run(name,endsOn,amount,categoryId,paymentId,id);
    else id = Number(saveRule.run(name,startsOn,endsOn,amount,categoryId,paymentId,repeatDay,sourceId).lastInsertRowid);
    return {rule:findRule.get(id),created:!current};
  }

  function occurrence(ref) {
    if(!Number.isSafeInteger(ref?.ruleId)||ref.ruleId<1||!validDate(ref.dueDate))throw invalid('올바른 반복 지출 회차를 선택해 주세요.');
    const {ruleId,dueDate:date} = ref;
    const rule = findRule.get(ruleId);
    if(!rule)throw missing();
    const month = date.slice(0,7);
    const current = findOccurrence.get(ruleId,month);
    const status = state(current);
    const expected = status==='pending'?dueDate(month,dayFor(rule,dayChanges.all(ruleId),month)):current.dueDate;
    if(month<rule.startsOn.slice(0,7)||expected!==date)throw missing();
    if(date>localDate())throw invalid('결제 예정일부터 처리할 수 있어요.');
    return {rule,date,current,status};
  }

  function pending(rule,date,status) {
    if(status!=='pending')throw conflict('이미 처리된 결제예요. 반복 일정에서 다시 확인해 주세요.');
    if(rule.endsOn&&date>rule.endsOn)throw missing();
  }

  function inbox(after,afterId,limit) {
    const today = localDate();
    const resolved = new Map();
    for(const row of monthRows.all('1000-01-01',today)){
      if(state(row)==='pending')continue;
      if(!resolved.has(row.ruleId))resolved.set(row.ruleId,[]);
      resolved.get(row.ruleId).push(monthIndex(row.dueDate));
    }
    let total = 0;
    const candidates = [];
    for(const rule of allRules.all()){
      const through = rule.endsOn&&rule.endsOn<today?rule.endsOn:today;
      const startMonth = rule.startsOn.slice(0,7);
      const changes = [{effectiveMonth:startMonth,repeatDay:rule.repeatDay},...dayChanges.all(rule.id)];
      const throughMonth = monthIndex(through);
      const closed = new Set(resolved.get(rule.id));
      let added = 0;
      for(const [position,change] of changes.entries()){
        const first = monthIndex(change.effectiveMonth);
        let last = throughMonth-(dueDate(through.slice(0,7),change.repeatDay)>through?1:0);
        if(changes[position+1])last = Math.min(last,monthIndex(changes[position+1].effectiveMonth)-1);
        if(last<first)continue;
        total += last-first+1;
        for(const index of closed)if(index>=first&&index<=last)total--;
        if(!limit)continue;
        for(let index=Math.max(first,after?monthIndex(after):first);index<=last&&added<limit+1;index++){
          const date = dueDate(monthAt(index),change.repeatDay);
          if(closed.has(index)||date<after||(date===after&&rule.id<=afterId))continue;
          candidates.push({...rule,dueDate:date,status:'pending'});
          added++;
        }
      }
    }
    candidates.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id-b.id);
    return {total,items:candidates.slice(0,limit),hasMore:candidates.length>limit};
  }

  function candidates(ref,start,end,query,offset) {
    const {rule,date,status} = occurrence(ref);
    pending(rule,date,status);
    if(!validDate(start)||!validDate(end)||start>end)throw invalid('조회 시작일과 종료일을 확인해 주세요.');
    const rows = candidateRows.all(start,end<localDate()?end:localDate(),query,rule.name,rule.amount,date,31,offset);
    return {entries:rows.slice(0,30),hasMore:rows.length>30};
  }

  // All occurrence writes run inside the caller's transaction.
  function link(ref,remove) {
    const {rule,date,current,status} = occurrence(ref);
    const id = ref.entryId;
    if(!Number.isSafeInteger(id)||id<1)throw invalid('연결할 지출을 선택해 주세요.');
    if(remove){
      if(!current)return;
      if(!unlinkRow.run(rule.id,date,id).changes)throw conflict('연결된 지출이 바뀌었어요. 다시 확인해 주세요.');
      return;
    }
    if(status==='recorded'&&current.linkedExisting&&current.entryId===id)return;
    pending(rule,date,status);
    const source = sourceEntry.get(id);
    if(!source||source.date>localDate())throw invalid('오늘 또는 이전 날짜의 지출을 선택해 주세요.');
    if(occupied.get(id))throw conflict('이미 다른 회차에 연결된 지출이에요.');
    mark.run(rule.id,date,0,id,1);
  }

  function process(ref, entry, requestId) {
    const {rule,date,current,status} = occurrence(ref);
    const ruleId = rule.id;
    const key = 'recurring:'+ruleId+':'+date+':'+requestId;
    if(entry&&status==='recorded'&&current.requestId===key)return save(entry,key);
    if(!entry&&status==='skipped')return false;
    pending(rule,date,status);
    const today = localDate();
    if(date>today)throw invalid('결제 예정일부터 처리할 수 있어요.');
    if(entry&&(entry.type!=='expense'||entry.date>today))throw invalid('오늘 또는 이전 날짜의 실제 지출을 입력해 주세요.');
    if(!entry) {
      mark.run(ruleId,date,1,null,0);
      return true;
    }
    const added = save(entry,key);
    mark.run(ruleId,date,0,entryId.get(key).id,0);
    return added;
  }
  function removeRule(id) {
    if(!deleteRule.run(Date.now(),id).changes)throw missing();
  }

  return {list,rules:()=>allRules.all().map(rule=>describeRule(rule)),readRule,writeRule,changeDay,removeRule,process,inbox,candidates,link};
}
