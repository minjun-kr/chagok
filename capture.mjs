import {chromium} from 'playwright';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createApp} from './server.mjs';

// Use a separate browser context and local port; the user's Chrome stays untouched.
const root=fileURLToPath(new URL('./',import.meta.url));
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=join(root,'artifacts','screenshots',timestamp);
const channel=process.env.CAPTURE_BROWSER_CHANNEL||'chrome';
const files=[],errors=[];
let server,browser;
await mkdir(output,{recursive:true});
const databaseDir=await mkdtemp(join(tmpdir(),'chagok-capture-'));
try {
  server=await createApp({dbPath:join(databaseDir,'demo.sqlite')});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url=`http://127.0.0.1:${server.address().port}`;
  for(const [date,type,amount,memo] of [
    ['2026-11-05','income',3200000,'월급'],
    ['2026-11-10','expense',14900,'영상 구독료'],
    ['2026-11-20','expense',145000,'아파트 관리비'],
  ]) {
    const response=await fetch(`${url}/api/entries`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({date,type,amount,memo,requestId:randomUUID()}),
    });
    if(!response.ok)throw new Error(`예시 거래를 생성하지 못했습니다 (${response.status}).`);
  }
  try {browser=await chromium.launch({channel,headless:true});}
  catch(error){throw new Error(`캡처용 브라우저(${channel})를 시작하지 못했습니다. Chrome 설치를 확인하거나 CAPTURE_BROWSER_CHANNEL=msedge로 실행하세요. ${error.message}`);}
  async function open(viewport,mobile=false) {
    const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul',isMobile:mobile,hasTouch:mobile});
    // Capturing may only read financial data, never add/edit/delete it.
    await context.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.abort('blockedbyclient'));
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-23T12:00:00+09:00'));
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.getElementById('save-state')?.textContent==='로컬 DB에 저장');
    await page.evaluate(()=>document.fonts.ready);
    return {page,context};
  }
  async function capture(page,name,viewport) {
    await page.screenshot({path:join(output,name),fullPage:true,animations:'disabled'});
    files.push({file:name,viewport});console.log(`Captured: ${name}`);
  }
  const desktopViewport={width:1440,height:1000};
  const desktop=await open(desktopViewport);
  await capture(desktop.page,'01-desktop-calendar.png',desktopViewport);
  await desktop.page.locator('#month-toggle').click();
  await desktop.page.locator('#month-popover').waitFor({state:'visible'});
  await capture(desktop.page,'02-desktop-month-picker.png',desktopViewport);
  await desktop.page.keyboard.press('Escape');
  await desktop.page.locator('#view-monthly').click();
  await desktop.page.locator('#monthly-view').waitFor({state:'visible'});
  await capture(desktop.page,'03-desktop-monthly-list.png',desktopViewport);
  await desktop.context.close();
  const mobileViewport={width:390,height:844};
  const mobile=await open(mobileViewport,true);
  await capture(mobile.page,'04-mobile-calendar.png',mobileViewport);
  await mobile.page.locator('#month-toggle').click();
  await mobile.page.locator('#month-popover').waitFor({state:'visible'});
  await capture(mobile.page,'05-mobile-month-picker.png',mobileViewport);
  await mobile.context.close();
  await writeFile(join(output,'manifest.json'),JSON.stringify({capturedAt:new Date().toISOString(),browser:channel,files,errors},null,2)+'\n');
  if(errors.length)throw new Error(`캡처 중 클라이언트 오류 ${errors.length}건이 발생했습니다. manifest.json을 확인하세요.`);
  console.log(`Screenshots: ${output}`);
}finally{
  try {
    await browser?.close();
  }finally{
    try {
      if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }finally{
      await rm(databaseDir,{recursive:true,force:true});
    }
  }
}
