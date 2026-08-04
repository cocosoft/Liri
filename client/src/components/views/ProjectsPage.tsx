/**
 * ProjectsPage — 项目中心页（/projects）
 *
 * 参考 Microsoft Copilot Projects 页面布局：三栏结构
 *  ┌───────────┬─────────────────────────────────────┬───────────────────┐
 *  │ 左栏       │ 中栏                               │ 右栏 Creations    │
 *  │ 项目列表   │ 顶部标题 + 欢迎大标题 + 聊天区       │ Sources/Creations │
 *  │           │                                     │ 生成操作按钮      │
 *  └───────────┴─────────────────────────────────────┴───────────────────┘
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useRootStore } from "@/stores/root-store";
import { useChatStore } from "@/stores/chat";
import { chatCoordinator } from "@/stores/chat/chatCoordinator";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { triggerEngineHook } from "@/services/projectArtifactService";
import CreateProjectModal from "@/components/Workspace/CreateProjectModal";
import ChatArea from "@/components/ChatArea/ChatArea";
import { ProjectMaterialsPanel } from "@/components/project/ProjectMaterialsPanel";
import { ProjectDeliverablesPanel } from "@/components/project/ProjectDeliverablesPanel";
import { ProjectHistoryPanel } from "@/components/project/ProjectHistoryPanel";
import {
  DashboardIcon,
  ModelIcon,
  KnowledgeIcon,
  FileIcon,
  ZapIcon,
  UsersIcon,
} from "@/assets/icons";

/* ---------- 常量 ---------- */

interface CreationItem {
  id: string;
  label: string;
  path: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const CREATION_ITEMS: CreationItem[] = [
  {
    id: "summary",
    label: "摘要",
    path: "summary",
    description: "基于项目输入生成内容摘要与核心要点。",
    icon: ZapIcon,
  },
  {
    id: "podcast",
    label: "播客",
    path: "podcast",
    description: "将项目内容转化为可播放的对话式语音节目。",
    icon: UsersIcon,
  },
  {
    id: "study-guide",
    label: "学习指南",
    path: "study-guide",
    description: "生成分章节的结构化学习大纲与知识脉络。",
    icon: KnowledgeIcon,
  },
  {
    id: "quiz",
    label: "测验",
    path: "quiz",
    description: "围绕项目主题生成自测题目与答案解析。",
    icon: ModelIcon,
  },
  {
    id: "flashcards",
    label: "闪卡",
    path: "flashcards",
    description: "生成正反面问答记忆卡，用于复习和记忆。",
    icon: FileIcon,
  },
];

/** 按 id 查 CreationItem（供子页面读取） */
export function getCreationItem(id: string): CreationItem | undefined {
  return CREATION_ITEMS.find((c) => c.id === id);
}

/* ---------- 拼音首字母映射（常见 500+ 汉字） ---------- */

const PINYIN_INITIAL_DATA: Record<string, string> = {
  a: "啊阿爱安按暗案岸矮碍艾哀奥澳",
  b: "不部本把并报比别被标备步白百半版办保变便表病波布包背北边笔八吧班板帮宝抱暴爆杯悲壁避编宾冰兵丙饼拨博薄补捕毕闭必鞭辨辩伯驳泊埠怖",
  c: "从此次才存参曾层产长场车成程吃持充出除础处川传创床春词村错彩菜餐残仓藏操草册侧测策差查柴产颤昌常厂畅唱抄超朝潮吵车彻撤晨称撑成承城乘惩吃驰迟持尺冲充虫抽愁筹丑出初除厨础储楚处触川穿传船窗床创吹垂春纯唇词磁此刺从粗促催脆存寸措错",
  d: "的得地大对到等多但定点动道都代带队当等低底地弟帝递第典点电店殿调掉跌叠丁定丢东冬懂动栋都豆督毒读独堵赌杜度渡端短段断堆对队吨敦多夺答达打呆代带待袋单担胆但弹淡蛋当党档导岛倒到盗道稻德灯登等邓低敌底抵地弟帝递第典点电店殿雕吊钓调掉爹跌叠蝶丁叮盯顶订定丢东冬董懂动冻洞都斗抖豆督毒读独堵赌杜肚度渡端短段断锻堆队对吨蹲盾顿多夺躲朵",
  e: "而二儿俄恶额恩",
  f: "发方法非分反放风房复服副附幅富父负妇费范防访飞肥废纷粉份愤丰封蜂冯凤否夫肤扶符浮福辅腐父付负附复阀罚法帆翻繁凡烦反返犯泛饭范方防坊妨房仿访放飞非肥匪废沸费分芬纷坟粉份奋愤粪丰风封疯蜂冯缝凤否夫扶服浮符福幅辅腐父付负附妇复赴副傅富赋腹覆",
  g: "个过国高工关公广该改干感刚港搞告歌格各给根跟更耕功攻供宫巩共勾沟狗构购估古骨谷股故顾瓜刮挂怪关观官管馆罐光广逛归规鬼贵滚锅国果过改盖概干甘杆肝赶敢感刚钢岗港高搞稿告哥歌阁格隔个各给根跟更工公功攻宫巩贡供沟钩狗构购够估姑孤古骨谷股故顾雇瓜刮挂拐怪关观官冠馆管贯惯灌罐光广逛归龟规轨鬼柜贵桂滚棍锅国果裹过",
  h: "和会好很还后回化花话活或合红黄候湖互户护华画坏欢环换慌皇灰挥回会婚混活火伙或哈海害含寒喊汉汗旱航毫好号耗喝合河核荷盒贺黑痕很狠恨哼恒横衡轰红宏虹洪鸿猴后厚候呼忽狐胡壶湖糊虎互户护花华划画话坏欢还环缓幻换唤慌皇黄煌晃灰挥恢回悔毁汇会绘惠慧昏婚浑魂混活火伙或获祸惑",
  j: "就家间进经教加解决结件及己记技际济集基级即计见建将叫接金近精九酒旧觉军交角脚教阶介界今紧尽劲经惊景警静境镜纠九酒旧救就局举巨具俱剧据距聚卷决绝军击机肌鸡积迹基绩激及吉级极即急疾集籍几己挤计记纪技际季剂既继寄加夹佳家嘉甲价驾架假嫁监坚间肩艰兼检减简见件建剑健渐践鉴键箭江姜将讲奖降交郊娇骄胶焦角脚搅叫轿较教阶接揭街节劫杰洁结捷截姐解介戒届界借今金津筋仅紧锦尽劲近进晋禁京经茎惊晶睛精井景警净径竞竟敬境静镜纠究九久酒旧救就舅拘居鞠局菊橘举巨句拒具俱剧据距惧聚卷倦决觉绝掘军君均",
  k: "可开看口快科学空苦考靠科壳咳渴克刻客课肯坑空孔控口扣枯哭苦库裤酷夸跨块快宽款狂矿况亏困扩括卡开凯慨刊堪砍看康抗考烤靠科棵颗壳咳可渴克刻客课肯垦恳坑空孔恐控口扣枯哭苦库裤酷夸垮跨块快宽款筐狂况矿框亏葵愧溃昆捆困扩括阔",
  l: "了来里路两力理量立老类联料领流留论落路绿离连冷李利列例烈灵令另龙楼陆旅律率乱略轮落拉啦喇腊辣来赖兰拦栏蓝篮览懒烂郎狼廊朗浪劳牢老乐雷泪类累冷愣厘梨狸离李里理力历厉立丽利励例隶粒俩连帘怜莲联廉脸练炼链良凉梁粮两亮谅量辽疗了料列劣烈猎林临淋邻灵玲铃陵零龄领岭另令刘流留榴柳六龙笼隆楼漏露芦炉陆录鹿碌路驴旅屡律绿卵乱掠略轮论罗萝锣裸落骆",
  m: "没有面名目民明门马买满慢忙毛每美妹们猛梦密眠面苗灭民名明命摸模摩魔抹末莫墨默谋某母木目牧麻马码骂忙芒盲猫毛矛茅茂冒贸帽没玫梅煤霉每美妹门闷们猛梦迷谜米密蜜眠绵棉免面苗描秒妙庙灭民敏名明命摸模摩磨魔抹末莫漠墨默谋某母亩牡木目牧墓幕慕暮",
  n: "你那能年南宁努女内难脑闹呢嫩泥你念娘鸟您牛农弄怒女暖纳乃奶耐南男难囊挠恼脑闹呢内嫩能尼泥你逆年念娘酿鸟尿捏您宁凝牛扭纽农浓弄努怒女暖挪",
  o: "哦欧偶",
  p: "品评片平排派配盘跑批皮偏拼票频凭破铺普曝爬怕拍排牌派攀盘判盼旁胖抛跑泡陪培赔配喷盆朋棚蓬膨批披皮脾匹偏篇片骗漂飘票拼贫频品平评凭瓶萍坡泼颇破剖扑铺朴普谱曝",
  q: "去前起气七全请区却群齐全期奇企启器千迁签钱强墙抢悄敲桥瞧切且亲勤青轻倾清情庆穷求球区曲取去趣圈全权泉拳缺却确群七妻凄期欺齐奇骑棋旗企启起气弃汽器卡千迁牵铅签前钱潜浅遣欠枪强墙抢悄敲桥瞧巧切且窃亲侵秦琴勤青轻倾清情晴请庆穷丘秋求球区曲驱屈取去趣圈全权泉拳犬劝缺却雀确群",
  r: "人如日然让任认热容入软若染嚷让饶扰绕惹热人仁忍认任扔仍日荣容溶熔融柔肉如儒乳辱入软锐瑞润若弱",
  s: "是上时生说事使四所虽三色山少社身深神省师十识实市视世式首书数水思死四松送素速算随岁所撒洒塞赛三伞散桑嗓丧扫嫂色森僧杀沙纱傻晒山删衫闪陕善伤商赏上尚捎烧稍少绍哨舌蛇舍设社射涉申伸身深神审甚慎升生声牲胜省圣盛剩尸失师诗施湿十石识时实拾食史始驶士氏市示世式事势侍试视是适逝收手守首寿受兽售书叔殊梳疏输蔬熟暑属鼠术束述树竖数刷耍衰摔甩帅双霜爽谁水睡顺说丝司私思斯撕死四寺似松送诵搜艘苏俗诉肃素速宿塑酸蒜算虽随岁碎穗孙损缩所索锁",
  t: "他它她太特提通天体条停题同头台态谈探唐堂糖躺趟逃桃陶讨套疼腾梯提题体替天添田甜挑条跳贴铁厅听庭停挺通同统痛偷头投透突图徒途土团推腿退吞托拖脱塔踏台抬太态泰贪摊滩坛谈弹坦叹探汤唐堂塘糖躺趟涛掏逃桃陶讨套特疼腾藤梯踢提题蹄体替天添田甜填挑条跳贴铁厅听庭停挺通同桐铜童统桶筒痛偷头投透突图涂屠土吐兔团推腿退吞屯托拖脱驼",
  w: "我为我文无王外完万网往望位卫温文问稳五武舞务物误挖蛙瓦歪外弯丸完玩顽挽晚碗万汪亡王网往忘旺望危威微为违围唯维伟伪尾纬委卫未位味畏胃喂温文纹闻蚊稳问翁窝我沃卧握乌污屋无吴五午武舞务物误雾",
  x: "下小新学习先想性行西系统现相向些心信响象写血星兴许选需续修型细息喜系先鲜闲显现险县限线相香箱详享响想像向项消销小效校些协写血谢心信星行形醒兴性姓幸凶兄胸雄休修秀虚需许序续宣选学雪血巡训询西吸希析息牺悉惜稀溪锡熙习席袭洗喜戏系细瞎峡狭下吓夏仙先纤掀鲜闲弦咸衔嫌显险县现线限陷献乡相香箱乡详享响想向巷项象像削消销小晓孝校笑效些歇协邪胁斜携鞋写泄卸谢心辛欣新薪信星兴行形醒杏幸性姓凶兄胸雄熊休修羞朽秀绣袖需虚徐许序叙畜续宣悬旋选穴学雪血寻巡询循训讯迅",
  y: "一也有要用业于以又已与月原元音因远运云眼言严研演验阳样药要页夜液医依移遗已以义亿忆艺议异易益意因阴音引印应英营影映拥永泳勇用优由油游友有又右于余鱼娱与语玉育预域欲遇元园原圆援源远愿约月阅越云允运压呀鸦鸭牙芽崖哑雅亚咽烟淹延严言岩炎沿研盐颜衍掩眼演厌宴艳验扬羊阳杨洋仰养痒样腰邀摇遥咬药要耀爷也冶野业叶页夜液一衣医依仪移遗疑乙已以蚁椅义亿忆艺议亦异役译易益谊意毅因阴音吟银引饮隐印应英樱鹰迎营蝇赢影映硬拥永泳勇涌用优幽悠尤由邮犹油游友有又右幼诱于余鱼娱渔愉愚与宇羽雨语玉育狱浴预域欲遇御裕愈誉元园员原圆援缘源远怨院愿约月乐阅悦跃越云匀允孕运晕韵蕴",
  z: "在子自作最中再资总则组走增整证直主转着真者展战准种重只制治政质值职至注站张找照知纸指置周装状准资自字走租族阻组祖钻嘴最罪尊昨左做作座杂灾栽宰载再在咱暂赞脏葬遭糟早枣澡皂灶造燥责择泽贼怎曾增赠扎渣闸眨炸摘宅窄债沾粘展占战站张章涨掌丈仗帐障招找召照罩折者这针侦珍真诊枕阵振镇争征挣睁蒸整正证郑政之支汁芝枝知织脂执直值职植殖止只纸指至志制治质致智置中忠终钟种众重州舟周洲轴皱骤朱珠株诸猪竹逐烛主煮助住注驻柱祝著筑抓专砖转赚庄桩装壮状撞追准捉桌着仔咨姿资滋子紫字自宗综棕踪总纵走奏租足族阻组祖钻嘴最罪醉尊遵昨左做作座",
};

const PINYIN_INITIAL_MAP: Record<string, string> = {};
for (const [initial, chars] of Object.entries(PINYIN_INITIAL_DATA)) {
  for (const ch of chars) {
    PINYIN_INITIAL_MAP[ch] = initial;
  }
}

function toPinyinInitials(text: string): string {
  let result = "";
  for (const ch of text) {
    result += PINYIN_INITIAL_MAP[ch] || ch.toLowerCase();
  }
  return result;
}

function isPinyinQuery(query: string): boolean {
  return /^[a-z]+$/.test(query);
}

/* ---------- 组件 ---------- */

export default function ProjectsPage() {
  // 模态框 & 选中状态
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    openParam ?? null,
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSmartMenu, setShowSmartMenu] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const inited = useRef<string | null>(null);
  const lastProcessedMsgId = useRef<string | null>(null);

  // Root Store 订阅
  const worktrees = useRootStore((s) => s.worktrees);
  const sessions = useRootStore((s) => s.sessions);
  const switchWorkspace = useRootStore((s) => s.switchWorkspace);
  const createChatSession = useRootStore((s) => s.createChatSession);
  const deleteWorkspace = useRootStore((s) => s.deleteWorkspace);
  const updateWorkspace = useRootStore((s) => s.updateWorkspace);
  const completeWorkspace = useRootStore((s) => s.completeWorkspace);
  const uncompleteWorkspace = useRootStore((s) => s.uncompleteWorkspace);
  const togglePinWorkspace = useRootStore((s) => s.togglePinWorkspace);
  const enterModule = useRootStore((s) => s.enterModule);
  const leaveModule = useRootStore((s) => s.leaveModule);
  const messages = useChatStore((s) => s.messages);

  useEffect(() => {
    enterModule({ moduleType: "project" });
    // S5a: URL ?open= 参数用于自动选中项目，选中后清除参数避免刷新重复选中
    if (openParam && worktrees[openParam]) {
      searchParams.delete("open");
      setSearchParams(searchParams, { replace: true });
    }
    return () => leaveModule();
  }, [enterModule, leaveModule]);

  // 隐性引擎钩子：检测新 assistant 消息并触发分析
  useEffect(() => {
    if (!selectedProjectId || messages.length === 0) return;

    const lastAssistantMsg = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistantMsg) return;
    if (lastProcessedMsgId.current === lastAssistantMsg.id) return;
    lastProcessedMsgId.current = lastAssistantMsg.id;

    triggerEngineHook(selectedProjectId, lastAssistantMsg.content).catch(() => {
      /* 隐性引擎失败不阻塞 UI */
    });
    // 引擎写入后刷新右侧面板
    setRefreshKey((k) => k + 1);
  }, [messages, selectedProjectId]);

  // 仅显示用户创建的项目，按最近会话时间排序 + 搜索过滤
  const projects = useMemo(() => {
    let list = Object.values(worktrees).filter(
      (w) => w.workspaceSource === "user",
    );

    // 搜索过滤：匹配项目名称 + 项目内会话标题（含拼音匹配）
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const pinyinQ = isPinyinQuery(q);
      list = list.filter((w) => {
        if (w.name.toLowerCase().includes(q)) return true;
        if (pinyinQ && toPinyinInitials(w.name).includes(q)) return true;
        // 检查项目内会话标题
        const projSessions = Object.values(sessions).filter(
          (s) => s.workspaceId === w.id,
        );
        return projSessions.some((s) => {
          const title = (s.title || s.id?.slice(0, 8) || "").toLowerCase();
          if (title.includes(q)) return true;
          if (pinyinQ && toPinyinInitials(title).includes(q)) return true;
          return false;
        });
      });
    }

    // 按最近一次会话时间排序（有会话的排前面）
    list.sort((a, b) => {
      const aSessions = Object.values(sessions).filter(
        (s) => s.workspaceId === a.id,
      );
      const bSessions = Object.values(sessions).filter(
        (s) => s.workspaceId === b.id,
      );
      const aLatest =
        aSessions.length > 0
          ? Math.max(...aSessions.map((s) => s.updatedAt || 0))
          : 0;
      const bLatest =
        bSessions.length > 0
          ? Math.max(...bSessions.map((s) => s.updatedAt || 0))
          : 0;
      return bLatest - aLatest;
    });

    return list;
  }, [worktrees, sessions, searchQuery]);

  /** 搜索结果高亮（含拼音匹配） */
  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query) return text;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx !== -1) {
      return (
        <>
          {text.slice(0, idx)}
          <span className="bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 rounded px-0.5">
            {text.slice(idx, idx + query.length)}
          </span>
          {text.slice(idx + query.length)}
        </>
      );
    }
    // 拼音匹配：查询看起来像拼音时，尝试拼音首字母匹配并高亮对应汉字
    if (isPinyinQuery(lowerQuery)) {
      const pinyin = toPinyinInitials(text);
      const pinyinIdx = pinyin.indexOf(lowerQuery);
      if (pinyinIdx !== -1) {
        return (
          <>
            {text.slice(0, pinyinIdx)}
            <span className="bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 rounded px-0.5">
              {text.slice(pinyinIdx, pinyinIdx + lowerQuery.length)}
            </span>
            {text.slice(pinyinIdx + lowerQuery.length)}
          </>
        );
      }
    }
    return text;
  };

  const selectedProject = selectedProjectId
    ? worktrees[selectedProjectId]
    : undefined;

  /* ---- 进入项目时初始化：切换 worktree + 自动创建首个会话 ---- */
  useEffect(() => {
    if (
      !selectedProjectId ||
      !selectedProject ||
      inited.current === selectedProjectId
    )
      return;
    inited.current = selectedProjectId;
    const wid = selectedProjectId;

    async function init() {
      await switchWorkspace(wid);
      const state = useRootStore.getState();
      const projSessions = Object.values(state.sessions).filter(
        (s) => s.workspaceId === wid,
      );
      if (projSessions.length === 0) {
        await createChatSession("对话 1");
      }
    }
    init().catch((e) =>
      handleClientError(e, {
        module: "projects:page",
        action: "initProject",
      }),
    );
  }, [selectedProjectId, selectedProject, switchWorkspace, createChatSession]);

  const handleSelectProject = (id: string) => {
    if (id !== selectedProjectId) {
      inited.current = null;
      setSelectedProjectId(id);
    }
  };

  /* ---- 删除项目 ---- */
  const handleDelete = async () => {
    if (!selectedProjectId) return;
    setDeleting(true);
    try {
      await chatCoordinator.stopMessage();
      const state = useRootStore.getState();
      const projSessions = Object.values(state.sessions).filter(
        (s) => s.workspaceId === selectedProjectId,
      );
      for (const s of projSessions) {
        try {
          await sessionService.delete(s.id);
        } catch {
          /* @ignore-catch 单个会话删除失败不阻塞 */
        }
      }
      await deleteWorkspace(selectedProjectId);
      setSelectedProjectId(null);
      setShowDeleteConfirm(false);
    } catch (e) {
      setDeleting(false);
      handleClientError(e, {
        module: "projects:page",
        action: "deleteProject",
      });
    }
  };

  const getSessionCount = (workspaceId: string) =>
    Object.values(sessions).filter((s) => s.workspaceId === workspaceId).length;

  /** 获取项目活跃度标记 */
  const getActivityBadge = (workspaceId: string) => {
    const projSessions = Object.values(sessions).filter(
      (s) => s.workspaceId === workspaceId,
    );
    if (projSessions.length === 0) return null;
    const latest = Math.max(...projSessions.map((s) => s.updatedAt || 0));
    const now = Date.now();
    const hours = (now - latest) / (1000 * 60 * 60);
    if (hours < 24) return { color: "text-green-500", label: "今天" };
    if (hours < 168) return { color: "text-yellow-500", label: "本周" };
    return { color: "text-gray-400", label: "更早" };
  };

  /** 休眠分区：按最后活跃时间分组 */
  const [dormantExpanded, setDormantExpanded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { activeProjects, dormantProjects, archivedProjects } = useMemo(() => {
    const now = Date.now();
    const active: typeof projects = [];
    const dormant: typeof projects = [];
    const archived: typeof projects = [];

    for (const p of projects) {
      // 完结项目豁免休眠：永远在活跃区
      // 置顶项目豁免休眠：固定在活跃区顶部
      if (p.status === "completed" || p.pinned) {
        active.push(p);
        continue;
      }

      const projSessions = Object.values(sessions).filter(
        (s) => s.workspaceId === p.id,
      );
      if (projSessions.length === 0) {
        active.push(p); // 无会话的新项目默认在活跃区
        continue;
      }
      const latest = Math.max(...projSessions.map((s) => s.updatedAt || 0));
      const days = (now - latest) / (1000 * 60 * 60 * 24);
      if (days <= 7) active.push(p);
      else if (days <= 30) dormant.push(p);
      else archived.push(p);
    }
    // 置顶项目排最前
    active.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return {
      activeProjects: active,
      dormantProjects: dormant,
      archivedProjects: archived,
    };
  }, [projects, sessions]);

  /** 渲染单个项目条目 */
  const renderProjectItem = (p: (typeof projects)[number]) => {
    const badge = getActivityBadge(p.id);
    const isCompleted = p.status === "completed";
    const isEditing = editingId === p.id;
    const canUndo =
      Date.now() - (p.autoCreatedAt ?? p.createdAt) < 30 * 60 * 1000;

    const handleRename = () => {
      setEditingId(p.id);
      setEditName(p.name);
      setContextMenuId(null);
    };
    const handleComplete = () => {
      if (isCompleted) {
        uncompleteWorkspace(p.id);
      } else {
        completeWorkspace(p.id);
      }
      setContextMenuId(null);
    };
    const handleDeleteClick = () => {
      setSelectedProjectId(p.id);
      setShowDeleteConfirm(true);
      setContextMenuId(null);
    };
    const submitRename = () => {
      if (editName.trim()) {
        updateWorkspace(p.id, {
          name: editName.trim(),
        });
      }
      setEditingId(null);
    };

    return (
      <div key={p.id} className="relative group">
        {isEditing ? (
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setEditingId(null);
              }}
              className="w-full text-sm px-2 py-1 border border-blue-400 rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => handleSelectProject(p.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenuId(contextMenuId === p.id ? null : p.id);
            }}
            className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-gray-800 transition-colors ${
              selectedProjectId === p.id
                ? "bg-gray-100 dark:bg-gray-800 border-l-2 border-l-blue-600 dark:border-l-blue-500"
                : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <DashboardIcon
                size={14}
                className="text-gray-400 dark:text-gray-500 flex-shrink-0"
              />
              <span
                className={`text-sm font-medium truncate flex-1 ${
                  isCompleted
                    ? "text-gray-400 dark:text-gray-500 line-through"
                    : "text-gray-800 dark:text-gray-200"
                }`}
              >
                {p.pinned && <span className="mr-1">📌</span>}
                {highlightMatch(p.name, searchQuery)}
              </span>
              {/* ⋮ 按钮 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenuId(contextMenuId === p.id ? null : p.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-opacity"
                title="更多操作"
              >
                ⋮
              </button>
            </div>
            <div className="flex items-center gap-2 mt-0.5 ml-6">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {getSessionCount(p.id)} 个会话
              </span>
              {badge && !isCompleted && (
                <span className={`text-[10px] ${badge.color}`}>
                  {badge.label}
                </span>
              )}
            </div>
          </button>
        )}

        {/* 右键菜单 */}
        {contextMenuId === p.id && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setContextMenuId(null)}
            />
            <div className="absolute right-2 top-8 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[120px]">
              <button
                onClick={handleRename}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                重命名
              </button>
              <button
                onClick={handleComplete}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {isCompleted ? "取消完成" : "标记完成"}
              </button>
              <button
                onClick={() => {
                  togglePinWorkspace(p.id);
                  setContextMenuId(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {p.pinned ? "📌 取消置顶" : "📌 置顶"}
              </button>
              {canUndo && (
                <button
                  onClick={() => {
                    deleteWorkspace(p.id);
                    setContextMenuId(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  ↩ 撤销创建
                </button>
              )}
              <button
                onClick={handleDeleteClick}
                className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                删除
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-1 h-full bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* ======================================== */}
      {/*  左栏：项目列表                           */}
      {/* ======================================== */}
      <aside className="w-56 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0 bg-white dark:bg-gray-900">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <DashboardIcon
              size={16}
              className="text-gray-500 dark:text-gray-400"
            />
            项目
          </h2>
          <button
            onClick={() => setShowCreate(true)}
            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            title="新建项目"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索项目..."
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* 项目列表 */}
        <div className="flex-1 overflow-y-auto">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-3">
              <DashboardIcon
                size={32}
                className="mb-2 text-gray-300 dark:text-gray-600"
              />
              {searchQuery.trim() ? (
                <>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    没有找到「{searchQuery}」
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                    试试用其他关键词或拼音搜索
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    暂无项目
                  </p>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="mt-2 text-xs text-blue-600 dark:text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
                  >
                    创建第一个项目
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* 活跃项目 */}
              {activeProjects.map(renderProjectItem)}

              {/* 休眠项目（可折叠） */}
              {dormantProjects.length > 0 && (
                <>
                  <button
                    onClick={() => setDormantExpanded(!dormantExpanded)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1"
                  >
                    <span className="text-[10px]">
                      {dormantExpanded ? "▾" : "▸"}
                    </span>
                    休眠 ({dormantProjects.length} 个项目)
                  </button>
                  {dormantExpanded && dormantProjects.map(renderProjectItem)}
                </>
              )}

              {/* 归档入口 */}
              {archivedProjects.length > 0 && !showArchived && (
                <button
                  onClick={() => setShowArchived(true)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  查看归档 ({archivedProjects.length})
                </button>
              )}
              {showArchived && archivedProjects.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] text-gray-400 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800">
                    归档
                  </div>
                  {archivedProjects.map(renderProjectItem)}
                </>
              )}
            </>
          )}
        </div>
      </aside>

      {/* ======================================== */}
      {/*  中栏：项目主区域                          */}
      {/* ======================================== */}
      <main className="flex-1 flex flex-col min-w-0">
        {selectedProject ? (
          <>
            {/* ---------- 顶部标题栏 ---------- */}
            <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base font-medium text-gray-800 dark:text-gray-100 truncate">
                  {selectedProject.name}
                </span>
              </div>
              <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                {/* 搜索图标 */}
                <button
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title="搜索"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </button>
                {/* 删除/设置菜单 */}
                <div className="relative">
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="项目操作"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle cx="5" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>
                </div>
              </div>
            </header>

            {/* ---------- 内容主体（ChatArea 包裹） ---------- */}
            <div className="flex-1 min-h-0 flex flex-col relative bg-white dark:bg-gray-900">
              {/* 无消息时显示欢迎大标题 */}
              {!hasMessages && (
                <div className="px-8 pt-16 pb-6 flex justify-center">
                  <h1 className="text-2xl md:text-3xl font-semibold text-gray-800 dark:text-gray-100 text-center leading-tight">
                    准备开始「{selectedProject.name}」项目了吗？
                  </h1>
                </div>
              )}

              {/* ChatArea：消息列表 + 输入框 — fluid 模式，项目页全宽无 max-w-3xl 居中 */}
              <div className="flex-1 min-h-0">
                <ChatArea fluid />
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-500">
            <DashboardIcon
              size={48}
              className="mb-3 text-gray-300 dark:text-gray-700"
            />
            <p className="text-lg mb-1 font-medium text-gray-700 dark:text-gray-300">
              请选择一个项目
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-600">
              从左侧列表中选择项目开始
            </p>
          </div>
        )}
      </main>

      {/* ======================================== */}
      {/*  右栏：资料 / 成果 / 讨论记录              */}
      {/* ======================================== */}
      <aside className="w-72 border-l border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0 bg-white dark:bg-gray-900">
        {/* -- 项目资料 -- */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            项目资料
          </div>
          <div className="max-h-40 overflow-y-auto">
            {selectedProjectId ? (
              <ProjectMaterialsPanel
                projectId={selectedProjectId}
                refreshKey={refreshKey}
              />
            ) : (
              <div className="p-4 text-sm text-gray-400 text-center">
                请先选择项目
              </div>
            )}
          </div>
        </div>

        {/* -- 成果 -- */}
        <div className="flex-1 overflow-y-auto border-b border-gray-100 dark:border-gray-800">
          <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            成果
          </div>
          {selectedProjectId ? (
            <ProjectDeliverablesPanel
              projectId={selectedProjectId}
              refreshKey={refreshKey}
            />
          ) : (
            <div className="p-4 text-sm text-gray-400 text-center">
              请先选择项目
            </div>
          )}
        </div>

        {/* -- 讨论记录 -- */}
        <div className="max-h-48 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            讨论记录
          </div>
          {selectedProjectId ? (
            <ProjectHistoryPanel
              projectId={selectedProjectId}
              refreshKey={refreshKey}
            />
          ) : (
            <div className="p-4 text-sm text-gray-400 text-center">
              请先选择项目
            </div>
          )}
        </div>
      </aside>

      {/* ---------- Smart 菜单（输入框左侧下拉，浮层预留位） ---------- */}
      {showSmartMenu && (
        <div className="fixed z-50" onClick={() => setShowSmartMenu(false)} />
      )}

      {/* ---------- 新建项目弹窗 ---------- */}
      {showCreate && (
        <CreateProjectModal onClose={() => setShowCreate(false)} />
      )}

      {/* ---------- 删除确认弹窗 ---------- */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeleteConfirm(false);
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
              删除项目
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
              这将删除{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                「{selectedProject?.name}」
              </span>{" "}
              及其下所有会话。此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deleting ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
