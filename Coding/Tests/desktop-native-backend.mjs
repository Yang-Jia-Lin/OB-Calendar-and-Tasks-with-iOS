import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('../Agents/Tests/Desktop'),profile=JSON.parse(await fs.readFile(path.join(out,'native-test-profile.json'),'utf8'));
assert.ok(path.resolve(profile.root).startsWith(path.resolve('../Agents/Tests')+path.sep),'Isolated test root required');
const connection=JSON.parse(await fs.readFile(path.join(profile.root,'connection.json'),'utf8'));
const response=await fetch(`http://127.0.0.1:${connection.port}/v1/auth`,{method:'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:'{}'});
assert.equal(response.status,400,'Unconfigured isolated Python runtime must not authenticate');
console.log('Packaged Python warmed with a local missing-account error; no credentials or real account used.');
