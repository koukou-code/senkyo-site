/* ============================================================
   状態の保持・保存・移行・集計
   ============================================================ */
window.DL_STORE = (function(){
  const { SHUGIIN_PREF_SEATS, SANGIIN_DISTRICTS, PARTY_PRESET, LEVELS } = window.DL_DATA;

  const STORAGE_KEY = "district-ledger-v4";
  const UNDO_KEY    = "district-ledger-v4-undo";
  const OLD_KEYS    = ["district-ledger-v3", "district-ledger-v2", "district-ledger-v1"];
  const UNDO_MAX    = 8;

  let uidSeq = 0;
  function uid(p){ uidSeq += 1; return p + "-" + Date.now().toString(36) + "-" + uidSeq.toString(36); }
  function levelInfo(k){ return LEVELS.find(l => l.key === k) || LEVELS[0]; }

  /* ---------------- 生成 ---------------- */
  function makeDistrict(group, label, seatCount){
    return { id: uid("d"), group: group || "", label: label,
      seatCount: Math.max(1, parseInt(seatCount, 10) || 1), candidates: [], winners: [] };
  }
  function makeCandidate(name, party, terms, memo, incumbent){
    return { id: uid("c"), name: name, party: party || "",
      terms: (terms === 0 || terms) ? terms : null, memo: memo || "", incumbent: !!incumbent };
  }
  function makeElection(name, type, districts, opts){
    const o = opts || {};
    return {
      id: uid("e"), name: name, type: type,
      majority: o.majority == null ? null : o.majority,
      proportionalTotal: o.proportionalTotal == null ? null : o.proportionalTotal,
      proportional: [], partyGoals: {}, blocs: o.blocs || [],
      districts: districts || []
    };
  }
  function makeBloc(name, parties, color, goal){
    return { id: uid("b"), name: name, parties: parties || [], color: color || "#7a9a5a",
      goal: goal == null ? null : goal };
  }
  function buildShugiinDistricts(){
    const list = [];
    Object.entries(SHUGIIN_PREF_SEATS).forEach(([pref, n]) => {
      for (let i = 1; i <= n; i++) list.push(makeDistrict(pref, pref + i + "区", 1));
    });
    return list;
  }
  function buildSangiinDistricts(){
    return Object.entries(SANGIIN_DISTRICTS).map(([pref, total]) => makeDistrict(pref, pref, total / 2));
  }
  function defaultData(){
    const shu = makeElection("衆議院 小選挙区", "multi", buildShugiinDistricts(),
      { majority: 233, proportionalTotal: 176,
        blocs: [makeBloc("与党（自民＋維新）", ["自由民主党", "日本維新の会"], "#a8593f", 233)] });
    const san = makeElection("参議院 選挙区", "multi", buildSangiinDistricts(),
      { majority: 125, proportionalTotal: 50 });
    return {
      app: "district-ledger", version: 4,
      parties: PARTY_PRESET.map(p => ({ name: p.name, color: p.color })),
      activeElectionId: shu.id, elections: [shu, san]
    };
  }

  /* ---------------- 旧データの取り込み ---------------- */
  function fromV1(parsed){
    function conv(list){
      return list.map(d => {
        const nd = makeDistrict(d.pref || "", d.label, d.seatCount);
        nd.candidates = (d.candidates || []).map(c => makeCandidate(c.name, c.party, c.terms, c.memo, false));
        const idxs = d.seatCount === 1
          ? (d.winnerIdx === null || d.winnerIdx === undefined ? [] : [d.winnerIdx])
          : (d.winnerIdxs || []);
        nd.winners = idxs.map(i => nd.candidates[i]).filter(Boolean).map(c => ({ id: c.id, level: "sure" }));
        return nd;
      });
    }
    const base = defaultData();
    base.elections[0].districts = conv(parsed.shugiin || []);
    base.elections[1].districts = conv(parsed.sangiin || []);
    return base;
  }

  // v2/v3形式もここで吸収する
  function normalize(d){
    d.app = "district-ledger"; d.version = 4;
    if (!Array.isArray(d.parties) || !d.parties.length){
      d.parties = PARTY_PRESET.map(p => ({ name: p.name, color: p.color }));
    }
    d.parties = d.parties
      .filter(p => p && p.name)
      .map(p => ({ name: String(p.name), color: p.color || "#7a7a72" }));
    if (!Array.isArray(d.elections)) d.elections = [];

    d.elections.forEach(e => {
      if (!e.id) e.id = uid("e");
      if (e.type !== "single") e.type = "multi";
      if (e.majority == null && e.goal != null) e.majority = e.goal;   // v3の goal を移行
      delete e.goal;
      e.majority = e.majority == null ? null : Math.max(1, parseInt(e.majority, 10) || 0) || null;
      e.proportionalTotal = (e.proportionalTotal == null) ? null : Math.max(0, parseInt(e.proportionalTotal, 10) || 0);
      if (!Array.isArray(e.proportional)) e.proportional = [];
      e.proportional = e.proportional.map(p => ({
        id: p.id || uid("p"), party: p.party || "", seats: Math.max(0, parseInt(p.seats, 10) || 0),
        votes: p.votes == null ? null : Math.max(0, Number(p.votes) || 0)
      }));
      if (!e.partyGoals || typeof e.partyGoals !== "object") e.partyGoals = {};
      if (!Array.isArray(e.blocs)) e.blocs = [];
      e.blocs = e.blocs.map(b => ({
        id: b.id || uid("b"), name: b.name || "会派",
        parties: Array.isArray(b.parties) ? b.parties.slice() : [],
        color: b.color || "#7a9a5a",
        goal: b.goal == null ? null : Math.max(1, parseInt(b.goal, 10) || 0) || null
      }));
      if (!Array.isArray(e.districts)) e.districts = [];
      e.districts.forEach(dist => {
        if (!dist.id) dist.id = uid("d");
        dist.group = dist.group || "";
        dist.seatCount = Math.max(1, parseInt(dist.seatCount, 10) || 1);
        dist.candidates = (dist.candidates || []).map(c => {
          if (!c.id) c.id = uid("c");
          c.incumbent = !!c.incumbent;
          return c;
        });
        const ids = new Set(dist.candidates.map(c => c.id));
        dist.winners = (dist.winners || [])
          .map(w => typeof w === "string" ? { id: w, level: "sure" } : w)
          .filter(w => w && ids.has(w.id))
          .map(w => ({ id: w.id, level: levelInfo(w.level).key }))
          .slice(0, dist.seatCount);
      });
    });
    if (!d.elections.length) return defaultData();
    if (!d.elections.some(e => e.id === d.activeElectionId)) d.activeElectionId = d.elections[0].id;
    return d;
  }

  /* ---------------- 読み書き ---------------- */
  let data = load();
  let undoStack = loadUndo();

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.elections) && p.elections.length) return normalize(p);
      }
      for (const key of OLD_KEYS){
        const old = localStorage.getItem(key);
        if (!old) continue;
        const p = JSON.parse(old);
        if (p && Array.isArray(p.elections) && p.elections.length) return normalize(p);
        if (p && p.shugiin && p.sangiin) return fromV1(p);
      }
    }catch(err){ console.warn("保存データを読めませんでした:", err); }
    return defaultData();
  }
  function save(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch(err){ console.warn("保存できませんでした:", err); }
  }
  function loadUndo(){
    try{ const a = JSON.parse(localStorage.getItem(UNDO_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch(err){ return []; }
  }
  function saveUndo(){
    try{ localStorage.setItem(UNDO_KEY, JSON.stringify(undoStack.slice(-UNDO_MAX))); }catch(err){}
  }
  function pushUndo(snapshot){
    undoStack.push(snapshot || JSON.stringify(data));
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    saveUndo();
  }
  function popUndo(){
    if (!undoStack.length) return false;
    const prev = undoStack.pop();
    saveUndo();
    data = normalize(JSON.parse(prev));
    save();
    return true;
  }
  function undoCount(){ return undoStack.length; }
  function snapshot(){ return JSON.stringify(data); }
  function getData(){ return data; }
  function setData(next){ data = normalize(next); save(); }
  function activeElection(){
    return data.elections.find(e => e.id === data.activeElectionId) || data.elections[0];
  }

  /* ---------------- 政党 ---------------- */
  function partyColor(name){
    if (!name) return "#7a7a72";
    const found = data.parties.find(p => p.name === name);
    if (found) return found.color;
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return "hsl(" + h + ", 42%, 45%)";
  }
  function knownParties(){
    const set = new Set(data.parties.map(p => p.name));
    data.elections.forEach(e => {
      e.districts.forEach(d => d.candidates.forEach(c => { if (c.party) set.add(c.party); }));
      e.proportional.forEach(p => { if (p.party) set.add(p.party); });
    });
    return Array.from(set);
  }
  // 名前を変えたとき、入力済みの候補者・比例・会派も追従させる
  function renameParty(oldName, newName){
    data.parties.forEach(p => { if (p.name === oldName) p.name = newName; });
    data.elections.forEach(e => {
      e.districts.forEach(d => d.candidates.forEach(c => { if (c.party === oldName) c.party = newName; }));
      e.proportional.forEach(p => { if (p.party === oldName) p.party = newName; });
      e.blocs.forEach(b => { b.parties = b.parties.map(n => n === oldName ? newName : n); });
      if (e.partyGoals[oldName] != null){
        e.partyGoals[newName] = e.partyGoals[oldName];
        delete e.partyGoals[oldName];
      }
    });
  }

  /* ---------------- 集計 ---------------- */
  function districtIsDecided(d){ return d.winners.length >= d.seatCount; }
  function winnerEntries(d){
    return d.winners
      .map(w => ({ cand: d.candidates.find(c => c.id === w.id), level: w.level }))
      .filter(x => x.cand);
  }
  function hasToss(d){ return d.winners.some(w => w.level === "toss"); }

  function tallyOf(el){
    const t = {};
    function bump(party, key, n){
      const p = party || "無所属";
      if (!t[p]) t[p] = { sure:0, lean:0, toss:0, prop:0 };
      t[p][key] += n;
    }
    el.districts.forEach(d => winnerEntries(d).forEach(x => bump(x.cand.party, x.level, 1)));
    el.proportional.forEach(p => { if (p.seats > 0) bump(p.party, "prop", p.seats); });
    const rows = Object.entries(t).map(([party, v]) => {
      const low = v.sure + v.lean + v.prop;
      return { party: party, sure: v.sure, lean: v.lean, toss: v.toss, prop: v.prop,
        low: low, high: low + v.toss, goal: el.partyGoals[party] == null ? null : el.partyGoals[party] };
    });
    rows.sort((a, b) => b.high - a.high || b.low - a.low || a.party.localeCompare(b.party, "ja"));
    return rows;
  }

  function blocTotals(el, rows){
    return el.blocs.map(b => {
      const members = rows.filter(r => b.parties.includes(r.party));
      const sum = k => members.reduce((a, r) => a + r[k], 0);
      return { bloc: b, low: sum("low"), high: sum("high"),
        sure: sum("sure"), lean: sum("lean"), toss: sum("toss"), prop: sum("prop"),
        members: members.map(r => r.party) };
    });
  }

  function seatSummary(el){
    const districtSeats = el.districts.reduce((a, d) => a + d.seatCount, 0);
    const pickedSeats = el.districts.reduce((a, d) => a + d.winners.length, 0);
    const propSeats = el.proportional.reduce((a, p) => a + p.seats, 0);
    return {
      districtSeats: districtSeats, pickedSeats: pickedSeats, propSeats: propSeats,
      propTotal: el.proportionalTotal || 0,
      allSeats: districtSeats + (el.proportionalTotal || 0),
      decided: el.districts.filter(districtIsDecided).length,
      total: el.districts.length
    };
  }

  // ドント式：[{party, votes}] と議席数から配分を返す
  function dhondt(entries, seats){
    const valid = entries.filter(e => e.party && e.votes > 0);
    const result = {};
    valid.forEach(e => { result[e.party] = 0; });
    for (let i = 0; i < seats; i++){
      let best = null, bestVal = -1;
      valid.forEach(e => {
        const val = e.votes / (result[e.party] + 1);
        if (val > bestVal){ bestVal = val; best = e.party; }
      });
      if (!best) break;
      result[best] += 1;
    }
    return result;
  }

  return {
    uid: uid, levelInfo: levelInfo,
    makeDistrict: makeDistrict, makeCandidate: makeCandidate, makeElection: makeElection, makeBloc: makeBloc,
    buildShugiinDistricts: buildShugiinDistricts, buildSangiinDistricts: buildSangiinDistricts,
    defaultData: defaultData, normalize: normalize, fromV1: fromV1,
    save: save, pushUndo: pushUndo, popUndo: popUndo, undoCount: undoCount, snapshot: snapshot,
    getData: getData, setData: setData, activeElection: activeElection,
    partyColor: partyColor, knownParties: knownParties, renameParty: renameParty,
    districtIsDecided: districtIsDecided, winnerEntries: winnerEntries, hasToss: hasToss,
    tallyOf: tallyOf, blocTotals: blocTotals, seatSummary: seatSummary, dhondt: dhondt
  };
})();
