import test from "node:test";
import assert from "node:assert/strict";
import {taskDisplayDate,taskOverdue} from "../Shared/taskDates";
import type {Task} from "../Shared/contracts";
const task:Task={id:"one",title:"task",kind:"reminder",completed:false,due:"2026-11-01",scheduledDate:"2026-11-02"};
test("overdue tasks display today without changing either stored date",()=>{const before=JSON.stringify(task);assert.equal(taskDisplayDate(task,"2026-11-08"),"2026-11-08");assert.equal(taskOverdue(task,"2026-11-08"),true);assert.equal(JSON.stringify(task),before);});
test("today includes today's due date, while completed tasks never roll forward",()=>{assert.equal(taskDisplayDate({...task,due:"2026-11-08",scheduledDate:null},"2026-11-08"),"2026-11-08");assert.equal(taskDisplayDate({...task,completed:true},"2026-11-08"),null);assert.equal(taskOverdue({...task,completed:true},"2026-11-08"),false);});
test("missed plans roll forward, and future plans keep their chosen date",()=>{assert.equal(taskDisplayDate({...task,due:"2026-12-31"},"2026-11-08"),"2026-11-08");assert.equal(taskDisplayDate({...task,due:"2026-12-31",scheduledDate:"2026-11-12"},"2026-11-08"),"2026-11-12");});
