import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acquireWriterLease } from "../Clients/Desktop/ownership";
test("only one local host can hold a writer lease, and release permits the next owner",async()=>{
  const scope="test-"+randomUUID(),first=await acquireWriterLease(scope);
  try{await assert.rejects(acquireWriterLease(scope),/已有计时/);}finally{await first.release();}
  const next=await acquireWriterLease(scope);await next.release();await next.release();
});
