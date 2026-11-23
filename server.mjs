import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRecurring } from './recurring.mjs';

const defaultPath = fileURLToPath(new URL('./data/budget.sqlite', import.meta.url));
const categoryPalette=JSON.parse(await readFile(new URL('./category-colors.json',import.meta.url),'utf8'));
const validColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1000-01-01' && value <= '9999-12-31' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const invalid = message => Object.assign(new Error(message), { status: 400 });
function validate(entry) {
  if (!entry || !['income','expense'].includes(entry.type)) throw invalid('수입 또는 지출을 선택해 주세요.');
  if (!Number.isSafeInteger(entry.amount) || entry.amount < 1 || entry.amount > 999999999999) throw invalid('금액은 1원부터 999,999,999,999원까지 정수로 입력해 주세요.');
  if (!validDate(entry.date)) throw invalid('올바른 날짜를 선택해 주세요.');
  if (typeof entry.memo !== 'string' || entry.memo.length > 80) throw invalid('내용은 80자 이내로 입력해 주세요.');
}
export async function createApp({ dbPath = defaultPath } = {}) {
  await mkdir(dirname(dbPath), {recursive:true});
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 30),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS personal_holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 30),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 30),
      UNIQUE(type,name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 999999999999),
      date TEXT NOT NULL,
      memo TEXT NOT NULL CHECK(length(memo)<=80),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS entries_date ON entries(date);`);
  db.exec(`CREATE TABLE IF NOT EXISTS monthly_budgets (
    month TEXT PRIMARY KEY,
    amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 999999999999)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS category_budgets (
    month TEXT NOT NULL REFERENCES monthly_budgets(month) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 999999999999),
    PRIMARY KEY(month,category_id)
  ) STRICT;`);
  const validMonth=month=>typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month>='1000-01';
  const getBudget=month=>{
    const budget=db.prepare('SELECT month,amount FROM monthly_budgets WHERE month=?').get(month);
    return budget?{...budget,categories:db.prepare('SELECT category_id AS categoryId,amount FROM category_budgets WHERE month=? ORDER BY category_id').all(month)}:null;
  };
  // Keep deleted IDs reserved so retrying deletion can never target a new record.
  if(!db.prepare('PRAGMA table_info(entries)').all().some(column=>column.name==='deleted_at')) db.exec('ALTER TABLE entries ADD COLUMN deleted_at INTEGER');
  if(!db.prepare('PRAGMA table_info(entries)').all().some(column=>column.name==='category_id')) db.exec('ALTER TABLE entries ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL');
  if(!db.prepare('PRAGMA table_info(entries)').all().some(column=>column.name==='payment_method_id')) db.exec('ALTER TABLE entries ADD COLUMN payment_method_id INTEGER REFERENCES payment_methods(id) ON DELETE RESTRICT');
  if(!db.prepare('PRAGMA table_info(categories)').all().some(column=>column.name==='color')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec("ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#3f6b57'");
      const counters={income:0,expense:0};
      const setColor=db.prepare('UPDATE categories SET color=? WHERE id=?');
      for(const category of db.prepare('SELECT id,type FROM categories ORDER BY type,id').all())setColor.run(categoryPalette[counters[category.type]++%categoryPalette.length].value,category.id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  const listCategories=()=>db.prepare('SELECT c.id,c.type,c.name,c.color,COUNT(e.id) AS usageCount FROM categories c LEFT JOIN entries e ON e.category_id=c.id AND e.deleted_at IS NULL GROUP BY c.id ORDER BY c.type,c.name COLLATE NOCASE,c.id').all();
  const listPaymentMethods=()=>db.prepare('SELECT p.id,p.name,p.active,p.created_at AS createdAt,COUNT(e.id) AS usageCount FROM payment_methods p LEFT JOIN entries e ON e.payment_method_id=p.id GROUP BY p.id ORDER BY p.active DESC,p.name COLLATE NOCASE,p.id').all();
  function checkPayment(entry, existingId=null) {
    const id=entry.paymentMethodId;
    if(id===undefined||id===null)return null;
    if(entry.type!=='expense')throw invalid('결제수단은 지출에만 지정할 수 있어요.');
    if(!Number.isSafeInteger(id)||id<1)throw invalid('올바른 결제수단을 선택해 주세요.');
    const method=db.prepare('SELECT active FROM payment_methods WHERE id=?').get(id);
    if(!method||(!method.active&&id!==existingId))throw invalid('사용 가능한 결제수단을 선택해 주세요.');
    return id;
  }
  const listPersonalHolidays=month=>db.prepare('SELECT id,date,name FROM personal_holidays WHERE date>=? AND date<=? ORDER BY date').all(month+'-01',month+'-31');
  function checkCategory(entry) {
    if(entry.categoryId===undefined || entry.categoryId===null)return null;
    if(!Number.isSafeInteger(entry.categoryId)||entry.categoryId<1)throw invalid('올바른 카테고리를 선택해 주세요.');
    const category=db.prepare('SELECT type FROM categories WHERE id=?').get(entry.categoryId);
    if(!category||category.type!==entry.type)throw invalid('기록 종류에 맞는 카테고리를 선택해 주세요. 삭제된 카테고리는 미분류로 선택해 주세요.');
    return entry.categoryId;
  }
  function categoryName(data) {
    if(typeof data?.name!=='string'||!data.name.trim()||data.name.trim().length>30)throw invalid('카테고리 이름은 1~30자로 입력해 주세요.');
    const name=data.name.trim();
    if(name==='미분류')throw invalid('미분류는 기본 항목이에요. 다른 이름을 입력해 주세요.');
    return name;
  }
  const insert = db.prepare('INSERT INTO entries(request_id,type,amount,date,memo,created_at,category_id,payment_method_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING');
  const byRequest = db.prepare('SELECT type,amount,date,memo,deleted_at,category_id AS categoryId,payment_method_id AS paymentMethodId FROM entries WHERE request_id=?');
  const total = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM entries WHERE type=? AND date>=? AND date<=? AND deleted_at IS NULL AND id<>?');
  function save(entry, id) {
    const prior = byRequest.get(id);
    if(prior) {
      if(prior.deleted_at !== null) throw Object.assign(new Error('이미 삭제된 기록이에요. 새로운 기록으로 입력해 주세요.'),{status:409});
      if(['type','amount','date','memo'].some(key => prior[key] !== entry[key])) throw invalid('동일 요청의 내용이 달라요. 다시 입력해 주세요.');
      if(prior.categoryId!==(entry.categoryId??null))throw invalid('동일 요청의 카테고리가 달라요. 다시 입력해 주세요.');
      if(prior.paymentMethodId!==(entry.paymentMethodId??null))throw invalid('동일 요청의 결제수단이 달라요. 다시 입력해 주세요.');
      return false;
    }
    const month = entry.date.slice(0,7);
    if (!Number.isSafeInteger(total.get(entry.type,month+'-01',month+'-31',0).total + entry.amount)) throw invalid('월별 합계의 저장 한도를 초과했어요.');
    const categoryId=checkCategory(entry);
    const paymentMethodId=checkPayment(entry);
    insert.run(id,entry.type,entry.amount,entry.date,entry.memo,Date.now(),categoryId,paymentMethodId);
    return true;
  }
  const recurring = createRecurring(db,{validDate,invalid,checkCategory,checkPayment,save});
  const types = {'index.html':'text/html; charset=utf-8','app.js':'text/javascript; charset=utf-8','budget.js':'text/javascript; charset=utf-8','monthly.js':'text/javascript; charset=utf-8','month-picker.js':'text/javascript; charset=utf-8','holidays.js':'text/javascript; charset=utf-8','analysis.js':'text/javascript; charset=utf-8','recurring.js':'text/javascript; charset=utf-8','style.css':'text/css; charset=utf-8','workspace.css':'text/css; charset=utf-8'};
  const server = http.createServer(async (req,res) => {
    const json = (status, data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return json(403,{error:'로컬 주소로 접속해 주세요.'});
      if(req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403,{error:'허용되지 않은 요청입니다.'});
      const url = new URL(req.url,'http://'+req.headers.host);
      if(url.pathname.startsWith('/api/')) {
        if(req.method==='GET'&&url.pathname==='/api/recurring-rules')return json(200,{rules:recurring.rules()});
        const recurringRoute=/^\/api\/recurring-rules\/([1-9]\d*)$/.exec(url.pathname);
        const recurringId=recurringRoute?Number(recurringRoute[1]):null;
        if(recurringRoute&&!Number.isSafeInteger(recurringId))throw invalid('올바른 반복 지출 일정이 아니에요.');
        if(recurringRoute&&req.method==='GET')return json(200,{rule:recurring.readRule(recurringId)});
        if(recurringRoute&&req.method==='DELETE'){
          recurring.removeRule(recurringId);
          return json(200,{deleted:true});
        }
        const recurringCreating=url.pathname==='/api/recurring-rules'&&req.method==='POST';
        const recurringUpdating=!!recurringRoute&&req.method==='PUT';
        const recurringDayRoute=/^\/api\/recurring-rules\/([1-9]\d*)\/payment-day$/.exec(url.pathname);
        const recurringDayChanging=!!recurringDayRoute&&req.method==='PUT';
        const recurringSkipping=url.pathname==='/api/recurring-occurrences/skip'&&req.method==='POST';
        const recurringLink=url.pathname==='/api/recurring-occurrences/link'&&['POST','DELETE'].includes(req.method);
        if(req.method==='GET'&&url.pathname==='/api/recurring-occurrences/inbox'){
          const after=url.searchParams.get('after')||'';
          const afterId=Number(url.searchParams.get('afterId')||0);
          if((after&&!validDate(after))||!Number.isSafeInteger(afterId)||afterId<0)throw invalid('조회 위치를 확인해 주세요.');
          return json(200,recurring.inbox(after,afterId,url.searchParams.has('countOnly')?0:20));
        }
        if(req.method==='GET'&&url.pathname==='/api/recurring-occurrences/candidates'){
          const params=url.searchParams;
          const offset=Number(params.get('offset')||0);
          const query=(params.get('q')||'').trim();
          if(!Number.isSafeInteger(offset)||offset<0||query.length>80)throw invalid('검색 조건을 확인해 주세요.');
          return json(200,recurring.candidates({ruleId:Number(params.get('ruleId')),dueDate:params.get('dueDate')},
            params.get('start'),params.get('end'),query,offset));
        }
        if(req.method==='GET'&&url.pathname==='/api/budgets') {
          const month=url.searchParams.get('month');
          if(!validMonth(month))throw invalid('올바른 조회 월을 선택해 주세요.');
          return json(200,{budget:getBudget(month)});
        }
        const budgetRoute=/^\/api\/budgets\/([^/]+)$/.exec(url.pathname);
        const budgetMonth=budgetRoute?.[1];
        if(budgetRoute&&!validMonth(budgetMonth))throw invalid('올바른 예산 월을 선택해 주세요.');
        if(budgetRoute&&req.method==='DELETE') {
          db.prepare('DELETE FROM monthly_budgets WHERE month=?').run(budgetMonth);
          return json(200,{deleted:true});
        }
        const budgetUpdating=!!budgetRoute&&req.method==='PUT';
        if(req.method==='GET' && url.pathname==='/api/weekly-expenses') {
          const date=url.searchParams.get('date');
          if(!validDate(date))throw invalid('올바른 조회 날짜를 선택해 주세요.');
          const monday=new Date(date+'T00:00:00Z');
          monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
          const days=Array.from({length:7},(_,index)=>{
            const day=new Date(monday);day.setUTCDate(day.getUTCDate()+index);
            return {date:`${String(day.getUTCFullYear()).padStart(4,'0')}-${String(day.getUTCMonth()+1).padStart(2,'0')}-${String(day.getUTCDate()).padStart(2,'0')}`,amount:0};
          });
          const start=days[0].date<'1000-01-01'?'1000-01-01':days[0].date;
          const end=days[6].date.length!==10?'9999-12-31':days[6].date;
          const rows=db.prepare("SELECT date,SUM(amount) AS amount FROM entries WHERE type='expense' AND deleted_at IS NULL AND date>=? AND date<=? GROUP BY date").all(start,end);
          for(const day of days)day.amount=rows.find(row=>row.date===day.date)?.amount||0;
          // A week can span two monthly storage limits; sum exactly across months.
          const total=days.reduce((sum,day)=>sum+BigInt(day.amount),0n).toString();
          return json(200,{start:days[0].date,end:days[6].date,days,total});
        }
        if(req.method === 'GET' && url.pathname === '/api/entries') {
          const month = url.searchParams.get('month');
          if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || month.slice(0,4) < '1000') throw invalid('올바른 조회 월을 선택해 주세요.');
          const entries = db.prepare(`SELECT e.id,e.type,e.amount,e.date,e.memo,e.created_at AS createdAt,
            e.category_id AS categoryId,c.name AS categoryName,c.color AS categoryColor,e.payment_method_id AS paymentMethodId,
            p.name AS paymentMethodName,COALESCE(r.id,active_occurrence.id) AS recurringRuleId
            FROM entries e LEFT JOIN categories c ON c.id=e.category_id LEFT JOIN payment_methods p ON p.id=e.payment_method_id
            LEFT JOIN recurring_rules r ON r.source_entry_id=e.id AND r.deleted_at IS NULL
            LEFT JOIN recurring_occurrences o ON o.entry_id=e.id
            LEFT JOIN recurring_rules active_occurrence ON active_occurrence.id=o.rule_id AND active_occurrence.deleted_at IS NULL
            WHERE e.date>=? AND e.date<=? AND e.deleted_at IS NULL ORDER BY e.date DESC,e.id DESC`).all(month+'-01',month+'-31');
          const income = entries.filter(e=>e.type==='income'); const expense = entries.filter(e=>e.type==='expense');
          const incomeTotal = income.reduce((sum,e)=>sum+e.amount,0), expenseTotal=expense.reduce((sum,e)=>sum+e.amount,0);
          return json(200,{entries,budget:getBudget(month),paymentMethods:listPaymentMethods(),categories:listCategories(),palette:categoryPalette,personalHolidays:listPersonalHolidays(month),recurring:recurring.list(month),summary:{income:incomeTotal,expense:expenseTotal,balance:incomeTotal-expenseTotal,incomeCount:income.length,expenseCount:expense.length}});
        }
        if(req.method==='GET'&&url.pathname==='/api/personal-holidays') {
          const month=url.searchParams.get('month');
          if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||month<'1000-01')throw invalid('올바른 조회 월을 선택해 주세요.');
          return json(200,{personalHolidays:listPersonalHolidays(month)});
        }
        if(req.method==='GET'&&url.pathname==='/api/payment-methods')return json(200,{paymentMethods:listPaymentMethods()});
        const paymentRoute=/^\/api\/payment-methods\/([1-9]\d*)$/.exec(url.pathname);
        const paymentId=paymentRoute?Number(paymentRoute[1]):null;
        if(paymentRoute&&!Number.isSafeInteger(paymentId))throw invalid('올바른 결제수단 ID가 아니에요.');
        if(paymentRoute&&req.method==='DELETE') {
          if(db.prepare('SELECT id FROM entries WHERE payment_method_id=? LIMIT 1').get(paymentId))return json(409,{error:'사용 이력이 있는 결제수단은 삭제할 수 없어요. 사용 중지를 선택해 주세요.'});
          db.prepare('DELETE FROM payment_methods WHERE id=?').run(paymentId);
          return json(200,{deleted:true,paymentMethods:listPaymentMethods()});
        }
        const paymentCreating=req.method==='POST'&&url.pathname==='/api/payment-methods';
        const paymentUpdating=req.method==='PUT'&&!!paymentRoute;
        const personalRoute=/^\/api\/personal-holidays\/([1-9]\d*)$/.exec(url.pathname);
        const personalId=personalRoute?Number(personalRoute[1]):null;
        if(personalRoute&&!Number.isSafeInteger(personalId))throw invalid('올바른 개인 휴일 ID가 아니에요.');
        if(personalRoute&&req.method==='DELETE') {
          db.prepare('DELETE FROM personal_holidays WHERE id=?').run(personalId);
          return json(200,{deleted:true});
        }
        if(req.method==='GET' && url.pathname==='/api/categories')return json(200,{categories:listCategories(),palette:categoryPalette});
        const categoryRoute=/^\/api\/categories\/([1-9]\d*)$/.exec(url.pathname);
        const categoryId=categoryRoute?Number(categoryRoute[1]):null;
        if(categoryRoute&&!Number.isSafeInteger(categoryId))throw invalid('올바른 카테고리 ID가 아니에요.');
        if(categoryRoute&&req.method==='DELETE') {
          // The foreign key moves all associated entries to uncategorized atomically.
          db.prepare('DELETE FROM categories WHERE id=?').run(categoryId);
          return json(200,{deleted:true});
        }
        const recordRoute=/^\/api\/entries\/([1-9]\d*)$/.exec(url.pathname);
        const recordId=recordRoute?Number(recordRoute[1]):null;
        if(recordRoute && !Number.isSafeInteger(recordId)) throw invalid('올바른 기록 ID가 아니에요.');
        if(recordRoute && req.method==='DELETE') {
          const result=db.prepare('UPDATE entries SET deleted_at=COALESCE(deleted_at,?) WHERE id=?').run(Date.now(),recordId);
          if(!result.changes)return json(404,{error:'기록을 찾을 수 없어요. 새로 불러온 뒤 확인해 주세요.'});
          return json(200,{deleted:true});
        }
        const updating=recordRoute && req.method==='PUT';
        const categoryUpdating=categoryRoute&&req.method==='PUT';
        const categoryCreating=url.pathname==='/api/categories'&&req.method==='POST';
        const personalUpdating=personalRoute&&req.method==='PUT';
        const personalCreating=url.pathname==='/api/personal-holidays'&&req.method==='POST';
        if(!budgetUpdating && !paymentCreating && !paymentUpdating && !updating && !categoryUpdating && !categoryCreating && !personalUpdating && !personalCreating && !recurringCreating && !recurringUpdating && !recurringDayChanging && !recurringSkipping && !recurringLink && (req.method !== 'POST' || url.pathname!=='/api/entries')) return json(404,{error:'요청을 찾을 수 없어요.'});
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(415,{error:'JSON 형식으로 요청해 주세요.'});
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>2_000_000) throw Object.assign(new Error('요청이 너무 커요.'),{status:413});chunks.push(chunk);}
        let data; try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw invalid('올바른 JSON 형식이 아니에요.');}
        if(recurringCreating||recurringUpdating||recurringDayChanging||recurringSkipping||recurringLink) {
          db.exec('BEGIN IMMEDIATE');
          let result;
          try {
            if(recurringSkipping){
              recurring.process(data,null);
              result={skipped:true};
            }else if(recurringLink){
              recurring.link(data,req.method==='DELETE');
              result={ok:true};
            }else if(recurringDayChanging){
              const ruleId=Number(recurringDayRoute[1]);
              if(!Number.isSafeInteger(ruleId))throw invalid('올바른 반복 지출 일정이 아니에요.');
              result={rule:recurring.changeDay(ruleId,data)};
            }else result=recurring.writeRule(data,recurringUpdating?recurringId:null);
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          return json(recurringCreating&&result.created?201:200,result);
        }
        if(budgetUpdating) {
          const validAmount=value=>Number.isSafeInteger(value)&&value>=0&&value<=999999999999;
          if(!validAmount(data?.amount)||!Array.isArray(data?.categories)||data.categories.length>10000)throw invalid('예산은 0~999,999,999,999원의 정수로 입력해 주세요.');
          const seen=new Set();let allocated=0n;
          db.exec('BEGIN IMMEDIATE');
          try {
            for(const row of data.categories) {
              if(!Number.isSafeInteger(row?.categoryId)||row.categoryId<1||seen.has(row.categoryId)||!validAmount(row.amount))throw invalid('카테고리별 예산이 올바르지 않거나 중복되어 있어요.');
              if(db.prepare('SELECT type FROM categories WHERE id=?').get(row.categoryId)?.type!=='expense')throw invalid('현재 등록된 지출 카테고리만 예산을 설정할 수 있어요.');
              seen.add(row.categoryId);allocated+=BigInt(row.amount);
            }
            if(allocated>BigInt(data.amount))throw invalid('카테고리 배정 합계가 월 전체 예산을 초과했어요.');
            db.prepare('INSERT INTO monthly_budgets(month,amount) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET amount=excluded.amount').run(budgetMonth,data.amount);
            db.prepare('DELETE FROM category_budgets WHERE month=?').run(budgetMonth);
            const insertBudget=db.prepare('INSERT INTO category_budgets(month,category_id,amount) VALUES(?,?,?)');
            for(const row of data.categories)insertBudget.run(budgetMonth,row.categoryId,row.amount);
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          return json(200,{budget:getBudget(budgetMonth)});
        }
        if(paymentCreating||paymentUpdating) {
          const current=paymentUpdating?db.prepare('SELECT name,active FROM payment_methods WHERE id=?').get(paymentId):null;
          if(paymentUpdating&&!current)return json(404,{error:'결제수단을 찾을 수 없어요. 다시 불러와 주세요.'});
          const name=data?.name===undefined&&current?current.name:data?.name;
          if(typeof name!=='string'||!name.trim()||name.trim().length>30||name.trim()==='미지정')throw invalid('결제수단 이름은 미지정을 제외한 1~30자로 입력해 주세요.');
          if(data.active!==undefined&&typeof data.active!=='boolean')throw invalid('결제수단 사용 여부가 올바르지 않아요.');
          const active=data.active===undefined?(current?.active??1):Number(data.active);
          try {
            if(paymentUpdating)db.prepare('UPDATE payment_methods SET name=?,active=? WHERE id=?').run(name.trim(),active,paymentId);
            else db.prepare('INSERT INTO payment_methods(name,active,created_at) VALUES(?,?,?)').run(name.trim(),active,Date.now());
          }catch(error){if(error.message.includes('UNIQUE constraint failed'))return json(409,{error:'같은 이름의 결제수단이 있어요.'});throw error;}
          return json(paymentCreating?201:200,{paymentMethods:listPaymentMethods()});
        }
        if(personalCreating||personalUpdating) {
          if(!validDate(data?.date))throw invalid('올바른 개인 휴일 날짜를 선택해 주세요.');
          if(typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>30)throw invalid('개인 휴일 이름은 1~30자로 입력해 주세요.');
          if(personalUpdating&&!db.prepare('SELECT id FROM personal_holidays WHERE id=?').get(personalId))return json(404,{error:'개인 휴일을 찾을 수 없어요. 다시 불러와 주세요.'});
          try {
            if(personalUpdating)db.prepare('UPDATE personal_holidays SET date=?,name=? WHERE id=?').run(data.date,data.name.trim(),personalId);
            else db.prepare('INSERT INTO personal_holidays(date,name,created_at) VALUES(?,?,?)').run(data.date,data.name.trim(),Date.now());
          }catch(error) {
            if(error.message.includes('UNIQUE constraint failed'))return json(409,{error:'해당 날짜에는 이미 개인 휴일이 있어요. 날짜를 선택해 기존 휴일을 수정해 주세요.'});
            throw error;
          }
          return json(personalCreating?201:200,{saved:true});
        }
        if(categoryCreating||categoryUpdating) {
          const name=categoryName(data);
          const current=categoryUpdating?db.prepare('SELECT type,color FROM categories WHERE id=?').get(categoryId):null;
          if(categoryUpdating&&!current)return json(404,{error:'카테고리를 찾을 수 없어요. 다시 불러와 주세요.'});
          const type=categoryUpdating?current.type:data.type;
          if(!['income','expense'].includes(type))throw invalid('수입 또는 지출을 선택해 주세요.');
          if(categoryUpdating&&data.type!==undefined&&data.type!==type)throw invalid('카테고리의 수입·지출 구분은 변경할 수 없어요.');
          const usedColors=new Set(db.prepare('SELECT color FROM categories WHERE type=?').all(type).map(row=>row.color));
          const defaultColor=current?.color||(categoryPalette.find(item=>!usedColors.has(item.value))||categoryPalette[0]).value;
          const color=data.color===undefined?defaultColor:data.color;
          if(!validColor(color))throw invalid('색상은 # 뒤에 6자리 16진수로 입력해 주세요. 예: #3f6b57');
          try {
            if(categoryUpdating)db.prepare('UPDATE categories SET name=?,color=? WHERE id=?').run(name,color.toLowerCase(),categoryId);
            else db.prepare('INSERT INTO categories(type,name,color) VALUES(?,?,?)').run(type,name,color.toLowerCase());
          }catch(error) {
            if(error.message.includes('UNIQUE constraint failed'))return json(409,{error:'같은 종류에 동일한 이름의 카테고리가 있어요.'});
            throw error;
          }
          return json(categoryCreating?201:200,{categories:listCategories(),palette:categoryPalette});
        }
        if(updating) {
          validate(data);
          db.exec('BEGIN IMMEDIATE');
          try {
            const existing=db.prepare('SELECT id,payment_method_id AS paymentMethodId FROM entries WHERE id=? AND deleted_at IS NULL').get(recordId);
            if(!existing)throw Object.assign(new Error('기록을 찾을 수 없어요. 이미 삭제되었을 수 있어요.'),{status:404});
            const month=data.date.slice(0,7);
            const categoryId=checkCategory(data);
            const paymentMethodId=checkPayment(data,existing.paymentMethodId);
            if(!Number.isSafeInteger(total.get(data.type,month+'-01',month+'-31',recordId).total+data.amount))throw invalid('월별 합계의 저장 한도를 초과했어요.');
            db.prepare('UPDATE entries SET type=?,amount=?,date=?,memo=?,category_id=?,payment_method_id=? WHERE id=? AND deleted_at IS NULL').run(data.type,data.amount,data.date,data.memo,categoryId,paymentMethodId,recordId);
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          return json(200,{saved:true});
        }
        if(url.pathname === '/api/entries') {
          validate(data);
          if(typeof data.requestId !== 'string' || !/^[\w-]{16,100}$/.test(data.requestId)) throw invalid('기록 요청 ID가 올바르지 않아요.');
          let added;
          db.exec('BEGIN IMMEDIATE');
          try {
            added = data.recurring===undefined ? save(data,'new:'+data.requestId) : recurring.process(data.recurring,data,data.requestId);
            db.exec('COMMIT');
          }
          catch(error) { db.exec('ROLLBACK'); throw error; }
          return json(added?201:200,{saved:true});
        }
        return json(404,{error:'요청을 찾을 수 없어요.'});
      }
      if(req.method !== 'GET') return json(405,{error:'지원하지 않는 요청입니다.'});
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!Object.hasOwn(types,name)) return json(404,{error:'페이지를 찾을 수 없어요.'});
      const data=await readFile(new URL(`./dist/${name}`,import.meta.url));
      res.writeHead(200,{'Content-Type':types[name],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
    } catch(error) {
      if(!error.status) console.error('Request failed:',error.message);
      if(!res.headersSent) json(error.status || 500,{error:error.status?error.message:'DB 요청에 실패했어요. 서버 상태를 확인한 뒤 다시 시도해 주세요.'});
      else res.end();
    }
  });
  server.on('close',()=>db.close());
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=await createApp();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'4173 포트가 사용 중입니다. 기존 가계부 서버를 종료해 주세요.':error.message);process.exitCode=1;server.close();});
  server.listen(4173,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:4173\nSQLite: ${defaultPath}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
}
