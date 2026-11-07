import test from "node:test";
import assert from "node:assert/strict";
import {applySidebar} from "../Clients/Obsidian/sidebar";
function harness(){const views=new Set(["file-properties"]),opened:string[]=[],closed:string[]=[];return{views,opened,closed,workspace:{getLeavesOfType:(type:string)=>views.has(type)?[{}]:[],detachLeavesOfType:(type:string)=>{closed.push(type);views.delete(type);},ensureSideLeaf:async(type:string)=>{opened.push(type);views.add(type);}}};}
test("startup closes only backlinks and all-properties, preserving current-note properties",()=>{const h=harness();h.views.add("backlink");h.views.add("all-properties");applySidebar(h.workspace,true);assert.deepEqual(h.closed,["backlink","all-properties"]);assert.deepEqual([...h.views],["file-properties"]);});
test("disabling startup cleanup preserves manually opened side panes",()=>{const h=harness();h.views.add("backlink");applySidebar(h.workspace,false);assert.deepEqual(h.closed,[]);assert.ok(h.views.has("backlink"));});
