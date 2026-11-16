// Narrow regression for the scoped eslint parser override, NOT a proof of all
// minimatch APIs or upstream compatibility. No external input or network.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const req=createRequire(import.meta.url);
const parserPath=req.resolve('@typescript-eslint/typescript-estree');
const parserRequire=createRequire(parserPath);
const {minimatch}=parserRequire('minimatch');
assert.equal(parserRequire('minimatch/package.json').version,'11.0.5');
const samples=[
  ['file.ts','*.ts',true],['.hidden.ts','*.ts',true],['file.js','*.ts',false],
  ['src/file.ts','src/*.ts',true],['src/.hidden.ts','src/*.ts',true],['src/nested/file.ts','src/*.ts',false],
  ['src/a.test.ts','src/*.test.{ts,tsx}',true],['src/a.test.tsx','src/*.test.{ts,tsx}',true],
  ['src/abc.ts','src/!(test).ts',true],['a.ts','!*.js',true],['alpha.txt','a?pha.*',true],
  ['src/a.ts','src/[ab].ts',true],['x/y/a.ts','*/y/*.ts',true],
];
for(const [file,pattern,expected] of samples)assert.equal(minimatch(file,pattern,{dot:true}),expected,`${file} ${pattern}`);
const {parseAndGenerateServices}=req('@typescript-eslint/typescript-estree');
const dir=await mkdtemp(path.join(os.tmpdir(),'paidflow-parser-compat-'));
try {
  for(const name of ['fixture.ts','.hidden.ts','outside.js'])await writeFile(path.join(dir,name),'const value = 42;');
  const options=filePath=>({filePath,tsconfigRootDir:dir,projectService:{allowDefaultProject:['*.ts']}});
  for(const name of ['fixture.ts','.hidden.ts']){
    const result=parseAndGenerateServices('const value = 42;',options(path.join(dir,name)));
    assert.equal(result.ast.type,'Program');assert.ok(result.services.program);
  }
  assert.throws(()=>parseAndGenerateServices('const value = 42;',options(path.join(dir,'outside.js'))),/project service|not found/i);
}finally{await rm(dir,{recursive:true,force:true});}
console.log(`PASS scoped minimatch 11.0.5: ${samples.length} glob cases and typed parser allow/default denial`);
