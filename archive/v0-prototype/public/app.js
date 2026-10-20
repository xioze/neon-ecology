(() => {
  "use strict";

  const SAVE_KEY = "neon-ecology-save-v1";
  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  let timer = null;
  let paused = false;
  let advancing = false;
  let selectedResidentId = null;
  let aiEnabled = true;
  let detailEnabled = true;
  let mode = "offline";
  let toastTimer = null;

  const initialState = () => ({
    version: 1, day: 1, seed: 1847,
    resources: { money: 420, food: 180, energy: 210, meds: 64 },
    metrics: { stability: 68, pollution: 42, trust: 51 },
    factions: [
      { id: "corp", name: "新纪元科技", subtitle: "大型科技企业", symbol: "⌬", influence: 48, color: "cyan", aim: "控制能源与城市基础设施" },
      { id: "free", name: "自由港社区", subtitle: "自治社区", symbol: "⌂", influence: 32, color: "pink", aim: "保障居民自治与基本生活" },
      { id: "void", name: "幽网", subtitle: "地下信息网络", symbol: "⌁", influence: 20, color: "purple", aim: "掌握情报并削弱监控" }
    ],
    residents: [
      resident("r01","林岚","维修技师","free","务实","修复社区能源网，避免停电。",{money:28,food:15,energy:8,meds:2}),
      resident("r02","周弈","企业分析师","corp","谨慎","积累信用点并提升企业影响力。",{money:62,food:10,energy:6,meds:1}),
      resident("r03","阿葵","地下信使","void","机敏","传递情报，保护幽网的消息渠道。",{money:35,food:8,energy:4,meds:3}),
      resident("r04","陈默","社区医生","free","仁慈","确保弱势居民获得医疗物资。",{money:20,food:12,energy:5,meds:15}),
      resident("r05","伊芙","无人机操作员","corp","好奇","探索城区并寻找可交易的稀缺资源。",{money:44,food:9,energy:12,meds:2}),
      resident("r06","老陶","街区厨师","free","热心","让社区食物储备保持安全水平。",{money:18,food:25,energy:3,meds:1}),
      resident("r07","K-9","义体改装师","void","独立","获取能源与零件，维持工作室运转。",{money:39,food:7,energy:10,meds:4}),
      resident("r08","苏禾","城市记者","void","怀疑","调查企业行为并提高公众知情度。",{money:31,food:11,energy:4,meds:2}),
      resident("r09","顾青","物流调度员","corp","守序","维持供应链，降低城市运行风险。",{money:48,food:13,energy:7,meds:3}),
      resident("r10","小满","学生","free","乐观","寻找稳定的食物来源并帮助邻居。",{money:12,food:10,energy:2,meds:1})
    ],
    events: [
      { day: 1, type: "system", title: "观测系统已启动", desc: "霓虹湾第七码头进入观测状态。所有居民均已登记，城市模拟引擎在线。", tag: "SYSTEM" },
      { day: 1, type: "info", title: "凌晨的酸雨", desc: "气象站预测今晚将出现低强度酸雨，户外设备维护成本可能上升。", tag: "ENVIRONMENT" },
      { day: 1, type: "info", title: "三方势力维持脆弱平衡", desc: "新纪元科技控制着大部分能源节点，自由港社区拥有广泛的居民支持，幽网则掌握着非正式信息渠道。", tag: "FACTIONS" }
    ],
    history: [],
    lastReport: "世界初始化完成。"
  });

  function resident(id, name, job, faction, personality, goal, resources) {
    return { id, name, job, faction, personality, goal, resources, trust: {}, memory: ["城市观测开始前，生活仍在继续。"], alive: true };
  }

  let state = initialState();

  function rngForDay() {
    // A tiny deterministic PRNG: replaying the same saved state yields the same local choices.
    let x = state.seed >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      state.seed = x;
      return x / 4294967296;
    };
  }

  function addEvent(type, title, desc, tag) {
    state.events.unshift({ day: state.day, type, title, desc, tag: tag || type.toUpperCase() });
    state.events = state.events.slice(0, 60);
  }

  function remember(r, text) {
    r.memory.unshift(text);
    r.memory = r.memory.slice(0, 5);
  }

  function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function validateProposal(p, residents) {
    if (!p || typeof p !== "object") return null;
    const r = residents.find(x => x.id === String(p.residentId || ""));
    const allowed = ["work", "trade", "share", "ally", "spread_rumor", "ask_help", "hoard"];
    if (!r || !allowed.includes(p.action)) return null;
    const target = String(p.target || "").slice(0, 60);
    const reason = String(p.reason || "尝试改善自己的处境。").slice(0, 100);
    return { residentId: r.id, action: p.action, target, reason };
  }

  function applyProposal(proposal, rng) {
    const r = state.residents.find(x => x.id === proposal.residentId);
    if (!r || !r.alive) return { ok: false, message: "居民不存在或已离开城市。" };
    const resources = state.resources;
    const own = r.resources;
    const targetResident = state.residents.find(x => x.id === proposal.target && x.id !== r.id);
    const targetFaction = state.factions.find(x => x.id === proposal.target);
    let title = "", desc = "", type = "info";

    switch (proposal.action) {
      case "work": {
        const earned = 4 + Math.floor(rng() * 8);
        own.money += earned;
        resources.money += earned;
        if (r.job.includes("维修") || r.job.includes("改装")) resources.energy = Math.max(0, resources.energy - 2);
        title = `${r.name}完成了一次工作委托`;
        desc = `${proposal.reason} 获得 ${earned} 信用点。`;
        break;
      }
      case "trade": {
        const choices = ["food", "energy", "meds"];
        const key = pick(choices, rng);
        const cost = Math.min(4 + Math.floor(rng() * 5), Math.max(0, own.money));
        if (cost < 2) return applyFallbackWork(r, rng, "资金不足，交易提案被拒绝，转为普通工作。");
        own.money -= cost; resources.money = Math.max(0, resources.money - cost);
        own[key] = (own[key] || 0) + 2; resources[key] += 2;
        title = `${r.name}完成了一笔街区交易`;
        desc = `${proposal.reason} 用 ${cost} 信用点换取了少量${resourceName(key)}。`;
        break;
      }
      case "share": {
        if (targetResident) {
          const key = pick(["food", "meds"], rng);
          if ((r.resources[key] || 0) < 1) return applyFallbackWork(r, rng, "没有可分享的物资，提案被拒绝，转为普通工作。");
          r.resources[key]--; targetResident.resources[key] = (targetResident.resources[key] || 0) + 1;
          targetResident.trust[r.id] = clamp((targetResident.trust[r.id] || 0) + 5, -100, 100);
          state.metrics.trust += 1;
          title = `${r.name}向${targetResident.name}分享了物资`;
          desc = `${proposal.reason} 两人的关系有所改善。`;
        } else {
          if (own.food < 1) return applyFallbackWork(r, rng, "食物不足，无法分享，提案转为普通工作。");
          own.food--; resources.food = Math.max(0, resources.food - 1); state.metrics.trust += 1;
          title = `${r.name}将食物送往公共补给点`;
          desc = `${proposal.reason} 一份小小的援助缓解了街区压力。`;
        }
        break;
      }
      case "ally": {
        const faction = targetFaction || state.factions.find(f => f.id === r.faction);
        faction.influence += 1 + Math.floor(rng() * 3);
        r.trust[faction.id] = clamp((r.trust[faction.id] || 0) + 3, -100, 100);
        state.metrics.stability += 1;
        title = `${r.name}加强了与${faction.name}的联系`;
        desc = `${proposal.reason} 势力影响力小幅上升。`;
        break;
      }
      case "spread_rumor": {
        const effect = rng() > 0.45 ? 2 : -2;
        state.metrics.trust += effect;
        state.factions.find(f => f.id === r.faction).influence += 1;
        title = `${r.name}在街区散布了一条消息`;
        desc = `${proposal.reason} 消息引起讨论，公众信任${effect > 0 ? "上升" : "下降"}。`;
        type = effect > 0 ? "info" : "warn";
        break;
      }
      case "ask_help": {
        const key = pick(["food", "meds", "energy"], rng);
        const gained = 2;
        resources[key] += gained; own[key] = (own[key] || 0) + gained;
        state.metrics.trust += 1;
        title = `${r.name}向社区网络请求支援`;
        desc = `${proposal.reason} 获得了 ${gained} 单位${resourceName(key)}。`;
        break;
      }
      case "hoard": {
        const key = pick(["food", "energy", "meds"], rng);
        const gained = Math.min(2, Math.max(0, resources[key] - 1));
        if (gained < 1) return applyFallbackWork(r, rng, "可储备资源不足，提案被拒绝，转为普通工作。");
        resources[key] -= gained; own[key] = (own[key] || 0) + gained;
        state.metrics.trust -= 1;
        title = `${r.name}悄悄储备了一批${resourceName(key)}`;
        desc = `${proposal.reason} 个人安全感提升，但公共资源略有减少。`;
        type = "warn";
        break;
      }
      default: return { ok: false, message: "未知行动。" };
    }

    state.metrics.stability = clamp(state.metrics.stability, 0, 100);
    state.metrics.pollution = clamp(state.metrics.pollution, 0, 100);
    state.metrics.trust = clamp(state.metrics.trust, 0, 100);
    state.factions.forEach(f => f.influence = clamp(Math.round(f.influence), 0, 100));
    remember(r, `第 ${state.day} 天：${title}。`);
    addEvent(type, title, desc, proposal.action.toUpperCase());
    return { ok: true, message: title };
  }

  function applyFallbackWork(r, rng, note) {
    const earned = 3 + Math.floor(rng() * 5);
    r.resources.money += earned;
    state.resources.money += earned;
    addEvent("warn", `${r.name}的行动改为普通工作`, `${note} 获得 ${earned} 信用点。`, "RULE CHECK");
    remember(r, `第 ${state.day} 天：行动提案未通过规则校验，改为普通工作。`);
    return { ok: true, message: "已回退到安全行动" };
  }

  function resourceName(key) {
    return ({money:"信用点", food:"食物", energy:"能源", meds:"医疗物资"})[key] || key;
  }

  function localProposal(r, rng) {
    const options = ["work", "trade", "share", "ally", "spread_rumor", "ask_help", "hoard"];
    let action = pick(options, rng);
    if (r.personality === "仁慈" || r.personality === "热心") action = rng() > .35 ? "share" : "ask_help";
    if (r.personality === "怀疑") action = rng() > .45 ? "spread_rumor" : "work";
    if (r.personality === "谨慎") action = rng() > .4 ? "hoard" : "work";
    let target = "";
    if (action === "share") target = pick(state.residents.filter(x => x.id !== r.id), rng).id;
    if (action === "ally") target = pick(state.factions, rng).id;
    return { residentId: r.id, action, target, reason: localReason(action, r, rng) };
  }

  function localReason(action, r, rng) {
    const reasons = {
      work: [`${r.job}的订单增加了。`, "生活成本上涨，得先赚些信用点。"],
      trade: ["街区市场出现了短暂的价格窗口。", "需要补充工作和生活物资。"],
      share: ["邻居最近过得不太顺。", "社区互助网络发来了求助消息。"],
      ally: ["最近局势紧张，合作比冲突划算。", "建立一条可靠的关系链。"],
      spread_rumor: ["一条未经证实的消息正在街头流传。", "有人想知道企业区到底发生了什么。"],
      ask_help: ["手头资源不够，需要通过社区网络周转。", "公共频道里有人在征集互助需求。"],
      hoard: ["供应链不稳定，先留一点备用。", "最近的情况让人有些不安。"]
    };
    return pick(reasons[action] || ["观察城市变化。"], rng);
  }

  async function getAIProposals(selected) {
    if (!aiEnabled || mode !== "online") return null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 13000);
      const response = await fetch("/api/propose", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        signal: controller.signal,
        body: JSON.stringify({
          world: { day: state.day, resources: state.resources, metrics: state.metrics, factions: state.factions },
          residents: selected.map(r => ({...r, resources:r.resources, memory:r.memory}))
        })
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error("API 不可用");
      const data = await response.json();
      return Array.isArray(data.proposals) ? data.proposals : null;
    } catch (_err) {
      addEvent("warn", "AI 提案暂不可用", "本回合自动切换为离线规则，不影响世界继续运行。", "FALLBACK");
      return null;
    }
  }

  async function advanceDay() {
    if (paused || advancing) return;
    advancing = true;
    $("nextDayBtn").disabled = true;
    const rng = rngForDay();
    state.day += 1;
    // Daily upkeep is deterministic and performed by the engine, never by the model.
    const upkeep = Math.min(state.resources.food, Math.ceil(state.residents.length * .7));
    state.resources.food = Math.max(0, state.resources.food - upkeep);
    state.metrics.stability += state.resources.food < 30 ? -3 : 1;
    state.metrics.pollution += state.resources.energy > 180 && rng() > .55 ? 1 : 0;
    state.metrics.trust += state.resources.food < 20 ? -2 : 0;
    if (state.resources.food === 0) addEvent("danger", "公共食物储备已耗尽", "如果补给不能恢复，居民之间的紧张关系可能继续升级。", "SHORTAGE");

    const active = state.residents.filter(r => r.alive);
    const shuffled = [...active].sort(() => rng() - .5);
    const selected = shuffled.slice(0, 3);
    const aiProposals = await getAIProposals(selected);
    let usedAI = 0;
    for (const r of selected) {
      let proposal = null;
      if (aiProposals) {
        proposal = validateProposal(aiProposals.find(p => p.residentId === r.id), active);
        if (proposal) usedAI++;
      }
      if (!proposal) proposal = localProposal(r, rng);
      applyProposal(proposal, rng);
    }
    // Non-selected residents still live and act through lightweight local rules.
    active.filter(r => !selected.some(s => s.id === r.id)).forEach(r => {
      if (rng() > .7) {
        const earned = 1 + Math.floor(rng() * 3);
        r.resources.money += earned;
        state.resources.money += earned;
      }
    });

    state.resources.money = Math.max(0, Math.round(state.resources.money));
    state.resources.food = Math.max(0, Math.round(state.resources.food));
    state.resources.energy = Math.max(0, Math.round(state.resources.energy));
    state.resources.meds = Math.max(0, Math.round(state.resources.meds));
    state.metrics.stability = clamp(Math.round(state.metrics.stability), 0, 100);
    state.metrics.pollution = clamp(Math.round(state.metrics.pollution), 0, 100);
    state.metrics.trust = clamp(Math.round(state.metrics.trust), 0, 100);
    state.factions.forEach(f => f.influence = clamp(Math.round(f.influence), 0, 100));
    if (state.day % 3 === 0) {
      const event = pick([
        ["街区电网出现短暂波动","几处街灯熄灭后又重新亮起，维修队正在检查线路。","ENVIRONMENT"],
        ["黑市交易量上升","居民开始囤积日用品，市场价格出现轻微波动。","ECONOMY"],
        ["公共频道流量激增","一条关于城市未来的讨论吸引了大量居民加入。","CIVIC"],
        ["企业区发布新公告","新纪元科技承诺改善基础设施，但居民仍在等待具体行动。","CORP"]
      ], rng);
      addEvent("info", event[0], event[1], event[2]);
    }
    state.lastReport = `第 ${state.day} 天推进完成。${usedAI ? `使用 ${usedAI} 条 AI 提案。` : "本回合使用离线规则。"}`;
    state.history.push({day:state.day, ...state.metrics, resources:{...state.resources}});
    state.history = state.history.slice(-30);
    persist(false);
    render();
    $("nextDayBtn").disabled = false;
    advancing = false;
    showToast(state.lastReport);
  }

  function render() {
    $("dayLabel").textContent = String(state.day).padStart(2, "0");
    $("stabilityValue").textContent = state.metrics.stability;
    $("pollutionValue").textContent = state.metrics.pollution;
    $("trustValue").textContent = state.metrics.trust;
    $("stabilityBar").style.width = `${state.metrics.stability}%`;
    $("pollutionBar").style.width = `${state.metrics.pollution}%`;
    $("trustBar").style.width = `${state.metrics.trust}%`;
    $("moneyValue").textContent = state.resources.money;
    $("foodValue").textContent = state.resources.food;
    $("energyValue").textContent = state.resources.energy;
    $("medsValue").textContent = state.resources.meds;
    $("cityPopulation").textContent = `居民 ${state.residents.filter(r=>r.alive).length} / ${state.residents.length}`;
    $("eventCount").textContent = `${state.events.length} EVENTS`;
    $("residentCount").textContent = `${state.residents.filter(r=>r.alive).length} ACTIVE`;
    $("eventList").innerHTML = state.events.slice(0, 22).map(e => `
      <article class="event-item">
        <div class="event-time">D${String(e.day).padStart(2,"0")}<br>${e.type === "danger" ? "!!" : e.type === "warn" ? "WARN" : "LOG"}</div>
        <div><div class="event-title">${escapeHTML(e.title)}</div><div class="event-desc">${escapeHTML(e.desc)}</div><span class="event-tag ${e.type === "danger" ? "danger" : e.type === "warn" ? "warn" : ""}">${escapeHTML(e.tag)}</span></div>
      </article>`).join("");
    $("factionList").innerHTML = state.factions.map(f => `
      <div class="faction-item"><div class="faction-symbol">${escapeHTML(f.symbol)}</div><div><div class="faction-name">${escapeHTML(f.name)}</div><div class="faction-meta">${escapeHTML(f.subtitle)}</div><div class="faction-meter"><i style="width:${f.influence}%"></i></div></div><div class="faction-score">${f.influence}<small style="color:#657d8d">%</small></div></div>`).join("");
    $("residentList").innerHTML = state.residents.map(r => {
      const faction = state.factions.find(f=>f.id===r.faction);
      return `<button class="resident-row ${selectedResidentId===r.id?"selected":""}" data-resident="${r.id}"><span class="resident-avatar">${escapeHTML(r.name.slice(0,1))}</span><span><span class="resident-name">${escapeHTML(r.name)}</span><span class="resident-job">${escapeHTML(r.job)}</span></span><span class="resident-affiliation">${escapeHTML(faction?.name || "未知")}</span></button>`;
    }).join("");
    document.querySelectorAll("[data-resident]").forEach(btn => btn.addEventListener("click", () => {
      selectedResidentId = btn.dataset.resident; renderResidentDetail(); render();
    }));
    renderResidentDetail();
    $("modeBadge").textContent = mode === "online" ? "● AI 已连接" : "● 离线模拟";
    $("modeBadge").classList.toggle("online", mode === "online");
    $("footerMode").textContent = mode === "online" ? "DEEPSEEK READY" : "LOCAL ENGINE READY";
    $("autoBtn").innerHTML = timer ? "<span>■</span> 停止连续模拟 <small>运行中</small>" : "<span>⟳</span> 连续模拟 <small>每 2.2 秒</small>";
  }

  function renderResidentDetail() {
    const r = state.residents.find(x => x.id === selectedResidentId);
    const box = $("residentDetail");
    if (!r) {
      box.innerHTML = '<div class="detail-placeholder">选择一名居民，查看其目标、性格与近期记忆。</div>';
      return;
    }
    const faction = state.factions.find(f=>f.id===r.faction);
    box.innerHTML = `<div class="detail-head"><strong>${escapeHTML(r.name)} <span style="color:#8095a5;font-weight:400">/ ${escapeHTML(r.job)}</span></strong><span>${escapeHTML(faction?.name || "")}</span></div>
      <div class="detail-goal">目标：${escapeHTML(r.goal)}</div><div class="detail-traits">性格：${escapeHTML(r.personality)} · 个人资源：₡${r.resources.money} / 食物 ${r.resources.food} / 能源 ${r.resources.energy} / 医疗 ${r.resources.meds}</div>
      <div class="detail-traits" style="margin-top:9px">近期记忆</div>${r.memory.slice(0,3).map(m=>`<span class="memory-chip">${escapeHTML(m)}</span>`).join("")}`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  function persist(showMessage = true) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      $("saveStatus").textContent = `本地存档已更新 · D${state.day}`;
      if (showMessage) showToast("世界快照已保存到本地浏览器。");
      return true;
    } catch (_err) {
      $("saveStatus").textContent = "存档失败：浏览器空间不足";
      if (showMessage) showToast("保存失败，请检查浏览器存储空间。");
      return false;
    }
  }

  function loadSaved(showMessage = true) {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        if (showMessage) showToast("没有找到本地存档。");
        return false;
      }
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.residents) || !parsed.resources || !parsed.metrics) throw new Error("invalid save");
      state = parsed;
      selectedResidentId = null;
      render();
      if (showMessage) showToast(`已读取第 ${state.day} 天的存档。`);
      return true;
    } catch (_err) {
      if (showMessage) showToast("存档损坏或版本不兼容，未加载。");
      return false;
    }
  }

  function injectEvent() {
    const eventOptions = [
      {type:"warn",title:"临时停电",desc:"东侧街区的电网节点短暂失效，公共能源储备减少 8 单位。",tag:"INFRASTRUCTURE",run:()=>{state.resources.energy=Math.max(0,state.resources.energy-8);state.metrics.stability-=3;}},
      {type:"info",title:"社区互助站开放",desc:"志愿者建立临时补给站，食物储备增加 12 单位，公众信任提升。",tag:"COMMUNITY",run:()=>{state.resources.food+=12;state.metrics.trust+=3;}},
      {type:"danger",title:"黑市药品流通",desc:"一批来源不明的医疗物资进入街区，短期内缓解了短缺，但引发担忧。",tag:"BLACK MARKET",run:()=>{state.resources.meds+=6;state.metrics.trust-=2;}},
      {type:"warn",title:"企业区排放超标",desc:"夜间工厂的排放数据异常，环境污染指数上升。",tag:"POLLUTION",run:()=>{state.metrics.pollution+=5;state.factions[0].influence+=2;}}
    ];
    const event = eventOptions[Math.floor(Math.random()*eventOptions.length)];
    event.run(); addEvent(event.type,event.title,event.desc,event.tag);
    state.metrics.stability=clamp(state.metrics.stability,0,100);
    state.metrics.pollution=clamp(state.metrics.pollution,0,100);
    state.metrics.trust=clamp(state.metrics.trust,0,100);
    persist(false); render(); showToast(`已注入事件：${event.title}`);
  }

  function showToast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.classList.remove("show"), 2600);
  }

  async function refreshMode() {
    try {
      const response = await fetch("/api/status");
      const data = await response.json();
      mode = data.mode === "online-ready" ? "online" : "offline";
    } catch (_err) { mode = "offline"; }
    render();
  }

  $("nextDayBtn").addEventListener("click", advanceDay);
  $("pauseBtn").addEventListener("click", () => {
    paused = !paused;
    $("pauseBtn").textContent = paused ? "▶ 继续" : "Ⅱ 暂停";
    showToast(paused ? "模拟已暂停。" : "模拟已继续。");
  });
  $("autoBtn").addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; render(); return; }
    paused = false; $("pauseBtn").textContent = "Ⅱ 暂停";
    timer = setInterval(() => { if (!paused) advanceDay(); }, 2200); render();
  });
  $("saveBtn").addEventListener("click", () => persist(true));
  $("loadBtn").addEventListener("click", () => loadSaved(true));
  $("injectBtn").addEventListener("click", injectEvent);
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("确定重置世界？当前模拟进度将被覆盖。建议先保存快照。")) return;
    if (timer) { clearInterval(timer); timer = null; }
    state = initialState(); selectedResidentId = null; paused = false;
    persist(false); render(); showToast("世界已重置。");
  });
  $("aiToggle").addEventListener("change", e => { aiEnabled = e.target.checked; showToast(aiEnabled ? "允许 AI 提案。" : "已关闭 AI 提案，使用离线规则。"); });
  $("detailToggle").addEventListener("change", e => {
    detailEnabled = e.target.checked;
    document.querySelector(".event-panel").style.opacity = detailEnabled ? "1" : ".7";
  });
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !["INPUT","TEXTAREA","BUTTON"].includes(document.activeElement.tagName)) {
      e.preventDefault(); advanceDay();
    }
  });

  loadSaved(false);
  if (!localStorage.getItem(SAVE_KEY)) persist(false);
  refreshMode();
  render();
})();
