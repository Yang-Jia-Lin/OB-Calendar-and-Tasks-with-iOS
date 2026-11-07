import {Plugin,PluginSettingTab,Setting,Notice} from "obsidian";
import {ObsidianDesktopConnector} from "./desktopConnector";
import {diaryPath,DEFAULT_DIARY_FOLDER,DEFAULT_DIARY_LAYOUT_PATH} from "./diary";
import {applySidebar} from "./sidebar";
interface ConnectorPreferences {closeUnusedSidebarViewsOnStartup:boolean;diaryFolder:string;diaryLayoutPath:string}
class ConnectorSettings extends PluginSettingTab {
  constructor(private owner:CalendarTaskTimer){super(owner.app,owner);}
  display(){
    const root=this.containerEl,p=this.owner;root.replaceChildren();
    root.createEl("p",{text:"待办、日历、账户和同步由桌面应用管理。此插件只提供课题按钮与日记更新。"});
    new Setting(root).setName("启动时关闭反向链接和全部属性").setDesc("保留当前笔记属性，允许之后手动打开侧栏。").addToggle(t=>t.setValue(p.preferences.closeUnusedSidebarViewsOnStartup).onChange(async value=>{p.preferences.closeUnusedSidebarViewsOnStartup=value;await p.savePreferences();p.applySidebar();}));
    for(const [key,label,fallback] of [["diaryFolder","日记目录",DEFAULT_DIARY_FOLDER],["diaryLayoutPath","时间轴模板",DEFAULT_DIARY_LAYOUT_PATH]] as const){
      new Setting(root).setName(label).addText(t=>t.setValue(p.preferences[key]).onChange(async value=>{try{p.preferences[key]=diaryPath(value,fallback);await p.savePreferences();}catch(error){new Notice((error as Error).message);}}));
    }
  }
}
/** Connector only: never creates a local timer, cloud provider or sync queue. */
export default class CalendarTaskTimer extends Plugin {
  private connector?:ObsidianDesktopConnector;
  private saved:Record<string,unknown>={};private stopped=false;
  preferences:ConnectorPreferences={closeUnusedSidebarViewsOnStartup:true,diaryFolder:DEFAULT_DIARY_FOLDER,diaryLayoutPath:DEFAULT_DIARY_LAYOUT_PATH};
  get api(){return this.connector?.api;}
  async onload(){
    this.saved=await this.loadData()||{};
    this.preferences={closeUnusedSidebarViewsOnStartup:this.saved.closeUnusedSidebarViewsOnStartup!==false,diaryFolder:diaryPath(this.saved.diaryFolder,DEFAULT_DIARY_FOLDER),diaryLayoutPath:diaryPath(this.saved.diaryLayoutPath,DEFAULT_DIARY_LAYOUT_PATH)};
    this.connector=new ObsidianDesktopConnector(this,{...this.saved,...this.preferences});
    this.addSettingTab(new ConnectorSettings(this));
    this.app.workspace.onLayoutReady(()=>{if(!this.stopped)this.applySidebar();});
    await this.connector.start();
  }
  async savePreferences(){await this.saveData({...this.saved,...this.preferences});this.connector?.configure(this.preferences);}
  applySidebar(){return applySidebar(this.app.workspace,this.preferences.closeUnusedSidebarViewsOnStartup);}
  startFromNote(note:string,chooseTask=false){return this.connector!.startFromNote(note,chooseTask);}
  toggleFromNote(note:string,choose=false,expected?:string|null){return this.connector!.toggleFromNote(note,choose,expected);}
  updateDiaryFromNote(note:string){return this.connector!.updateDiaryFromNote(note);}
  onunload(){this.stopped=true;this.connector?.stop();}
}
