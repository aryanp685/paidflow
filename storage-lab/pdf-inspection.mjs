import {PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRef, PDFInvalidObject} from 'pdf-lib';

// Conservative inspection, NOT a malware scanner or sanitizer. Review every
// parsed indirect object (including objects in compressed object streams), not
// just reachable catalog references. Names are decoded to handle #xx escapes.
const forbiddenKeys=new Set(['OpenAction','AA','JS','JavaScript','EmbeddedFiles','EmbeddedFile','EF','RichMedia','RichMediaContent','RichMediaSettings','XFA']);
const forbiddenNames=new Set(['JavaScript','EmbeddedFile','Filespec','Launch','SubmitForm','ImportData','GoToE','GoToR','RichMedia','3D','Movie','Sound']);
export async function inspectPdf(bytes){
  if(!bytes.subarray(Math.max(0,bytes.length-2048)).includes(Buffer.from('%%EOF')))throw Error('INVALID_CONTENT');
  const doc=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false,throwOnInvalidObject:true});
  if(doc.getPageCount()<1||doc.getPageCount()>500)throw Error('INVALID_CONTENT');
  const all=doc.context.enumerateIndirectObjects();if(all.length>50000)throw Error('INVALID_CONTENT');
  const seen=new Set();let visited=0;
  function visit(value,depth){
    if(depth>100||++visited>200000)throw Error('INVALID_CONTENT');
    if(value instanceof PDFRef){const resolved=doc.context.lookup(value);if(!resolved)throw Error('INVALID_CONTENT');return visit(resolved,depth+1);}
    if(!value||seen.has(value))return;seen.add(value);
    if(value instanceof PDFInvalidObject)throw Error('INVALID_CONTENT');
    if(value instanceof PDFName){if(forbiddenNames.has(value.decodeText()))throw Error('INVALID_CONTENT');return;}
    if(value instanceof PDFStream)return visit(value.dict,depth+1);
    if(value instanceof PDFArray){for(const item of value.asArray())visit(item,depth+1);return;}
    if(value instanceof PDFDict){for(const [key,item] of value.entries()){if(forbiddenKeys.has(key.decodeText()))throw Error('INVALID_CONTENT');visit(item,depth+1);}}
  }
  for(const [,object] of all)visit(object,0);
}
