import {
  DAY_START_MINUTE,
  DEFAULT_RULES,
  RULE_VERSION,
  SCHEMA_VERSION,
} from "../shared/constants";
import type {
  Building,
  BuildingType,
  Faction,
  GameEvent,
  Goal,
  Memory,
  MemoryKind,
  Relationship,
  RelationshipType,
  Resident,
  Secret,
  WorldHistoryPoint,
  WorldState,
} from "../shared/types";
import { makeSeed, Rng, hashString } from "./rng";

interface BuildingSeed {
  id: string;
  name: string;
  type: BuildingType;
  description: string;
  x: number;
  z: number;
  w: number;
  d: number;
  capacity: number;
  ownerFactionId: string | null;
  neonColor: string;
  openAir?: boolean;
  inventory?: Partial<Building["inventory"]>;
  condition?: number;
  emissions?: number;
}

const BUILDING_SEEDS: BuildingSeed[] = [
  {
    id: "b_home_neon",
    name: "霓虹公寓",
    type: "residential",
    description: "紧贴轻轨高架的旧式公寓，墙面上不断闪烁的广告是全城最亮的夜灯。",
    x: 1,
    z: 1,
    w: 5,
    d: 4,
    capacity: 18,
    ownerFactionId: "free",
    neonColor: "#5af2d0",
    inventory: { food: 38, meds: 3, energy: 24 },
  },
  {
    id: "b_corp",
    name: "新纪元塔",
    type: "workplace",
    description: "新纪元科技的区域总部。玻璃幕墙后运行着整座城市的能源调度系统。",
    x: 9,
    z: 1,
    w: 5,
    d: 5,
    capacity: 26,
    ownerFactionId: "corp",
    neonColor: "#59b8ff",
    inventory: { food: 30, energy: 90, credits: 4200 },
    emissions: 3.2,
  },
  {
    id: "b_clinic",
    name: "白噪诊所",
    type: "medical",
    description: "由社区医生轮班维持的小诊所，虽然设备老旧，但从不拒绝急诊。",
    x: 15,
    z: 1,
    w: 4,
    d: 5,
    capacity: 14,
    ownerFactionId: "free",
    neonColor: "#ff6e9f",
    inventory: { meds: 42, credits: 360, energy: 30 },
    emissions: 0.4,
  },
  {
    id: "b_home_harbor",
    name: "港湾宿舍",
    type: "residential",
    description: "企业为轮班员工提供的集装箱式宿舍，隔音很差，暖气时有时无。",
    x: 21,
    z: 1,
    w: 6,
    d: 4,
    capacity: 20,
    ownerFactionId: "corp",
    neonColor: "#8d7cff",
    inventory: { food: 28, energy: 20 },
  },
  {
    id: "b_utility",
    name: "潮汐能源站",
    type: "utility",
    description: "旧海堤改造的潮汐发电设施，企业安保在此值守，城市三分之一的电力由此输出。",
    x: 27,
    z: 1,
    w: 4,
    d: 4,
    capacity: 8,
    ownerFactionId: "corp",
    neonColor: "#6fa8ff",
    inventory: { energy: 260, credits: 1100 },
    emissions: 1.4,
  },
  {
    id: "b_community",
    name: "自由港互助站",
    type: "public",
    description: "由居民自治运营的互助站：配给、托儿、修理和流言都在同一间大厅里流动。",
    x: 1,
    z: 8,
    w: 5,
    d: 5,
    capacity: 30,
    ownerFactionId: "free",
    neonColor: "#5af2d0",
    inventory: { food: 72, meds: 17, credits: 420 },
  },
  {
    id: "b_bar",
    name: "幽网节点",
    type: "public",
    description: "表面上是营业到清晨的地下酒吧，后门通向一条没有监控的巷子。",
    x: 9,
    z: 8,
    w: 4,
    d: 5,
    capacity: 22,
    ownerFactionId: "void",
    neonColor: "#d36bff",
    inventory: { food: 24, credits: 260, meds: 8 },
  },
  {
    id: "b_noodle",
    name: "24H 面馆",
    type: "shop",
    description: "永不熄灯的街角面馆。老板老陶坚信：只要还有热汤，城市就还没坏透。",
    x: 15,
    z: 8,
    w: 4,
    d: 3,
    capacity: 16,
    ownerFactionId: "free",
    neonColor: "#ffcf6a",
    inventory: { food: 88, meds: 4, credits: 480 },
  },
  {
    id: "b_clinic_aug",
    name: "义体诊所",
    type: "medical",
    description: "合法边缘的义体维护店，门口的粉红霓虹灯管坏了一半。",
    x: 15,
    z: 11,
    w: 4,
    d: 3,
    capacity: 12,
    ownerFactionId: "void",
    neonColor: "#ff87c4",
    inventory: { meds: 29, credits: 610, energy: 18 },
  },
  {
    id: "b_market",
    name: "第七码头市场",
    type: "shop",
    description: "从合成食物到二手义体都能找到的综合市场，价格随治安和供应链剧烈波动。",
    x: 21,
    z: 8,
    w: 6,
    d: 5,
    capacity: 32,
    ownerFactionId: "free",
    neonColor: "#ffbb5a",
    inventory: { food: 126, meds: 18, energy: 36, credits: 940 },
  },
  {
    id: "b_office",
    name: "数据工会",
    type: "workplace",
    description: "独立记者、数据掮客和外包程序员的共享办公点，存档服务器藏在浴室后面。",
    x: 28,
    z: 8,
    w: 4,
    d: 5,
    capacity: 15,
    ownerFactionId: "void",
    neonColor: "#a48aff",
    inventory: { credits: 920, energy: 44, food: 16 },
  },
  {
    id: "b_workshop",
    name: "齿轮工坊",
    type: "workplace",
    description: "堆满旧零件的地下修理铺，林岚和老K-9在这里维持着街区的能源与义体。",
    x: 1,
    z: 16,
    w: 5,
    d: 4,
    capacity: 14,
    ownerFactionId: "void",
    neonColor: "#5af2d0",
    inventory: { credits: 1200, energy: 76, meds: 7 },
    emissions: 1.2,
  },
  {
    id: "b_home_rain",
    name: "雨棚住宅",
    type: "residential",
    description: "建在废弃高架下的临时住宅群，酸雨时整片屋顶会发出沙沙的声音。",
    x: 9,
    z: 16,
    w: 5,
    d: 4,
    capacity: 22,
    ownerFactionId: "free",
    neonColor: "#8fffc8",
    inventory: { food: 43, energy: 16, meds: 2 },
  },
  {
    id: "b_theater",
    name: "全息剧场",
    type: "public",
    description: "一座由居民众筹修复的全息剧场，每晚播放未经审查的城市记忆。",
    x: 15,
    z: 16,
    w: 4,
    d: 4,
    capacity: 28,
    ownerFactionId: "free",
    neonColor: "#ff7ac8",
    inventory: { credits: 320, food: 12, energy: 28 },
  },
  {
    id: "b_lab",
    name: "神经实验室",
    type: "medical",
    description: "企业资助的神经接口研究设施，窗帘后面永远有蓝白色的光。",
    x: 21,
    z: 16,
    w: 6,
    d: 5,
    capacity: 18,
    ownerFactionId: "corp",
    neonColor: "#7cd8ff",
    inventory: { meds: 52, credits: 1800, energy: 60 },
    emissions: 2.1,
  },
  {
    id: "b_home_hive",
    name: "蜂巢公寓",
    type: "residential",
    description: "企业外包员工居住的蜂窝式公寓，每个单元都能被远程断电。",
    x: 28,
    z: 16,
    w: 4,
    d: 5,
    capacity: 20,
    ownerFactionId: "corp",
    neonColor: "#a48aff",
    inventory: { food: 24, energy: 18 },
  },
  {
    id: "b_park",
    name: "霓虹公园",
    type: "public",
    description: "旧防波堤上长出的开放公园，是全城唯一能同时看见星星和霓虹灯的地方。",
    x: 1,
    z: 24,
    w: 9,
    d: 3,
    capacity: 40,
    ownerFactionId: "free",
    neonColor: "#5af2d0",
    openAir: true,
    inventory: { food: 8, energy: 10 },
  },
  {
    id: "b_repair",
    name: "零件铺",
    type: "shop",
    description: "出售从废墟里翻出的无人机零件和未经认证的电池，价格全看老板心情。",
    x: 11,
    z: 24,
    w: 5,
    d: 3,
    capacity: 10,
    ownerFactionId: "void",
    neonColor: "#ffcf6a",
    inventory: { energy: 42, meds: 3, credits: 430 },
  },
  {
    id: "b_clinic_under",
    name: "地下诊所",
    type: "medical",
    description: "没有执照，也不问身份的诊所。这里救过的人比企业医院更多。",
    x: 17,
    z: 24,
    w: 5,
    d: 3,
    capacity: 12,
    ownerFactionId: "void",
    neonColor: "#ff6e9f",
    inventory: { meds: 46, credits: 380, energy: 12 },
  },
  {
    id: "b_home_dock",
    name: "码头宿舍",
    type: "residential",
    description: "废弃港口仓库隔出的群租房，窗外就是永不停歇的潮汐发电站。",
    x: 23,
    z: 24,
    w: 5,
    d: 3,
    capacity: 18,
    ownerFactionId: "corp",
    neonColor: "#7f9dff",
    inventory: { food: 31, energy: 14 },
  },
];

interface BondSeed {
  target: string;
  type: RelationshipType;
  familiarity: number;
  affinity: number;
  trust: number;
  intimacy?: number;
  attraction?: number;
  hostility?: number;
  notes?: string[];
}

interface ResidentSeed {
  id: string;
  name: string;
  age: number;
  pronouns: "她" | "他" | "TA";
  jobTitle: string;
  factionId: string;
  home: string;
  work: string;
  workSkill: string;
  personality: {
    traits: [number, number, number, number, number];
    labels: string[];
    values: string[];
  };
  backstory: string;
  wealth: number;
  health: number;
  mood: number;
  stress: number;
  needs: [number, number, number, number];
  goals: Array<{ title: string; description: string; priority: number; deadline?: number }>;
  bonds: BondSeed[];
  secrets?: Array<{ text: string; importance: number; subjectId?: string }>;
  memories?: Array<{ text: string; kind: MemoryKind; importance: number; subjects?: string[] }>;
  appearance: [string, string, string, string, number];
  routine?: [number, number, number, number];
}

const RESIDENT_SEEDS: ResidentSeed[] = [
  {
    id: "r_linlan",
    name: "林岚",
    age: 31,
    pronouns: "她",
    jobTitle: "能源维修技师",
    factionId: "free",
    home: "b_home_neon",
    work: "b_workshop",
    workSkill: "工程",
    personality: {
      traits: [71, 82, 44, 68, 52],
      labels: ["务实", "手巧", "嘴硬心软"],
      values: ["可靠", "社区", "自己修好一切"],
    },
    backstory: "在第七码头长大，靠拆解报废无人机自学电路。她相信灯亮着，人就还有救。",
    wealth: 86,
    health: 87,
    mood: 64,
    stress: 41,
    needs: [42, 52, 48, 71],
    goals: [
      { title: "让自由港的电网撑过下一次酸雨季", description: "修复互助站与诊所的备用线路，寻找替代能源节点。", priority: 8 },
      { title: "攒够更换左臂神经接驳件的钱", description: "旧接驳件开始失灵，不能再拖了。", priority: 6, deadline: 32 },
    ],
    bonds: [
      { target: "r_chenmo", type: "friend", familiarity: 78, affinity: 58, trust: 71, intimacy: 44, notes: ["一起修过诊所的发电机"] },
      { target: "r_ningchuan", type: "friend", familiarity: 62, affinity: 45, trust: 64, intimacy: 30, notes: ["老宁教过她读旧电路图"] },
      { target: "r_jiangyu", type: "acquaintance", familiarity: 33, affinity: 22, trust: 18, attraction: 17 },
      { target: "r_k9", type: "acquaintance", familiarity: 45, affinity: 18, trust: 35, notes: ["同事，偶尔一起值夜班"] },
    ],
    memories: [
      { text: "上一次停电时，陈默在黑暗中替一个孩子做了急救。", kind: "observation", importance: 6, subjects: ["r_chenmo"] },
      { text: "互助站的备用发电机又烧了一个线圈。", kind: "action", importance: 4 },
    ],
    appearance: ["#1b3a43", "#5af2d0", "#d7a988", "#1a2733", 1.0],
    routine: [390, 1360, 540, 1020],
  },
  {
    id: "r_zhouyi",
    name: "周弈",
    age: 35,
    pronouns: "他",
    jobTitle: "企业系统分析师",
    factionId: "corp",
    home: "b_home_harbor",
    work: "b_corp",
    workSkill: "分析",
    personality: {
      traits: [78, 74, 35, 46, 61],
      labels: ["谨慎", "聪敏", "野心深藏"],
      values: ["秩序", "掌控", "被看见"],
    },
    backstory: "从底层数据录入员爬到区域分析主管，没人知道他曾在幽网论坛上匿名发过什么。",
    wealth: 248,
    health: 78,
    mood: 56,
    stress: 62,
    needs: [36, 61, 37, 66],
    goals: [
      { title: "进入新纪元科技决策层", description: "完成能源调度优化项目，取得董事会信任。", priority: 9 },
      { title: "确认苏禾是否掌握了自己的匿名账号", description: "那条旧帖足以毁掉现在的一切。", priority: 7 },
    ],
    bonds: [
      { target: "r_mozi", type: "friend", familiarity: 64, affinity: 51, trust: 38, attraction: 29, notes: ["同事，但在某些事情上互不信任"] },
      { target: "r_guqing", type: "rival", familiarity: 58, affinity: -22, trust: -8, hostility: 34, notes: ["争夺同一个晋升名额"] },
      { target: "r_qiye", type: "acquaintance", familiarity: 38, affinity: 12, trust: 26, notes: ["安保负责人，能提供一些内部消息"] },
      { target: "r_suhe", type: "acquaintance", familiarity: 26, affinity: -5, trust: 10, hostility: 12 },
    ],
    secrets: [
      { text: "三年前匿名泄露企业调度表的账号属于周弈。", importance: 9, subjectId: "b_corp" },
      { text: "他私自在能源调度系统里留了一个后门。", importance: 8, subjectId: "b_utility" },
    ],
    memories: [
      { text: "董事会承诺，只要调度项目成功，明年就有一个副总监席位。", kind: "life", importance: 7 },
      { text: "顾青在会议上公开质疑他的数据模型。", kind: "conflict", importance: 5, subjects: ["r_guqing"] },
    ],
    appearance: ["#172b40", "#59b8ff", "#c8a284", "#202a34", 1.05],
    routine: [410, 1400, 540, 1080],
  },
  {
    id: "r_akui",
    name: "阿葵",
    age: 26,
    pronouns: "她",
    jobTitle: "地下信使",
    factionId: "void",
    home: "b_home_rain",
    work: "b_bar",
    workSkill: "潜行",
    personality: {
      traits: [67, 38, 76, 55, 58],
      labels: ["机敏", "不守规矩", "重情"],
      values: ["自由", "信息", "不欠人情"],
    },
    backstory: "十二岁起就在码头替人跑腿。她熟悉每一条没有摄像头的巷子，也知道哪些秘密不该说出口。",
    wealth: 74,
    health: 73,
    mood: 61,
    stress: 55,
    needs: [51, 46, 63, 48],
    goals: [
      { title: "建立一条不受监控的跨区信息通道", description: "把幽网的节点扩展到企业区边缘。", priority: 8 },
      { title: "弄清楚父亲死亡的真正原因", description: "官方记录只写了一行：潮汐站事故。", priority: 7 },
    ],
    bonds: [
      { target: "r_sable", type: "rival", familiarity: 59, affinity: -12, trust: 9, hostility: 29, notes: ["曾抢走她的一单情报生意"] },
      { target: "r_suhe", type: "acquaintance", familiarity: 41, affinity: 17, trust: 22, notes: ["记者，可能有用，也可能危险"] },
      { target: "r_tang", type: "friend", familiarity: 63, affinity: 41, trust: 49, intimacy: 28, notes: ["夜班后一起吃过面"] },
    ],
    secrets: [{ text: "她掌握幽网节点在第七码头的真实入口位置。", importance: 8, subjectId: "b_bar" }],
    memories: [
      { text: "有人在雨棚住宅区高价打听幽网节点的位置。", kind: "observation", importance: 6, subjects: ["r_sable"] },
      { text: "唐糖在打烊后给她留了一碗面。", kind: "gift", importance: 4, subjects: ["r_tang"] },
    ],
    appearance: ["#241b3b", "#d36bff", "#e0b090", "#5a3254", 0.92],
    routine: [600, 1500, 720, 1320],
  },
  {
    id: "r_chenmo",
    name: "陈默",
    age: 45,
    pronouns: "他",
    jobTitle: "社区医生",
    factionId: "free",
    home: "b_home_neon",
    work: "b_clinic",
    workSkill: "医学",
    personality: {
      traits: [62, 77, 29, 88, 39],
      labels: ["仁慈", "寡言", "固执"],
      values: ["生命", "责任", "不让任何人独自死去"],
    },
    backstory: "曾是市立医院最好的外科医生，一场医疗事故后离开体系，在第七码头开了不收挂号费的小诊所。",
    wealth: 58,
    health: 66,
    mood: 59,
    stress: 67,
    needs: [59, 37, 44, 55],
    goals: [
      { title: "让每一位居民都能免费获得基础医疗", description: "维持诊所药房库存，并建立社区急救网络。", priority: 9 },
      { title: "与十四年前的手术事故和解", description: "至少，亲口向那个家庭说出真相。", priority: 6 },
    ],
    bonds: [
      { target: "r_linlan", type: "friend", familiarity: 82, affinity: 63, trust: 78, intimacy: 46, notes: ["最可靠的邻居"] },
      { target: "r_heiyan", type: "close_friend", familiarity: 88, affinity: 72, trust: 85, intimacy: 53, notes: ["旧友，一起处理过许多事故"] },
      { target: "r_xiaoman", type: "acquaintance", familiarity: 36, affinity: 33, trust: 31, notes: ["常来诊所做义工的年轻人"] },
      { target: "r_suhe", type: "acquaintance", familiarity: 30, affinity: 11, trust: 17 },
    ],
    secrets: [{ text: "十四年前那场医疗事故并非他的失误，但他替真正责任人背了锅。", importance: 10 }],
    memories: [
      { text: "诊所的旧发电机在酸雨中短路，林岚连夜修好了它。", kind: "gift", importance: 6, subjects: ["r_linlan"] },
      { text: "医疗物资只剩最后一次急救的量。", kind: "observation", importance: 7 },
    ],
    appearance: ["#25302e", "#5af2d0", "#caa58a", "#4b413b", 1.02],
    routine: [380, 1350, 480, 1150],
  },
  {
    id: "r_eve",
    name: "伊芙",
    age: 24,
    pronouns: "她",
    jobTitle: "无人机操作员",
    factionId: "corp",
    home: "b_home_dock",
    work: "b_utility",
    workSkill: "驾驶",
    personality: {
      traits: [83, 52, 71, 58, 49],
      labels: ["好奇", "冒险", "怕被困住"],
      values: ["自由", "探索", "真实"],
    },
    backstory: "企业无人机巡检员，私下改装了一架无人机，用来寻找城市边缘还没有被标注的地方。",
    wealth: 112,
    health: 84,
    mood: 69,
    stress: 38,
    needs: [33, 57, 41, 62],
    goals: [
      { title: "找到旧港区地图之外的城市区域", description: "公司地图在那里留了一片空白。", priority: 8 },
      { title: "攒钱买下自己改装的那架无人机", description: "公司迟早会发现资产编号被改过。", priority: 7, deadline: 28 },
    ],
    bonds: [
      { target: "r_qiye", type: "friend", familiarity: 57, affinity: 39, trust: 48, attraction: 26, notes: ["安保队的同乡，偶尔替她打掩护"] },
      { target: "r_guqing", type: "friend", familiarity: 60, affinity: 34, trust: 53, notes: ["物流调度搭档，关系不错"] },
      { target: "r_k9", type: "acquaintance", familiarity: 32, affinity: 27, trust: 16, notes: ["给无人机改装过信号模块"] },
    ],
    memories: [
      { text: "旧港区地图外出现了持续三分钟的热源信号。", kind: "observation", importance: 7 },
      { text: "顾青答应帮她留一批无人机电池。", kind: "promise", importance: 4, subjects: ["r_guqing"] },
    ],
    appearance: ["#222a46", "#7f9dff", "#e9c5a3", "#704939", 0.97],
    routine: [450, 1430, 600, 1080],
  },
  {
    id: "r_laotao",
    name: "老陶",
    age: 52,
    pronouns: "他",
    jobTitle: "街区厨师",
    factionId: "free",
    home: "b_home_rain",
    work: "b_noodle",
    workSkill: "烹饪",
    personality: {
      traits: [46, 72, 65, 85, 44],
      labels: ["热心", "念旧", "爱唠叨"],
      values: ["体面", "热饭", "街坊"],
    },
    backstory: "面馆开了二十七年，熬过两次骚乱、一次断粮和一场火灾。对他来说，账本上最重要的永远是赊账名单。",
    wealth: 61,
    health: 69,
    mood: 66,
    stress: 34,
    needs: [38, 49, 66, 63],
    goals: [
      { title: "让面馆永远不会熄灯", description: "维持食物储备和能源供应，哪怕经济再差。", priority: 8 },
      { title: "帮唐糖存够离开地下网络的钱", description: "她还年轻，不该一辈子替幽网跑腿。", priority: 7 },
    ],
    bonds: [
      { target: "r_heiyan", type: "partner", familiarity: 91, affinity: 81, trust: 88, intimacy: 76, attraction: 57, notes: ["同居十二年"] },
      { target: "r_tang", type: "family", familiarity: 86, affinity: 77, trust: 73, intimacy: 62, notes: ["侄女，从小在面馆后厨长大"] },
      { target: "r_akui", type: "acquaintance", familiarity: 55, affinity: 38, trust: 46, notes: ["夜里常来吃面"] },
      { target: "r_chenmo", type: "acquaintance", familiarity: 48, affinity: 35, trust: 44 },
    ],
    memories: [
      { text: "今天又有人用一枚坏掉的义体零件换了一碗面。", kind: "action", importance: 3 },
      { text: "唐糖说她可能要离开第七码头。", kind: "social", importance: 6, subjects: ["r_tang"] },
    ],
    appearance: ["#3a2a24", "#ffcf6a", "#c79b7d", "#bfb6a7", 0.95],
    routine: [420, 1450, 600, 1380],
  },
  {
    id: "r_k9",
    name: "K-9",
    age: 29,
    pronouns: "TA",
    jobTitle: "义体改装师",
    factionId: "void",
    home: "b_home_hive",
    work: "b_workshop",
    workSkill: "改装",
    personality: {
      traits: [72, 49, 31, 44, 57],
      labels: ["独立", "毒舌", "手很稳"],
      values: ["手艺", "不被追债", "少说多做"],
    },
    backstory: "给自己装过三根额外神经接口的前企业技师。离开公司时带走了一整箱本该销毁的零件。",
    wealth: 92,
    health: 61,
    mood: 53,
    stress: 64,
    needs: [44, 41, 29, 60],
    goals: [
      { title: "还清欠幽网的一笔改装债务", description: "对方的耐心正在耗尽。", priority: 9, deadline: 22 },
      { title: "做出不依赖企业零件的神经接驳件", description: "如果成功，很多人就不必再向公司低头。", priority: 8 },
    ],
    bonds: [
      { target: "r_ningchuan", type: "close_friend", familiarity: 81, affinity: 66, trust: 78, intimacy: 41, notes: ["老宁是唯一不催他交活的人"] },
      { target: "r_linlan", type: "acquaintance", familiarity: 47, affinity: 23, trust: 38, notes: ["工坊同事"] },
      { target: "r_sable", type: "acquaintance", familiarity: 39, affinity: -8, trust: 14, hostility: 15, notes: ["借贷中间人，最好不要有把柄落在TA手上"] },
    ],
    secrets: [{ text: "TA偷走的零件箱里藏着一份企业神经实验名单。", importance: 9 }],
    memories: [
      { text: "幽网的人第七次来工坊催债。", kind: "trauma", importance: 8 },
      { text: "老宁建议TA把债务公开给互助站。", kind: "social", importance: 5, subjects: ["r_ningchuan"] },
    ],
    appearance: ["#1d2935", "#a48aff", "#bfa08a", "#584cff", 1.0],
    routine: [500, 1520, 660, 1300],
  },
  {
    id: "r_suhe",
    name: "苏禾",
    age: 30,
    pronouns: "她",
    jobTitle: "城市记者",
    factionId: "void",
    home: "b_home_rain",
    work: "b_office",
    workSkill: "调查",
    personality: {
      traits: [85, 63, 58, 52, 65],
      labels: ["怀疑", "执着", "不擅长停下来"],
      values: ["真相", "公开", "让沉默的人被听见"],
    },
    backstory: "独立调查记者，靠一篇关于潮汐站事故的报道成名，也因此被企业列入重点关注名单。",
    wealth: 67,
    health: 71,
    mood: 57,
    stress: 73,
    needs: [46, 39, 52, 44],
    goals: [
      { title: "公开新纪元科技能源调度数据中的异常", description: "找到能验证数据的第二个信源。", priority: 10 },
      { title: "修复与阿葵之间脆弱的信任", description: "上一次交易她没能兑现承诺。", priority: 5 },
    ],
    bonds: [
      { target: "r_akui", type: "acquaintance", familiarity: 52, affinity: 23, trust: 26, notes: ["信息来源，但两人都留了一手"] },
      { target: "r_zhouyi", type: "rival", familiarity: 33, affinity: -17, trust: -12, hostility: 21, notes: ["可能掌握关键信息的企业高层"] },
      { target: "r_sable", type: "acquaintance", familiarity: 29, affinity: 8, trust: 12 },
    ],
    secrets: [{ text: "她已经拿到一份企业能源调度表的副本，但还没有验证来源。", importance: 9 }],
    memories: [
      { text: "匿名线人发来一份能源调度表副本。", kind: "observation", importance: 9 },
      { text: "阿葵答应带她去见幽网节点的人，但临时爽约。", kind: "conflict", importance: 5, subjects: ["r_akui"] },
    ],
    appearance: ["#253246", "#a48aff", "#e3b797", "#2b2320", 0.94],
    routine: [460, 1460, 660, 1260],
  },
  {
    id: "r_guqing",
    name: "顾青",
    age: 38,
    pronouns: "他",
    jobTitle: "物流调度员",
    factionId: "corp",
    home: "b_home_harbor",
    work: "b_market",
    workSkill: "物流",
    personality: {
      traits: [54, 88, 41, 63, 47],
      labels: ["守序", "精确", "怕失去控制"],
      values: ["承诺", "稳定", "准时"],
    },
    backstory: "负责第七码头物流网络的调度员。他能在凌晨三点找到任何一批丢失的货，却找不回已经结束的感情。",
    wealth: 156,
    health: 76,
    mood: 55,
    stress: 58,
    needs: [40, 54, 33, 65],
    goals: [
      { title: "维持城市供应链稳定", description: "在涨价和短缺之间找到平衡。", priority: 8 },
      { title: "与江雨把话说清楚", description: "关于那场没有结尾的分手。", priority: 6 },
    ],
    bonds: [
      { target: "r_jiangyu", type: "ex_partner", familiarity: 74, affinity: 9, trust: 28, intimacy: 42, attraction: 33, hostility: 12, notes: ["三年前分开，但仍有未说完的话"] },
      { target: "r_eve", type: "friend", familiarity: 61, affinity: 36, trust: 57, notes: ["物流搭档，愿意替她兜几个小错"] },
      { target: "r_zhouyi", type: "rival", familiarity: 55, affinity: -19, trust: 3, hostility: 30, notes: ["竞争同一个晋升名额"] },
      { target: "r_tang", type: "acquaintance", familiarity: 43, affinity: 27, trust: 38, notes: ["市场的摊主，账目很清楚"] },
    ],
    memories: [
      { text: "一批医疗物资在运输途中消失了，编号被人改过。", kind: "observation", importance: 7 },
      { text: "江雨在剧场门口看了他一眼，没有说话。", kind: "social", importance: 4, subjects: ["r_jiangyu"] },
    ],
    appearance: ["#1c3039", "#5aa7ff", "#d4ad8c", "#1f242a", 1.06],
    routine: [400, 1380, 510, 1100],
  },
  {
    id: "r_xiaoman",
    name: "小满",
    age: 19,
    pronouns: "她",
    jobTitle: "社区学生志愿者",
    factionId: "free",
    home: "b_home_dock",
    work: "b_community",
    workSkill: "互助",
    personality: {
      traits: [79, 56, 62, 81, 38],
      labels: ["乐观", "冲动", "相信明天"],
      values: ["朋友", "吃饱饭", "世界会变好"],
    },
    backstory: "在码头长大的学生，课余时间几乎都待在互助站。她记得每个邻居不吃什么，却总忘记自己的作业。",
    wealth: 23,
    health: 91,
    mood: 78,
    stress: 26,
    needs: [41, 72, 58, 77],
    goals: [
      { title: "帮互助站建立一份完整的居民需求清单", description: "让每一份配给都送到真正需要的人手里。", priority: 7 },
      { title: "攒钱报考城市学院", description: "学费贵得离谱，但不是完全不可能。", priority: 6 },
    ],
    bonds: [
      { target: "r_yoyo", type: "close_friend", familiarity: 83, affinity: 71, trust: 78, intimacy: 57, notes: ["从小学起就是朋友"] },
      { target: "r_chenmo", type: "acquaintance", familiarity: 42, affinity: 39, trust: 46, notes: ["诊所志愿者"] },
      { target: "r_tang", type: "friend", familiarity: 59, affinity: 43, trust: 51, notes: ["市场认识的姐姐"] },
      { target: "r_jiangyu", type: "acquaintance", familiarity: 31, affinity: 33, trust: 27, notes: ["剧场里见过几次"] },
    ],
    memories: [
      { text: "互助站收到一批没有署名的食物捐助。", kind: "gift", importance: 5 },
      { text: "悠悠说如果有钱，想带她去看企业区的天空花园。", kind: "social", importance: 4, subjects: ["r_yoyo"] },
    ],
    appearance: ["#2d3328", "#8fffc8", "#ddb18d", "#4b2b23", 0.88],
    routine: [420, 1370, 510, 1120],
  },
  {
    id: "r_jiangyu",
    name: "江雨",
    age: 27,
    pronouns: "她",
    jobTitle: "全息艺术家",
    factionId: "free",
    home: "b_home_neon",
    work: "b_theater",
    workSkill: "艺术",
    personality: {
      traits: [92, 43, 67, 60, 72],
      labels: ["敏感", "浪漫", "不擅长告别"],
      values: ["美", "记忆", "不被复制的感受"],
    },
    backstory: "用回收的全息广告拼贴城市记忆的艺术家。她的作品里反复出现同一个雨夜，却从不解释。",
    wealth: 48,
    health: 79,
    mood: 62,
    stress: 51,
    needs: [53, 58, 39, 58],
    goals: [
      { title: "完成《雨夜档案》全息展", description: "记录第七码头正在消失的旧建筑。", priority: 9 },
      { title: "弄清楚自己还想不想和顾青重新开始", description: "有些感情只剩回声。", priority: 5 },
    ],
    bonds: [
      { target: "r_guqing", type: "ex_partner", familiarity: 78, affinity: 21, trust: 31, intimacy: 47, attraction: 42, hostility: 8, notes: ["三年没联系，最近又开始在剧场遇见"] },
      { target: "r_linlan", type: "acquaintance", familiarity: 31, affinity: 28, trust: 24, attraction: 15, notes: ["总是来修剧场的投影仪"] },
      { target: "r_xiaoman", type: "acquaintance", familiarity: 27, affinity: 37, trust: 29 },
      { target: "r_suhe", type: "acquaintance", familiarity: 25, affinity: 19, trust: 17 },
    ],
    secrets: [{ text: "她的《雨夜档案》里藏着一张未经许可拍摄的企业区影像。", importance: 8, subjectId: "b_lab" }],
    memories: [
      { text: "全息投影在演出中途熄灭，观众却留下来陪她聊到天亮。", kind: "social", importance: 7 },
      { text: "顾青在市场门口看了她很久，最后什么也没说。", kind: "romance", importance: 5, subjects: ["r_guqing"] },
    ],
    appearance: ["#2f2436", "#ff7ac8", "#d8ad97", "#6b4b6d", 0.96],
    routine: [520, 1500, 720, 1300],
  },
  {
    id: "r_mozi",
    name: "墨子",
    age: 33,
    pronouns: "她",
    jobTitle: "神经接口研究员",
    factionId: "corp",
    home: "b_home_harbor",
    work: "b_lab",
    workSkill: "科研",
    personality: {
      traits: [88, 71, 36, 57, 63],
      labels: ["理性", "隐秘地温柔", "过度自省"],
      values: ["知识", "自由意志", "不做替罪羊"],
    },
    backstory: "神经实验室的核心研究员，研究如何让义体反馈更接近真实触觉。她知道项目背后有一份不被公开的名单。",
    wealth: 198,
    health: 74,
    mood: 58,
    stress: 69,
    needs: [38, 48, 32, 59],
    goals: [
      { title: "查清神经实验名单的用途", description: "周弈一定知道些什么。", priority: 9 },
      { title: "完成触觉反馈原型", description: "如果成功，义体使用者至少能重新感觉到雨。", priority: 8 },
    ],
    bonds: [
      { target: "r_zhouyi", type: "friend", familiarity: 70, affinity: 48, trust: 43, attraction: 34, intimacy: 36, notes: ["彼此试探，又彼此需要"] },
      { target: "r_qiye", type: "rival", familiarity: 44, affinity: -6, trust: 19, hostility: 17, notes: ["安保部门盯着她的实验数据"] },
      { target: "r_chenmo", type: "acquaintance", familiarity: 30, affinity: 31, trust: 29 },
    ],
    secrets: [{ text: "她偷偷复制了一份神经实验名单，但还没敢打开。", importance: 10 }],
    memories: [
      { text: "实验室的服务器里出现了一个不属于任何项目的文件夹。", kind: "observation", importance: 8 },
      { text: "周弈约她下周三班后喝一杯。", kind: "romance", importance: 5, subjects: ["r_zhouyi"] },
    ],
    appearance: ["#1d2f3b", "#7cd8ff", "#e0b696", "#2c3e54", 0.99],
    routine: [430, 1480, 600, 1240],
  },
  {
    id: "r_tang",
    name: "唐糖",
    age: 22,
    pronouns: "她",
    jobTitle: "夜市摊主",
    factionId: "free",
    home: "b_home_rain",
    work: "b_market",
    workSkill: "经营",
    personality: {
      traits: [66, 59, 81, 70, 48],
      labels: ["爽快", "好胜", "藏着心事"],
      values: ["独立", "家人", "不再欠任何人"],
    },
    backstory: "老陶的侄女。白天看店，晚上替幽网传递不需要记名的小物件。她一直没告诉叔叔自己欠了谁的钱。",
    wealth: 42,
    health: 83,
    mood: 63,
    stress: 49,
    needs: [45, 62, 55, 51],
    goals: [
      { title: "还清欠幽网的钱并退出", description: "不想再替任何人带东西穿过夜路。", priority: 8 },
      { title: "让老陶别再把面馆赊给还不起钱的人", description: "她担心叔叔会把自己也拖垮。", priority: 5 },
    ],
    bonds: [
      { target: "r_laotao", type: "family", familiarity: 89, affinity: 72, trust: 81, intimacy: 66, notes: ["叔叔，也是唯一的家人"] },
      { target: "r_akui", type: "friend", familiarity: 67, affinity: 45, trust: 51, intimacy: 30, notes: ["夜班后的面友，彼此知道对方的麻烦"] },
      { target: "r_xiaoman", type: "friend", familiarity: 60, affinity: 49, trust: 55, notes: ["常来摊上帮忙的学生"] },
      { target: "r_sable", type: "acquaintance", familiarity: 37, affinity: 4, trust: 11, hostility: 9, notes: ["债主，或者说债主的朋友"] },
    ],
    secrets: [{ text: "她替幽网运送的最后一个包裹没有送到，她把它藏了起来。", importance: 9 }],
    memories: [
      { text: "一个穿黑雨衣的人来摊位问包裹的下落。", kind: "trauma", importance: 8 },
      { text: "阿葵提醒她，幽网从不忘记一笔债。", kind: "social", importance: 6, subjects: ["r_akui"] },
    ],
    appearance: ["#362a2a", "#ffbb5a", "#e7be9c", "#7b3b3b", 0.91],
    routine: [540, 1460, 720, 1320],
  },
  {
    id: "r_heiyan",
    name: "黑岩",
    age: 41,
    pronouns: "他",
    jobTitle: "互助站保卫队长",
    factionId: "free",
    home: "b_home_rain",
    work: "b_community",
    workSkill: "安保",
    personality: {
      traits: [38, 81, 47, 72, 42],
      labels: ["沉稳", "护短", "厌倦暴力"],
      values: ["承诺", "街坊", "让人安全地睡一觉"],
    },
    backstory: "曾是企业安保，在一次清场行动中拒绝执行命令。现在他守着互助站的大门，也守着老陶的面馆。",
    wealth: 79,
    health: 70,
    mood: 67,
    stress: 43,
    needs: [49, 51, 60, 69],
    goals: [
      { title: "让第七码头不再发生暴力清场", description: "维持自治巡逻队，并建立企业与居民的谈判渠道。", priority: 9 },
      { title: "把老陶的面馆屋顶修好", description: "下一次酸雨之前。", priority: 4, deadline: 12 },
    ],
    bonds: [
      { target: "r_laotao", type: "partner", familiarity: 93, affinity: 84, trust: 90, intimacy: 79, attraction: 61, notes: ["共同生活十二年"] },
      { target: "r_chenmo", type: "close_friend", familiarity: 88, affinity: 74, trust: 86, intimacy: 48, notes: ["过命的交情"] },
      { target: "r_xiaoman", type: "friend", familiarity: 57, affinity: 52, trust: 61, notes: ["看着她长大"] },
      { target: "r_qiye", type: "rival", familiarity: 49, affinity: -10, trust: 8, hostility: 26, notes: ["过去在企业安保队共事，立场相反"] },
    ],
    memories: [
      { text: "昨晚又有人在公园围栏外打架，他拉开了两边。", kind: "action", importance: 4 },
      { text: "老陶说屋顶暂时不用修，先把钱留给面馆进货。", kind: "social", importance: 5, subjects: ["r_laotao"] },
    ],
    appearance: ["#2b2b35", "#5af2d0", "#b78f76", "#3c3c45", 1.08],
    routine: [360, 1390, 480, 1200],
  },
  {
    id: "r_sable",
    name: "塞布尔",
    age: 34,
    pronouns: "TA",
    jobTitle: "数据掮客",
    factionId: "void",
    home: "b_home_hive",
    work: "b_bar",
    workSkill: "谈判",
    personality: {
      traits: [74, 68, 64, 30, 55],
      labels: ["优雅", "危险", "只信交易"],
      values: ["筹码", "自由", "不站队"],
    },
    backstory: "在三个势力之间贩卖情报的中间人。TA有五个名字，没有一个是真名；有一间公寓，从没住满过一个月。",
    wealth: 287,
    health: 68,
    mood: 57,
    stress: 59,
    needs: [39, 49, 43, 61],
    goals: [
      { title: "同时掌握三大势力各一份把柄", description: "真正的中立必须建立在恐惧之上。", priority: 10 },
      { title: "找到一份能够安全脱身的身份", description: "总得给自己留条后路。", priority: 8 },
    ],
    bonds: [
      { target: "r_akui", type: "rival", familiarity: 64, affinity: -22, trust: 6, hostility: 31, notes: ["互相抢单，也互相试探"] },
      { target: "r_suhe", type: "acquaintance", familiarity: 38, affinity: 17, trust: 22, notes: ["潜在客户，也是潜在风险"] },
      { target: "r_k9", type: "acquaintance", familiarity: 41, affinity: -3, trust: 16, hostility: 12, notes: ["债主代表，关系微妙"] },
      { target: "r_tang", type: "acquaintance", familiarity: 34, affinity: 12, trust: 18, notes: ["知道她欠幽网的钱"] },
    ],
    secrets: [{ text: "TA同时为新纪元科技和幽网工作，两边都以为TA只忠于自己。", importance: 10 }],
    memories: [
      { text: "一份企业数据在交易前被截胡，来源指向幽网内部。", kind: "conflict", importance: 8 },
      { text: "阿葵在酒吧后巷警告TA别再靠近自己的线人。", kind: "conflict", importance: 6, subjects: ["r_akui"] },
    ],
    appearance: ["#261f35", "#c792ff", "#d8b79d", "#18141f", 1.0],
    routine: [560, 1540, 780, 1380],
  },
  {
    id: "r_ningchuan",
    name: "宁川",
    age: 58,
    pronouns: "他",
    jobTitle: "退休工程师",
    factionId: "free",
    home: "b_home_rain",
    work: "b_workshop",
    workSkill: "工程",
    personality: {
      traits: [69, 84, 33, 74, 36],
      labels: ["温和", "固执", "修旧如旧"],
      values: ["手艺", "耐心", "让东西再活一次"],
    },
    backstory: "修了四十年发电机，参与过潮汐站最初的建造，也亲眼看着它被企业接管。现在他只想把还能转的东西修好。",
    wealth: 73,
    health: 57,
    mood: 65,
    stress: 31,
    needs: [56, 44, 52, 66],
    goals: [
      { title: "把潮汐站原始设计图交到应该拿到它的人手里", description: "这份图纸能证明当年的事故不是意外。", priority: 9 },
      { title: "教出一个愿意留下来的徒弟", description: "手艺不能断在第七码头。", priority: 6 },
    ],
    bonds: [
      { target: "r_linlan", type: "friend", familiarity: 72, affinity: 55, trust: 70, intimacy: 33, notes: ["看到了年轻时的自己"] },
      { target: "r_k9", type: "close_friend", familiarity: 79, affinity: 58, trust: 74, intimacy: 40, notes: ["愿意等TA慢慢还债"] },
      { target: "r_suhe", type: "acquaintance", familiarity: 44, affinity: 34, trust: 38, notes: ["记者，问过潮汐站旧事"] },
    ],
    secrets: [{ text: "他保留了潮汐站事故的原始维护记录。", importance: 10, subjectId: "b_utility" }],
    memories: [
      { text: "潮汐站的原始设计图还藏在他床下的工具箱里。", kind: "observation", importance: 9 },
      { text: "林岚今天又来借工具，顺便带来了一碗面。", kind: "social", importance: 3, subjects: ["r_linlan"] },
    ],
    appearance: ["#2f302b", "#8fffc8", "#c7a284", "#c8c2b5", 0.98],
    routine: [350, 1320, 480, 1020],
  },
  {
    id: "r_yoyo",
    name: "悠游",
    age: 20,
    pronouns: "TA",
    jobTitle: "全息剧场学徒",
    factionId: "void",
    home: "b_home_dock",
    work: "b_theater",
    workSkill: "艺术",
    personality: {
      traits: [87, 42, 59, 66, 54],
      labels: ["松弛", "好奇", "不爱回家"],
      values: ["好故事", "自由", "朋友"],
    },
    backstory: "白天在剧场打杂，晚上在街头给人画会动的全息纹身。TA说自己是这座城市的游魂，哪儿亮就去哪儿。",
    wealth: 31,
    health: 85,
    mood: 71,
    stress: 37,
    needs: [44, 66, 62, 54],
    goals: [
      { title: "做一场属于自己的街头全息秀", description: "不用审批、不用企业赞助的那种。", priority: 7 },
      { title: "帮小满凑齐城市学院的报名费", description: "朋友不该因为钱留在这里。", priority: 6 },
    ],
    bonds: [
      { target: "r_xiaoman", type: "close_friend", familiarity: 85, affinity: 74, trust: 81, intimacy: 58, notes: ["从小学起就是朋友"] },
      { target: "r_jiangyu", type: "acquaintance", familiarity: 39, affinity: 46, trust: 33, notes: ["剧场前辈，很酷"] },
      { target: "r_akui", type: "acquaintance", familiarity: 34, affinity: 27, trust: 21 },
    ],
    memories: [
      { text: "江雨让TA试着操作整面全息墙，那一刻全家都安静了。", kind: "social", importance: 6, subjects: ["r_jiangyu"] },
      { text: "小满说如果有了钱，想带TA去看企业区的天空花园。", kind: "social", importance: 4, subjects: ["r_xiaoman"] },
    ],
    appearance: ["#2a2431", "#ff7ac8", "#d2a98b", "#4f6a70", 0.9],
    routine: [580, 1500, 660, 1380],
  },
  {
    id: "r_qiye",
    name: "祁夜",
    age: 36,
    pronouns: "他",
    jobTitle: "潮汐站安保主管",
    factionId: "corp",
    home: "b_home_harbor",
    work: "b_utility",
    workSkill: "安保",
    personality: {
      traits: [43, 75, 51, 49, 61],
      labels: ["警觉", "矛盾", "守规矩"],
      values: ["职责", "秩序", "不想再伤害任何人"],
    },
    backstory: "企业安保主管，负责潮汐站与能源调度中心。他执行命令，但开始怀疑命令的来源；他和伊芙是同乡，也欠黑岩一个人情。",
    wealth: 173,
    health: 81,
    mood: 52,
    stress: 65,
    needs: [47, 47, 41, 60],
    goals: [
      { title: "查明潮汐站事故档案为何被封存", description: "企业越不想让人看见的东西越值得怀疑。", priority: 8 },
      { title: "阻止下一次强制清场", description: "如果命令真的下来，他必须做出选择。", priority: 7 },
    ],
    bonds: [
      { target: "r_eve", type: "friend", familiarity: 58, affinity: 41, trust: 52, attraction: 31, notes: ["同乡，偶尔一起值夜班"] },
      { target: "r_heiyan", type: "rival", familiarity: 55, affinity: -6, trust: 15, hostility: 24, notes: ["昔日同事，现在立场不同"] },
      { target: "r_zhouyi", type: "acquaintance", familiarity: 43, affinity: 20, trust: 31, notes: ["上级，掌握了太多秘密"] },
      { target: "r_mozi", type: "rival", familiarity: 38, affinity: -3, trust: 20, hostility: 15, notes: ["被要求监视她的实验"] },
    ],
    memories: [
      { text: "周弈要求他删除一段能源调度异常记录。", kind: "conflict", importance: 8, subjects: ["r_zhouyi"] },
      { text: "伊芙开玩笑说，潮汐站底下有一扇不该存在的门。", kind: "social", importance: 4, subjects: ["r_eve"] },
    ],
    appearance: ["#1d2b35", "#59b8ff", "#c49a7d", "#202c2e", 1.03],
    routine: [360, 1420, 480, 1140],
  },
];

interface FactionSeed {
  id: string;
  name: string;
  kind: Faction["kind"];
  description: string;
  symbol: string;
  color: string;
  leaderId: string;
  funds: number;
  influence: number;
  resources: Faction["resources"];
  goals: string[];
  strategy: Faction["strategy"];
}

const FACTION_SEEDS: FactionSeed[] = [
  {
    id: "corp",
    name: "新纪元科技",
    kind: "corporation",
    description: "控制能源、数据和天空的企业联合体。它让城市保持运转，也让城市欠了它无法偿还的债。",
    symbol: "⌬",
    color: "#59b8ff",
    leaderId: "r_zhouyi",
    funds: 24800,
    influence: 58,
    resources: { food: 80, energy: 260, meds: 60 },
    goals: ["扩大能源控制范围", "压低声誉风险", "完成神经接口商业化"],
    strategy: "expand",
  },
  {
    id: "free",
    name: "自由港社区",
    kind: "community",
    description: "居民自发组成的自治网络。它没有总部，只有一张张愿意在深夜开门的餐桌。",
    symbol: "⌂",
    color: "#5af2d0",
    leaderId: "r_chenmo",
    funds: 4200,
    influence: 34,
    resources: { food: 180, energy: 80, meds: 40 },
    goals: ["维持基础物资供应", "阻止企业强制清场", "扩大互助网络"],
    strategy: "mutual_aid",
  },
  {
    id: "void",
    name: "幽网",
    kind: "underground",
    description: "由信使、掮客和黑客组成的松散地下网络。没有章程，只有一条规矩：信息必须流动。",
    symbol: "⌁",
    color: "#d36bff",
    leaderId: "r_akui",
    funds: 6800,
    influence: 27,
    resources: { food: 30, energy: 40, meds: 65 },
    goals: ["扩大无监控信息通道", "削弱企业监控网络", "保护成员身份"],
    strategy: "undermine",
  },
];

const INITIAL_RESERVES = { credits: 4200, food: 214, energy: 398, meds: 112 };

export function createInitialWorld(options?: {
  seed?: number;
  name?: string;
  worldId?: string;
  createdAtIso?: string;
}): WorldState {
  const seed = (options?.seed ?? makeSeed()) >>> 0;
  const rng = new Rng(seed);
  const now = new Date();
  const createdAtIso = options?.createdAtIso ?? now.toISOString();
  const clock = {
    tick: 0,
    day: 1,
    minuteOfDay: DAY_START_MINUTE,
  };

  const buildings = BUILDING_SEEDS.map((seedBuilding) => buildBuilding(seedBuilding, rng));
  const buildingMap = new Map(buildings.map((building) => [building.id, building]));
  const residents = RESIDENT_SEEDS.map((residentSeed) => buildResident(residentSeed, buildingMap, clock.tick));
  const factions = FACTION_SEEDS.map((factionSeed) =>
    buildFaction(factionSeed, residents, buildings),
  );

  const world: WorldState = {
    schemaVersion: SCHEMA_VERSION,
    worldId: options?.worldId ?? `world-${seed.toString(16)}-${Math.floor(rng.next() * 0xffff).toString(16)}`,
    name: options?.name ?? "霓虹湾 · 第七码头",
    seed,
    ruleVersion: RULE_VERSION,
    rngState: rng.state,
    clock,
    weather: { condition: "rain", intensity: 0.35, untilTick: 8 },
    rules: { ...DEFAULT_RULES },
    reserves: { ...INITIAL_RESERVES },
    metrics: {
      stability: 66,
      pollution: 41,
      trust: 52,
      inequality: 47,
      resourceSupply: 63,
      averageMood: 63,
      averageWealth: 94,
      population: residents.length,
    },
    buildings,
    residents,
    factions,
    events: [],
    history: [],
    initialResidentIds: residents.map((resident) => resident.id),
    createdAtIso,
    lastAiEventTick: -999,
  };

  world.history.push(snapshotMetrics(world));
  seedInitialEvents(world, rng);

  // Recompute exact aggregate metrics once from the freshly generated world.
  world.metrics.population = residents.filter((resident) => resident.alive).length;
  world.metrics.averageMood = Math.round(average(residents.map((r) => r.mood)));
  world.metrics.averageWealth = Math.round(average(residents.map((r) => r.wealth)));
  world.metrics.inequality = computeInequality(residents.map((r) => r.wealth));
  world.rngState = rng.state;

  return world;
}

function buildBuilding(seed: BuildingSeed, rng: Rng): Building {
  const palette = ["#5af2d0", "#ff4fa3", "#a48aff", "#ffcf6a", "#59b8ff"];
  const defaultInventory: Building["inventory"] = {
    food: 0,
    meds: 0,
    energy: 0,
    credits: 0,
  };
  return {
    id: seed.id,
    name: seed.name,
    type: seed.type,
    description: seed.description,
    x: seed.x,
    z: seed.z,
    w: seed.w,
    d: seed.d,
    rotation: 0,
    capacity: seed.capacity,
    ownerFactionId: seed.ownerFactionId,
    ownerResidentId: null,
    condition: seed.condition ?? rng.int(68, 98),
    operational: true,
    open: true,
    inventory: { ...defaultInventory, ...seed.inventory },
    recentVisits: [],
    neonColor: seed.neonColor || palette[rng.int(0, palette.length - 1)]!,
    openAir: seed.openAir ?? false,
    emissions: seed.emissions ?? 0.3,
    lastServicedDay: 1,
    income: 0,
    expenses: 0,
  };
}

function buildFaction(seed: FactionSeed, residents: Resident[], buildings: Building[]): Faction {
  const leader = residents.find((resident) => resident.id === seed.leaderId);
  const relations: Faction["relations"] = {};
  for (const other of FACTION_SEEDS) {
    if (other.id === seed.id) continue;
    const pair = [seed.id, other.id].sort().join("_");
    const preset =
      pair === "corp_free"
        ? { affinity: -18, hostility: 29, status: "competing" as const }
        : pair === "corp_void"
          ? { affinity: -27, hostility: 38, status: "hostile" as const }
          : { affinity: 21, hostility: 8, status: "cooperating" as const };
    relations[other.id] = { ...preset };
  }
  return {
    id: seed.id,
    name: seed.name,
    kind: seed.kind,
    description: seed.description,
    symbol: seed.symbol,
    color: seed.color,
    leaderId: leader?.id ?? seed.leaderId,
    memberIds: residents
      .filter((resident) => resident.factionId === seed.id)
      .map((resident) => resident.id),
    funds: seed.funds,
    influence: seed.influence,
    resources: { ...seed.resources },
    goals: [...seed.goals],
    strategy: seed.strategy,
    relations,
    lastActionTick: -99,
  };
}

function buildResident(seed: ResidentSeed, buildings: Map<string, Building>, tick: number): Resident {
  const home = buildings.get(seed.home);
  const work = buildings.get(seed.work);
  if (!home || !work) throw new Error(`Invalid building reference for resident ${seed.id}`);
  const door = { x: home.x + Math.floor(home.w / 2), z: home.z + home.d };
  const skillsBase = seed.personality.traits;
  const skills: Record<string, number> = {
    [seed.workSkill]: Math.min(95, 42 + Math.round((skillsBase[0] + skillsBase[1]) / 4) + (seed.age > 35 ? 12 : 0)),
    体力: Math.min(95, 35 + skillsBase[1] / 2),
    社交: Math.min(95, 20 + skillsBase[2] / 2),
  };
  const [bodyColor, accentColor, skinColor, hairColor, heightScale] = seed.appearance;
  const relationships: Record<string, Relationship> = {};
  for (const bond of seed.bonds) {
    relationships[bond.target] = makeRelationship(bond);
  }
  const goals: Goal[] = seed.goals.map((goal, index) => ({
    id: `${seed.id}-goal-${index + 1}`,
    kind: index === 0 ? "long" : "short",
    title: goal.title,
    description: goal.description,
    priority: goal.priority,
    progress: 0,
    status: "active",
    createdDay: 1,
    deadlineDay: goal.deadline,
    source: "personality",
  }));

  const recent: Memory[] = [];
  const important: Memory[] = [];
  if (seed.memories) {
    for (const [index, memory] of seed.memories.entries()) {
      const record = makeMemory(
        `${seed.id}-seed-memory-${index + 1}`,
        memory.text,
        index === seed.memories!.length - 1 ? tick : tick - 2 - index,
        1,
        memory.kind,
        memory.importance,
        memory.subjects ?? [],
        0,
        hashString(seed.id + memory.text) % 3 === 0 ? "told" : "experienced",
      );
      if (memory.importance >= 6) important.push(record);
      else recent.push(record);
    }
  }
  if (recent.length === 0) {
    recent.push(
      makeMemory(
        `${seed.id}-seed-default`,
        `${seed.jobTitle}的一天开始了，霓虹湾像往常一样潮湿、明亮。`,
        tick,
        1,
        "observation",
        2,
        [],
        0,
        "experienced",
      ),
    );
  }

  const secrets: Secret[] = (seed.secrets ?? []).map((secret, index) => ({
    id: `${seed.id}-secret-${index + 1}`,
    text: secret.text,
    knownBy: [seed.id],
    importance: secret.importance,
    subjectId: secret.subjectId,
  }));

  const routine = seed.routine ?? [390, 1380, 540, 1080];

  return {
    id: seed.id,
    name: seed.name,
    age: seed.age,
    pronouns: seed.pronouns,
    jobTitle: seed.jobTitle,
    factionId: seed.factionId,
    homeBuildingId: seed.home,
    workBuildingId: seed.work,
    workSkill: seed.workSkill,
    personality: {
      traits: {
        openness: seed.personality.traits[0],
        conscientiousness: seed.personality.traits[1],
        extraversion: seed.personality.traits[2],
        agreeableness: seed.personality.traits[3],
        neuroticism: seed.personality.traits[4],
      },
      labels: [...seed.personality.labels],
      values: [...seed.personality.values],
    },
    backstory: seed.backstory,
    skills,
    wealth: seed.wealth,
    health: seed.health,
    mood: seed.mood,
    stress: seed.stress,
    needs: {
      hunger: seed.needs[0],
      energy: seed.needs[1],
      social: seed.needs[2],
      safety: seed.needs[3],
    },
    reputation: Math.round(seed.personality.traits[3] * 0.7),
    position: { x: door.x, z: door.z },
    facing: Math.PI,
    insideBuildingId: null,
    currentAction: null,
    aiHint: null,
    relationships,
    memories: {
      recent: recent.slice(0, 8),
      important: important.slice(0, 8),
      longTerm: [`${seed.name}在第七码头生活了多年，维持着${seed.jobTitle}的工作。`],
    },
    impressions: {},
    goals,
    secrets,
    promises: [],
    history: [],
    lifeEvents: [],
    routine: {
      wakeMinute: routine[0],
      sleepMinute: routine[1],
      workStartMinute: routine[2],
      workEndMinute: routine[3],
    },
    appearance: {
      bodyColor,
      accentColor,
      skinColor,
      hairColor,
      heightScale,
      seed: hashString(seed.id),
    },
    alive: true,
    paused: false,
    lastDecisionTick: -999,
    createdAtTick: tick,
  };
}

function makeRelationship(bond: BondSeed): Relationship {
  return {
    residentId: bond.target,
    familiarity: bond.familiarity,
    affinity: bond.affinity,
    trust: bond.trust,
    intimacy: bond.intimacy ?? Math.round(bond.familiarity * 0.35),
    attraction: bond.attraction ?? 0,
    hostility: bond.hostility ?? 0,
    type: bond.type,
    sinceDay: 1,
    lastInteractionDay: 1,
    interactions: Math.max(1, Math.round(bond.familiarity / 12)),
    notes: bond.notes ? [...bond.notes] : [],
  };
}

function makeMemory(
  id: string,
  text: string,
  tick: number,
  day: number,
  kind: MemoryKind,
  importance: number,
  subjectIds: string[],
  valence: number,
  source: Memory["source"],
): Memory {
  const safeTick = Math.max(0, tick);
  const minuteOfDay = (DAY_START_MINUTE + safeTick * 30) % 1440;
  return {
    id,
    tick: safeTick,
    day,
    minuteOfDay,
    kind,
    text,
    subjectIds,
    importance,
    valence,
    source,
    reliability: source === "told" ? 0.65 : source === "inferred" ? 0.5 : 0.95,
    recalledAtTick: tick,
  };
}

function seedInitialEvents(world: WorldState, rng: Rng): void {
  const initialEvents: Array<Omit<GameEvent, "id" | "tick" | "day" | "minuteOfDay">> = [
    {
      type: "system",
      title: "观测系统上线",
      description: "霓虹湾第七码头进入造物主观测范围。18 名居民、20 座建筑与 3 个势力已载入模拟。",
      source: "system",
      importance: 5,
      tag: "SYSTEM",
    },
    {
      type: "info",
      title: "酸雨预警",
      description: "气象站预计酸雨将持续到今晚，户外的能源设备维护成本会上升。",
      source: "world",
      importance: 3,
      tag: "WEATHER",
    },
    {
      type: "faction",
      title: "三方势力维持脆弱平衡",
      description: "新纪元科技控制能源节点，自由港社区拥有广泛的居民支持，幽网则掌握着非正式信息渠道。",
      source: "faction",
      importance: 4,
      tag: "FACTIONS",
    },
  ];
  for (const [index, event] of initialEvents.entries()) {
    world.events.push({
      ...event,
      id: `initial-event-${index + 1}`,
      tick: 0,
      day: 1,
      minuteOfDay: DAY_START_MINUTE,
    });
  }
  // A tiny first-day variation makes new worlds feel alive without changing balance.
  if (rng.chance(0.5)) {
    world.events.push({
      id: "initial-event-rumor",
      tick: 0,
      day: 1,
      minuteOfDay: DAY_START_MINUTE,
      type: "warn",
      title: "夜间传闻",
      description: "有人在市场里说，潮汐站最近总在凌晨输出异常电流。",
      source: "world",
      importance: 2,
      tag: "RUMOR",
    });
  }
}

function snapshotMetrics(world: WorldState): WorldHistoryPoint {
  return {
    tick: world.clock.tick,
    day: world.clock.day,
    minuteOfDay: world.clock.minuteOfDay,
    metrics: { ...world.metrics },
    reserves: { ...world.reserves },
    population: world.residents.filter((resident) => resident.alive).length,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeInequality(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i]!;
  const gini = (2 * weighted) / (n * sum) - (n + 1) / n;
  return Math.round(Math.min(1, Math.max(0, gini)) * 100);
}

export const INITIAL_BUILDING_IDS = BUILDING_SEEDS.map((building) => building.id);
export const INITIAL_RESIDENT_IDS = RESIDENT_SEEDS.map((resident) => resident.id);
export const INITIAL_FACTION_IDS = FACTION_SEEDS.map((faction) => faction.id);
export { average, computeInequality };
