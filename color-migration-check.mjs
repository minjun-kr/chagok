import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from './server.mjs';
const prefix=join(tmpdir(),'chagok-color-');
const dir=await mkdtemp(prefix),dbPath=join(dir,'old.sqlite');
let server;
try {
  const old=new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE categories(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(type,name));
    INSERT INTO categories(type,name) VALUES('expense','식비'),('expense','교통'),('income','급여');
    CREATE TABLE entries(id INTEGER PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,type TEXT NOT NULL,amount INTEGER NOT NULL,date TEXT NOT NULL,memo TEXT NOT NULL,created_at INTEGER NOT NULL,deleted_at INTEGER,category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL);
    INSERT INTO entries VALUES(1,'old-record','expense',12000,'2026-11-10','기존 기록',1234,NULL,1);`);
  const original=JSON.stringify(old.prepare('SELECT * FROM entries').all());old.close();
  async function start(){server=await createApp({dbPath});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
  async function stop(){await new Promise(resolve=>server.close(resolve));}
  let base=await start();
  let data=await (await fetch(base+'/api/categories')).json();
  assert.equal(data.categories.length,3);
  assert.equal(data.categories.find(c=>c.id===1).color,data.palette[0].value);
  assert.equal(data.categories.find(c=>c.id===2).color,data.palette[1].value);
  assert.equal(data.categories.find(c=>c.id===3).color,data.palette[0].value);
  const current=new DatabaseSync(dbPath,{readOnly:true});assert.equal(JSON.stringify(current.prepare('SELECT id,request_id,type,amount,date,memo,created_at,deleted_at,category_id FROM entries').all()),original);current.close();
  const record=await (await fetch(base+'/api/entries?month=2026-11')).json();assert.equal(record.entries[0].categoryColor,data.palette[0].value);
  assert.equal((await fetch(base+'/api/categories/1',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'식비',color:'#123456'})})).status,200);
  await stop();base=await start();data=await (await fetch(base+'/api/categories')).json();
  assert.equal(data.categories.find(c=>c.id===1).color,'#123456');
  console.log('PASS: old category colors initialized from muted palette, existing transactions preserved, custom colors survive restart without reinitialization');
}finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));if(!dir.startsWith(prefix))throw Error('Unexpected test path');await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
