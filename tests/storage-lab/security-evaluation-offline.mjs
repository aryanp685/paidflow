// Step 2F: offline, synthetic inspection/control probes only. No service or scanner is started.
// Set PAIDFLOW_ENCRYPTED_PDF_FIXTURE to a separately obtained synthetic encrypted PDF.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { createStorageLab, inspect, MAX_BYTES } from '../../storage-lab/core.mjs';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
const png = await sharp({create:{width:4,height:4,channels:3,background:'#aabbcc'}}).png().toBuffer();
const doc = await PDFDocument.create(); doc.addPage();
const pdf = Buffer.from(await doc.save());
await test('ordinary synthetic PDF passes structural inspection only', async()=>assert.equal(await inspect(pdf,'application/pdf'),'application/pdf'));
await test('ordinary synthetic PNG passes structural inspection only', async()=>assert.equal(await inspect(png,'image/png'),'image/png'));
await test('oversized input fails inspection', async()=>assert.rejects(()=>inspect(Buffer.alloc(MAX_BYTES+1),'image/png'),/INVALID_SIZE/));
await test('MIME spoof and malformed PDF fail inspection', async()=>{
  await assert.rejects(()=>inspect(png,'application/pdf'),/INVALID_TYPE/);
  await assert.rejects(()=>inspect(Buffer.from('%PDF-1.7\nfake\n%%EOF'),'application/pdf'),/INVALID_CONTENT/);
});
await test('PDF with synthetic JavaScript action fails inspection', async()=>{
  const sample=await PDFDocument.create(); sample.addPage();
  sample.catalog.set(PDFName.of('OpenAction'),sample.context.obj({S:PDFName.of('JavaScript'),JS:PDFString.of('app.alert("synthetic")')}));
  const bytes=Buffer.from(await sample.save());
  await assert.rejects(()=>inspect(bytes,'application/pdf'),/INVALID_CONTENT/);
});
await test('upstream encrypted synthetic PDF is refused by parser and inspection', async()=>{
  const path=process.env.PAIDFLOW_ENCRYPTED_PDF_FIXTURE;
  if(!path) throw Error('PAIDFLOW_ENCRYPTED_PDF_FIXTURE is required');
  const bytes=await readFile(path);
  await assert.rejects(()=>PDFDocument.load(bytes,{updateMetadata:false}),/encrypted/i);
  await assert.rejects(()=>inspect(bytes,'application/pdf'),/INVALID_CONTENT/);
});
await test('EICAR marker appended to PNG passes structural inspection: scanner gap', async()=>{
  // EICAR is an inert antivirus test pattern, not malware and not an actual scanner test.
  const marker=Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}','EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('$'));
  const sample=Buffer.concat([png,marker]);
  assert.equal(await inspect(sample,'image/png'),'image/png');
});
await test('anonymous upload and download are audited and reject before object storage', async()=>{
  let touched=false;const events=[];
  const store=new Proxy({}, {get(){touched=true;throw Error('unexpected object storage access');}});
  const runtimePool={query:async(sql,args)=>{assert.match(sql,/storage_record_anonymous_denial/);events.push(args);}};
  const auth={api:{getSession:async()=>null}};
  const storage=createStorageLab({auth,runtimePool,store,secret:'x'.repeat(32)});
  await assert.rejects(()=>storage.upload({headers:new Headers(),businessId:randomUUID(),area:'evidence',name:'sample.png',declared:'image/png',requestId:randomUUID(),bytes:png}),/UNAUTHENTICATED/);
  await assert.rejects(()=>storage.download({headers:new Headers(),id:randomUUID(),grant:'not-a-grant'}),/UNAUTHENTICATED/);
  assert.equal(touched,false);assert.deepEqual(events,[['upload','unauthenticated'],['download','unauthenticated']]);
});
console.log(`${passed} offline probes passed${process.exitCode ? '; failures above' : ''}. Structural inspection is not malware scanning.`);
