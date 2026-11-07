import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const resources=path.resolve('../Agents/Tests/Desktop/resources');
const node=path.join(resources,'runtime/node.exe');
const options=JSON.parse(await fs.readFile('Clients/Desktop/native/node-options.json','utf8'));
const root=await fs.mkdtemp(path.resolve('../Agents/Tests/desktop-path-'));
try{
  const folder=path.join(root,'自定义安装目录 with spaces');await fs.mkdir(folder);
  const entry=path.join(folder,'probe.cjs');await fs.writeFile(entry,'console.log(JSON.stringify({entry:__filename,arg:process.argv[2]}));');
  const extended=path.toNamespacedPath(entry);
  const baseline=spawnSync(node,[extended,'参数 with spaces'],{cwd:folder,encoding:'utf8',windowsHide:true});
  assert.notEqual(baseline.status,0,'Pinned Node 24.14.0 must reproduce the reported extended-path loader failure');
  assert.match(baseline.stderr,/EISDIR.*lstat/s);
  for(const file of [entry,extended]){
    const result=spawnSync(node,[...options,file,'参数 with spaces'],{cwd:folder,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).arg,'参数 with spaces');
  }
  console.log('3 Windows entry-path scenarios passed: original failure reproduced; normal and extended Unicode/space paths start with the native launch options.');
}finally{await fs.rm(root,{recursive:true,force:true});}
