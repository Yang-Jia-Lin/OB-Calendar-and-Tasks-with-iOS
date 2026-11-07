import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const coding=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resources=path.resolve(coding,'../Agents/Tests/Desktop/resources');
const out=path.join(resources,'ThirdParty');await fs.mkdir(out,{recursive:true});
const sdk=path.resolve(coding,'../Results/Probes/IcloudReminders/upstream/pyicloud-af5246511c729eee4d5a95671135ad75fdd77b22');
await fs.copyFile(path.join(sdk,'LICENSE'),path.join(out,'pyicloud-LICENSE'));
const nodeLicense=await fetch('https://raw.githubusercontent.com/nodejs/node/v24.14.0/LICENSE');
if(!nodeLicense.ok)throw new Error('Node license download failed');await fs.writeFile(path.join(out,'node-v24.14.0-LICENSE'),await nodeLicense.text());
const registry=path.resolve(coding,'../Agents/Tests/toolchains/cargo/registry/src');
const roots=await fs.readdir(registry);let count=0;
for(const root of roots)for(const crate of await fs.readdir(path.join(registry,root))){
  const source=path.join(registry,root,crate);const files=await fs.readdir(source,{withFileTypes:true});
  for(const file of files){if(!file.isFile()||!(/^(licen[sc]e|copying|copyright|notice)([._-]|$)/i.test(file.name)))continue;
    const destination=path.join(out,'Rust',crate);await fs.mkdir(destination,{recursive:true});await fs.copyFile(path.join(source,file.name),path.join(destination,file.name));count++;
  }
}
await fs.copyFile(path.join(coding,'Clients/Desktop/native/Cargo.lock'),path.join(out,'Cargo.lock'));
console.log(`Desktop licenses collected: Node, Python SDK, and ${count} Rust license/notice files. Python dependency licenses remain in their dist-info folders.`);
