import { XMLParser } from "fast-xml-parser";
import { resourceUrl, validUrl } from "./config";
export interface HttpRequest { url:string; method:string; headers:Record<string,string>; body?:string }
export interface HttpResponse { status:number; text:string; headers:Record<string,string> }
export type CalendarTransport=(request:HttpRequest)=>Promise<HttpResponse>;
const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:true});
export const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
const many=(x:any):any[]=>x==null?[]:Array.isArray(x)?x:[x];
export function davResponses(text:string) {
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error("日历返回了不支持的 XML 实体。");
 const data=parser.parse(text);if(!data.multistatus)throw new Error("日历响应不是有效的 DAV 数据。");
 return many(data.multistatus.response).map(r=>({href:String(r.href||""),status:String(r.status||""),props:Object.assign({},...many(r.propstat).filter(p=>/\s200(?:\s|$)/.test(String(p.status))).map(p=>p.prop||{}))}));
}
export function discoveryUrl(href:string,base:string){const u=new URL(validUrl(new URL(href,base).href)),b=new URL(base);if(u.origin===b.origin)return u.href;if(u.protocol==="https:"&&b.protocol==="https:"&&[u,b].every(x=>x.hostname==="icloud.com"||x.hostname.endsWith(".icloud.com")))return u.href;throw new Error("日历发现返回了未经信任的服务器。");}
export class DavClient {
 constructor(private transport:CalendarTransport,private credentials:(key:string)=>Promise<string|null>|string|null){}
 async request(source:{url:string;username:string;secretKey:string},method:string,url=source.url,body?:string,headers:Record<string,string>={}) {
  const password=await this.credentials(source.secretKey);if(!password)throw new Error("日历授权密码缺失，请在插件设置中重新保存连接。");
  const r=await this.transport({url:resourceUrl(url,source.url),method,body,headers:{Authorization:`Basic ${Buffer.from(`${source.username}:${password}`).toString("base64")}`,...(body?{"Content-Type":"application/xml; charset=utf-8"}:{}),...headers}});
  if(r.status<200||r.status>=300){const e=new Error(`HTTP ${r.status}：${r.status===412?"日程已在外部修改，请同步后核对":r.status===401||r.status===403?"日历授权失效或无写入权限":"日历请求失败"}`);Object.assign(e,{status:r.status});throw e;}return r;
 }
 async index(source:{url:string;username:string;secretKey:string}) {
  const r=await this.request(source,"PROPFIND",source.url,'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>',{Depth:"1"});
  const rows=davResponses(r.text),seen=new Set<string>();return rows.flatMap(x=>{const href=resourceUrl(x.href,source.url);if(Object.hasOwn(x.props.resourcetype||{},"collection")||new URL(href).pathname.replace(/\/$/,"")===new URL(source.url).pathname.replace(/\/$/,""))return [];if(!x.props.getetag||seen.has(href))throw new Error("日历索引不完整或重复，保留旧快照。");seen.add(href);return [{href,etag:String(x.props.getetag)}];});
 }
 async objects(source:{url:string;username:string;secretKey:string},hrefs:string[]) {
  if(!hrefs.length)return [];const body='<?xml version="1.0"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>'+hrefs.map(h=>`<d:href>${xml(new URL(h).pathname)}</d:href>`).join("")+'</c:calendar-multiget>';
  const r=await this.request(source,"REPORT",source.url,body,{Depth:"1"});return davResponses(r.text).map(x=>{if(!x.props["calendar-data"]||!x.props.getetag)throw new Error("日历部分资源尚未就绪，请重试同步。");return {href:resourceUrl(x.href,source.url),etag:String(x.props.getetag),data:String(x.props["calendar-data"])};});
 }
 async discover(url:string,username:string,secretKey:string) {
  url=validUrl(url);let source={url,username,secretKey};
  const props='<d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/>';
  const query='<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>'+props+'</d:prop></d:propfind>';
  let result=davResponses((await this.request(source,"PROPFIND",url,query,{Depth:"0"})).text),p=result[0]?.props;
  const href=(x:any)=>typeof x?.href==="string"?x.href:null;
  let home=href(p?.["calendar-home-set"]);
  if(!home&&href(p?.["current-user-principal"])){const principal=discoveryUrl(href(p["current-user-principal"])!,url);source={...source,url:principal};p=davResponses((await this.request(source,"PROPFIND",principal,query,{Depth:"0"})).text)[0]?.props;home=href(p?.["calendar-home-set"]);}
  const target=home?discoveryUrl(home,source.url):source.url;source={...source,url:target};result=davResponses((await this.request(source,"PROPFIND",target,query,{Depth:"1"})).text);
  return result.filter(x=>x.props.resourcetype&&Object.hasOwn(x.props.resourcetype,"calendar")).map(x=>({url:resourceUrl(x.href,target),name:String(x.props.displayname||"日历"),color:String(x.props["calendar-color"]||"#7e9bb4").slice(0,7),components:many(x.props["supported-calendar-component-set"]?.comp).map(c=>String(c["@_name"]))}));
 }
}
