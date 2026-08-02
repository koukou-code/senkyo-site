/* ============================================================
   画面の操作をつなぐところ
   ============================================================ */
(function(){
  "use strict";
  const S = window.DL_STORE;
  const R = window.DL_RENDER;
  const IMG = window.DL_IMAGE;
  const esc = R.esc;
  const ui = R.ui;
  function $id(id){ return document.getElementById(id); }

  /* ---------------- モーダル ---------------- */
  function openModal(m){ m.classList.add("open"); }
  function closeModal(m){ m.classList.remove("open"); }
  document.querySelectorAll("[data-close]").forEach(b =>
    b.addEventListener("click", e => closeModal(e.target.closest(".modal-backdrop"))));
  document.querySelectorAll(".modal-backdrop").forEach(m =>
    m.addEventListener("click", e => { if (e.target === m) closeModal(m); }));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.open").forEach(closeModal);
  });
  function report(title, html){
    $id("report-title").textContent = title;
    $id("report-body").innerHTML = html;
    openModal($id("modal-report"));
  }

  /* ---------------- パネル開閉・タブ ---------------- */
  document.querySelectorAll(".panel > h3[data-toggle]").forEach(h =>
    h.addEventListener("click", () => h.parentElement.classList.toggle("closed")));
  document.querySelectorAll(".side-card > h3").forEach(h =>
    h.addEventListener("click", () => h.parentElement.classList.toggle("closed")));
  document.querySelectorAll(".subtab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".subtab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll("[data-panel]").forEach(p => {
        p.style.display = p.dataset.panel === tab.dataset.sub ? "block" : "none";
      });
    });
  });
  if (window.innerWidth <= 980){
    document.querySelectorAll('.side-card[data-card="filter"], .side-card[data-card="io"]')
      .forEach(c => c.classList.add("closed"));
  }

  /* ---------------- 選挙区・候補者の追加 ---------------- */
  function parseBulkDistricts(text){
    const out = [];
    text.split(/\r?\n/).forEach(line => {
      const raw = line.trim(); if (!raw) return;
      const parts = raw.split(/[,、，\t]/).map(s => s.trim()).filter(s => s !== "");
      if (!parts.length) return;
      let seat = 1;
      if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) seat = parseInt(parts.pop(), 10) || 1;
      if (!parts.length) return;
      const label = parts.pop();
      out.push(S.makeDistrict(parts.length ? parts.join(" ") : "", label, seat));
    });
    return out;
  }
  function normLabel(s){ return String(s).replace(/[\s　]/g, ""); }

  $id("btn-add-district").addEventListener("click", () => {
    const el = S.activeElection();
    const labelEl = $id("nd-label");
    const label = labelEl.value.trim();
    if (!label){ labelEl.focus(); return; }
    el.districts.push(S.makeDistrict($id("nd-group").value.trim(), label, $id("nd-seat").value));
    labelEl.value = "";
    S.save(); R.renderAll();
    labelEl.focus();
  });
  ["nd-group", "nd-label", "nd-seat"].forEach(id =>
    $id(id).addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }));

  $id("btn-bulk-add").addEventListener("click", () => {
    const ta = $id("bulk-text");
    const added = parseBulkDistricts(ta.value);
    if (!added.length){ alert("追加できる行が見つかりませんでした。1行に1選挙区で入力してください。"); return; }
    S.pushUndo();
    S.activeElection().districts.push.apply(S.activeElection().districts, added);
    ta.value = "";
    S.save(); R.renderAll();
    report("選挙区を追加しました", added.length + "件の選挙区を追加しました。");
  });

  $id("btn-cand-add").addEventListener("click", () => {
    const el = S.activeElection();
    const ta = $id("cand-text");
    const lines = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length){ alert("取り込む行がありません。"); return; }

    const index = new Map();
    el.districts.forEach(d => {
      index.set(normLabel(d.label), d);
      if (d.group) index.set(normLabel(d.group + d.label), d);
    });

    const snapshot = S.snapshot();
    let added = 0;
    const failed = [];
    lines.forEach(line => {
      const parts = line.split(/[,、，\t]/).map(s => s.trim());
      if (parts.length < 2){ failed.push(line); return; }
      const d = index.get(normLabel(parts[0]));
      if (!d || !parts[1]){ failed.push(line); return; }
      let party = "", terms = null, inc = false;
      parts.slice(2).forEach(tok => {
        if (!tok) return;
        if (/^(現|現職)$/.test(tok)) inc = true;
        else if (/^\d+$/.test(tok)) terms = parseInt(tok, 10);
        else party = tok;
      });
      d.candidates.push(S.makeCandidate(parts[1], party, terms, "", inc));
      added += 1;
    });

    if (!added){
      report("取り込めませんでした",
        "選挙区名が一致する行がありませんでした。1列目は登録済みの選挙区名（例：" +
        esc(el.districts[0] ? el.districts[0].label : "東京都1区") + "）にしてください。");
      return;
    }
    S.pushUndo(snapshot);
    ta.value = failed.join("\n");
    S.save(); R.renderAll();
    report("候補者を取り込みました",
      added + "人を追加しました。" +
      (failed.length
        ? "<br><br><strong>取り込めなかった " + failed.length + "行</strong>（選挙区名が一致しませんでした）は入力欄に残しています：<br>" +
          failed.slice(0, 20).map(esc).join("<br>") + (failed.length > 20 ? "<br>…" : "")
        : ""));
  });

  /* ---------------- 比例 ---------------- */
  $id("btn-add-prop").addEventListener("click", () => {
    S.activeElection().proportional.push({ id: S.uid("p"), party: "", seats: 0, votes: null });
    S.save(); R.renderProportional();
    const rows = $id("prop-rows").querySelectorAll(".p-party");
    if (rows.length) rows[rows.length - 1].focus();
  });

  // ドント式の計算
  function dhondtRow(party, votes){
    const row = document.createElement("div");
    row.className = "prop-row";
    row.innerHTML =
      '<input type="text" list="party-list" class="dh-party" placeholder="政党" value="' + esc(party || "") + '" />' +
      '<input type="number" class="dh-votes" min="0" step="1" placeholder="得票数（万票でも可）" value="' + (votes == null ? "" : votes) + '" />' +
      '<button class="icon-btn del dh-del" title="削除">×</button>';
    row.querySelector(".dh-del").addEventListener("click", () => row.remove());
    row.querySelectorAll("input").forEach(i =>
      i.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }));
    return row;
  }
  $id("btn-dhondt").addEventListener("click", () => {
    const el = S.activeElection();
    const box = $id("dh-rows");
    box.innerHTML = "";
    const seeds = el.proportional.length
      ? el.proportional.map(p => [p.party, p.votes])
      : S.getData().parties.slice(0, 6).map(p => [p.name, null]);
    seeds.forEach(([party, votes]) => box.appendChild(dhondtRow(party, votes)));
    $id("dh-seats").value = el.proportionalTotal || "";
    $id("dh-result").innerHTML = "";
    openModal($id("modal-dhondt"));
  });
  $id("btn-dh-addrow").addEventListener("click", () => $id("dh-rows").appendChild(dhondtRow("", null)));

  function readDhondt(){
    return Array.from($id("dh-rows").querySelectorAll(".prop-row")).map(row => ({
      party: row.querySelector(".dh-party").value.trim(),
      votes: Number(row.querySelector(".dh-votes").value) || 0
    })).filter(e => e.party && e.votes > 0);
  }
  $id("btn-dh-calc").addEventListener("click", () => {
    const seats = Math.max(0, parseInt($id("dh-seats").value, 10) || 0);
    const entries = readDhondt();
    if (!seats || !entries.length){
      $id("dh-result").innerHTML = '<div class="empty-hint">議席数と、政党・得票数を入れてください。</div>';
      return;
    }
    const res = S.dhondt(entries, seats);
    const totalVotes = entries.reduce((a, e) => a + e.votes, 0);
    $id("dh-result").innerHTML = '<div class="dh-result-head">配分結果（' + seats + "議席）</div>" +
      entries.slice().sort((a, b) => b.votes - a.votes).map(e =>
        '<div class="dh-result-row"><span class="dot" style="background:' + S.partyColor(e.party) + '"></span>' +
        "<span>" + esc(e.party) + '</span><span class="pct">' +
        (e.votes / totalVotes * 100).toFixed(1) + '%</span><span class="num">' + (res[e.party] || 0) + "議席</span></div>").join("");
  });
  $id("btn-dh-apply").addEventListener("click", () => {
    const seats = Math.max(0, parseInt($id("dh-seats").value, 10) || 0);
    const entries = readDhondt();
    if (!seats || !entries.length){ alert("議席数と、政党・得票数を入れてください。"); return; }
    const res = S.dhondt(entries, seats);
    const el = S.activeElection();
    S.pushUndo();
    el.proportional = entries.map(e => ({ id: S.uid("p"), party: e.party, seats: res[e.party] || 0, votes: e.votes }));
    closeModal($id("modal-dhondt"));
    S.save(); R.renderAll();
  });

  /* ---------------- 表示切り替え ---------------- */
  $id("btn-expand-all").addEventListener("click", () => {
    const el = S.activeElection();
    el.districts.forEach(d => ui.collapsed.delete(el.id + "::" + d.group));
    R.renderMain();
  });
  $id("btn-collapse-all").addEventListener("click", () => {
    const el = S.activeElection();
    el.districts.forEach(d => { if (d.group) ui.collapsed.add(el.id + "::" + d.group); });
    R.renderMain();
  });
  $id("compact-decided").addEventListener("change", () => { ui.expandedDistricts.clear(); R.renderMain(); });
  $id("search-input").addEventListener("input", R.renderMain);
  $id("only-undecided").addEventListener("change", R.renderMain);
  $id("only-close").addEventListener("change", R.renderMain);

  /* ---------------- 選挙の切替・作成・複製・設定 ---------------- */
  $id("election-select").addEventListener("change", e => {
    S.getData().activeElectionId = e.target.value;
    ui.editingCandidates.clear(); ui.openMemos.clear(); ui.editingDistricts.clear(); ui.expandedDistricts.clear();
    $id("search-input").value = ""; $id("only-undecided").checked = false; $id("only-close").checked = false;
    S.save(); R.renderAll();
  });

  function syncCreateForm(){
    const single = document.querySelector('input[name="ce-type"]:checked').value === "single";
    ["ce-template-field", "ce-bulk-field", "ce-majority-field", "ce-prop-field"]
      .forEach(id => $id(id).style.display = single ? "none" : "block");
  }
  document.querySelectorAll('input[name="ce-type"]').forEach(r => r.addEventListener("change", syncCreateForm));
  $id("ce-template").addEventListener("change", e => {
    if (e.target.value === "shugiin"){ $id("ce-majority").value = 233; $id("ce-prop").value = 176; }
    else if (e.target.value === "sangiin"){ $id("ce-majority").value = 125; $id("ce-prop").value = 50; }
  });

  $id("btn-new-election").addEventListener("click", () => {
    ["ce-name", "ce-bulk", "ce-majority", "ce-prop"].forEach(id => $id(id).value = "");
    $id("ce-template").value = "";
    document.querySelector('input[name="ce-type"][value="multi"]').checked = true;
    syncCreateForm(); openModal($id("modal-create")); $id("ce-name").focus();
  });

  $id("btn-create-confirm").addEventListener("click", () => {
    const nameEl = $id("ce-name");
    const name = nameEl.value.trim();
    if (!name){ nameEl.focus(); return; }
    const type = document.querySelector('input[name="ce-type"]:checked').value;
    let districts = [], opts = {};
    if (type === "single"){
      districts = [S.makeDistrict("", name, 1)];
    } else {
      const tpl = $id("ce-template").value;
      if (tpl === "shugiin") districts = S.buildShugiinDistricts();
      else if (tpl === "sangiin") districts = S.buildSangiinDistricts();
      else districts = parseBulkDistricts($id("ce-bulk").value);
      const m = $id("ce-majority").value, p = $id("ce-prop").value;
      opts.majority = m === "" ? null : (Math.max(1, parseInt(m, 10) || 0) || null);
      opts.proportionalTotal = p === "" ? null : Math.max(0, parseInt(p, 10) || 0);
    }
    const el = S.makeElection(name, type, districts, opts);
    const data = S.getData();
    data.elections.push(el);
    data.activeElectionId = el.id;
    closeModal($id("modal-create"));
    $id("search-input").value = ""; $id("only-undecided").checked = false; $id("only-close").checked = false;
    S.save(); R.renderAll();
  });

  $id("btn-duplicate").addEventListener("click", () => {
    $id("dup-name").value = S.activeElection().name + "（コピー）";
    document.querySelector('input[name="dup-mode"][value="candidates"]').checked = true;
    openModal($id("modal-duplicate")); $id("dup-name").focus();
  });
  $id("btn-duplicate-confirm").addEventListener("click", () => {
    const src = S.activeElection();
    const nameEl = $id("dup-name");
    const name = nameEl.value.trim();
    if (!name){ nameEl.focus(); return; }
    const mode = document.querySelector('input[name="dup-mode"]:checked').value;
    const el = S.makeElection(name, src.type, [], {
      majority: src.majority, proportionalTotal: src.proportionalTotal,
      blocs: src.blocs.map(b => S.makeBloc(b.name, b.parties.slice(), b.color, b.goal))
    });
    el.partyGoals = Object.assign({}, src.partyGoals);
    if (mode === "all"){
      el.proportional = src.proportional.map(p => ({ id: S.uid("p"), party: p.party, seats: p.seats, votes: p.votes }));
    }
    el.districts = src.districts.map(d => {
      const nd = S.makeDistrict(d.group, d.label, d.seatCount);
      if (mode !== "districts"){
        const map = {};
        d.candidates.forEach(c => {
          const nc = S.makeCandidate(c.name, c.party, c.terms, c.memo, c.incumbent);
          map[c.id] = nc.id;
          nd.candidates.push(nc);
        });
        if (mode === "all") nd.winners = d.winners.map(w => ({ id: map[w.id], level: w.level })).filter(w => w.id);
      }
      return nd;
    });
    const data = S.getData();
    data.elections.push(el);
    data.activeElectionId = el.id;
    closeModal($id("modal-duplicate"));
    S.save(); R.renderAll();
  });

  $id("btn-election-settings").addEventListener("click", () => {
    const el = S.activeElection();
    $id("es-name").value = el.name;
    $id("es-majority").value = el.majority == null ? "" : el.majority;
    $id("es-prop").value = el.proportionalTotal == null ? "" : el.proportionalTotal;
    const single = el.type === "single";
    $id("es-majority-field").style.display = single ? "none" : "block";
    $id("es-prop-field").style.display = single ? "none" : "block";
    openModal($id("modal-settings"));
  });
  $id("btn-settings-save").addEventListener("click", () => {
    const el = S.activeElection();
    const name = $id("es-name").value.trim();
    if (!name){ $id("es-name").focus(); return; }
    el.name = name;
    if (el.type === "single" && el.districts[0]) el.districts[0].label = name;
    const m = $id("es-majority").value, p = $id("es-prop").value;
    el.majority = m === "" ? null : (Math.max(1, parseInt(m, 10) || 0) || null);
    el.proportionalTotal = p === "" ? null : Math.max(0, parseInt(p, 10) || 0);
    closeModal($id("modal-settings"));
    S.save(); R.renderAll();
  });
  $id("btn-delete-election").addEventListener("click", () => {
    const el = S.activeElection();
    if (!confirm("「" + el.name + "」を選挙区・候補者ごとすべて削除します。「ひとつ前に戻す」で取り消せます。よろしいですか？")) return;
    S.pushUndo();
    const data = S.getData();
    data.elections = data.elections.filter(e => e.id !== el.id);
    if (!data.elections.length) S.setData(S.defaultData());
    else data.activeElectionId = data.elections[0].id;
    closeModal($id("modal-settings"));
    S.save(); R.renderAll();
  });

  /* ---------------- 政党の管理 ---------------- */
  function renderPartyEditor(){
    const data = S.getData();
    const box = $id("party-rows");
    box.innerHTML = "";
    data.parties.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "party-row";
      row.innerHTML =
        '<input type="color" class="pe-color" value="' + toHex(p.color) + '" title="色" />' +
        '<input type="text" class="pe-name" value="' + esc(p.name) + '" placeholder="政党名" />' +
        '<button class="icon-btn del pe-del" title="削除">×</button>';
      row.querySelector(".pe-color").addEventListener("change", e => {
        p.color = e.target.value; S.save(); R.renderAll();
      });
      row.querySelector(".pe-name").addEventListener("change", e => {
        const next = e.target.value.trim();
        if (!next){ e.target.value = p.name; return; }
        if (next === p.name) return;
        S.pushUndo();
        S.renameParty(p.name, next);
        S.save(); renderPartyEditor(); R.renderAll();
      });
      row.querySelector(".pe-name").addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
      row.querySelector(".pe-del").addEventListener("click", () => {
        if (!confirm("「" + p.name + "」を一覧から外します。入力済みの候補者の政党名はそのまま残ります。")) return;
        data.parties.splice(idx, 1);
        S.save(); renderPartyEditor(); R.renderAll();
      });
      box.appendChild(row);
    });
  }
  function toHex(c){
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    return "#7a7a72";   // hslなど、色ピッカーで扱えない値の代わり
  }
  $id("btn-parties").addEventListener("click", () => { renderPartyEditor(); openModal($id("modal-parties")); });
  $id("btn-party-add").addEventListener("click", () => {
    const name = $id("new-party-name").value.trim();
    if (!name){ $id("new-party-name").focus(); return; }
    const data = S.getData();
    if (data.parties.some(p => p.name === name)){ alert("同じ名前の政党がすでにあります。"); return; }
    data.parties.push({ name: name, color: $id("new-party-color").value });
    $id("new-party-name").value = "";
    S.save(); renderPartyEditor(); R.renderAll();
  });
  $id("new-party-name").addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });

  /* ---------------- 会派と目標 ---------------- */
  function renderBlocEditor(){
    const el = S.activeElection();
    const data = S.getData();
    const box = $id("bloc-rows");
    box.innerHTML = "";
    if (!el.blocs.length){
      box.innerHTML = '<div class="empty-hint">会派がまだありません。「＋ 会派を作る」から、まとめたい政党を選んでください。</div>';
    }
    el.blocs.forEach(b => {
      const wrap = document.createElement("div");
      wrap.className = "bloc-box";
      wrap.innerHTML =
        '<div class="bloc-head">' +
          '<input type="color" class="b-color" value="' + toHex(b.color) + '" title="色" />' +
          '<input type="text" class="b-name" value="' + esc(b.name) + '" placeholder="会派名（例：与党）" />' +
          '<input type="number" class="b-goal" min="1" placeholder="目標議席" value="' + (b.goal == null ? "" : b.goal) + '" />' +
          '<button class="icon-btn del b-del" title="削除">×</button>' +
        "</div>" +
        '<div class="bloc-parties">' + S.knownParties().map(n =>
          '<label class="chk"><input type="checkbox" value="' + esc(n) + '" ' +
          (b.parties.includes(n) ? "checked" : "") + " /> " + esc(n) + "</label>").join("") + "</div>";
      wrap.querySelector(".b-color").addEventListener("change", e => { b.color = e.target.value; S.save(); R.renderSummary(); });
      wrap.querySelector(".b-name").addEventListener("change", e => {
        b.name = e.target.value.trim() || "会派"; S.save(); R.renderSummary();
      });
      wrap.querySelector(".b-goal").addEventListener("change", e => {
        const v = e.target.value;
        b.goal = v === "" ? null : (Math.max(1, parseInt(v, 10) || 0) || null);
        S.save(); R.renderSummary();
      });
      wrap.querySelectorAll(".b-name, .b-goal").forEach(i =>
        i.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }));
      wrap.querySelector(".b-del").addEventListener("click", () => {
        el.blocs = el.blocs.filter(x => x.id !== b.id);
        S.save(); renderBlocEditor(); R.renderSummary();
      });
      wrap.querySelectorAll(".bloc-parties input").forEach(cb => {
        cb.addEventListener("change", () => {
          b.parties = Array.from(wrap.querySelectorAll(".bloc-parties input:checked")).map(x => x.value);
          S.save(); R.renderSummary();
        });
      });
      box.appendChild(wrap);
    });

    // 政党別の目標
    const gbox = $id("goal-rows");
    gbox.innerHTML = "";
    S.knownParties().forEach(name => {
      const row = document.createElement("div");
      row.className = "goal-row";
      row.innerHTML =
        '<span class="dot" style="background:' + S.partyColor(name) + '"></span>' +
        "<span>" + esc(name) + "</span>" +
        '<input type="number" min="1" placeholder="—" value="' + (el.partyGoals[name] == null ? "" : el.partyGoals[name]) + '" />';
      const inp = row.querySelector("input");
      inp.addEventListener("change", () => {
        const v = inp.value;
        if (v === "") delete el.partyGoals[name];
        else el.partyGoals[name] = Math.max(1, parseInt(v, 10) || 0) || 1;
        S.save(); R.renderSummary();
      });
      inp.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
      gbox.appendChild(row);
    });
    void data;
  }
  $id("btn-blocs").addEventListener("click", () => { renderBlocEditor(); openModal($id("modal-blocs")); });
  $id("btn-bloc-add").addEventListener("click", () => {
    S.activeElection().blocs.push(S.makeBloc("新しい会派", [], "#7a9a5a", null));
    S.save(); renderBlocEditor(); R.renderSummary();
  });

  /* ---------------- 保存・出力 ---------------- */
  async function copyText(text){
    try{
      if (navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return true; }
    }catch(err){}
    try{
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }catch(err){ return false; }
  }
  function flash(btn, text, revert){
    btn.textContent = text;
    setTimeout(() => { btn.textContent = revert; }, 1600);
  }

  $id("btn-png").addEventListener("click", async () => {
    const btn = $id("btn-png");
    btn.disabled = true;
    const original = "画像（PNG）で保存";
    btn.textContent = "作成中…";
    try{
      await IMG.download();
      flash(btn, "保存しました", original);
    }catch(err){
      alert("画像を作れませんでした: " + err.message);
      btn.textContent = original;
    }finally{
      btn.disabled = false;
    }
  });

  $id("btn-copy-summary").addEventListener("click", async () => {
    const ok = await copyText(R.summaryText());
    flash($id("btn-copy-summary"), ok ? "コピーしました" : "コピーできませんでした", "集計をコピー");
  });

  $id("btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(S.getData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "district-ledger-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  $id("btn-import-trigger").addEventListener("click", () => $id("btn-import").click());
  $id("btn-import").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try{
        const parsed = JSON.parse(evt.target.result);
        let next = null;
        if (parsed && Array.isArray(parsed.elections)) next = parsed;
        else if (parsed && parsed.shugiin && parsed.sangiin) next = S.fromV1(parsed);
        if (!next){ alert("このファイルの形式を読み取れませんでした。"); return; }
        if (!confirm("いまの入力内容を、読み込んだ内容で置き換えます。「ひとつ前に戻す」で取り消せます。よろしいですか？")) return;
        S.pushUndo();
        S.setData(next);
        ui.collapsed.clear(); ui.editingCandidates.clear(); ui.openMemos.clear();
        ui.editingDistricts.clear(); ui.expandedDistricts.clear(); ui.initialised.clear(); ui.drafts = {};
        R.renderAll();
        report("読み込みました", "JSONの内容に置き換えました。");
      }catch(err){ alert("JSONを読み込めませんでした: " + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  $id("btn-undo").addEventListener("click", () => {
    if (!S.popUndo()) return;
    ui.editingCandidates.clear(); ui.openMemos.clear(); ui.editingDistricts.clear();
    ui.expandedDistricts.clear(); ui.drafts = {};
    R.renderAll();
  });

  $id("btn-clear-election").addEventListener("click", () => {
    const el = S.activeElection();
    if (!confirm("「" + el.name + "」の候補者・当選予想・比例の入力をすべて消去します（選挙区の枠は残ります）。よろしいですか？")) return;
    S.pushUndo();
    el.districts.forEach(d => { d.candidates = []; d.winners = []; });
    el.proportional = [];
    ui.editingCandidates.clear(); ui.openMemos.clear(); ui.expandedDistricts.clear(); ui.drafts = {};
    S.save(); R.renderAll();
  });

  /* ---------------- 意見箱・お知らせ ---------------- */
  function setupSiteLinks(){
    const cfg = window.DL_CONFIG || {};
    document.querySelectorAll(".js-site-name").forEach(n => { n.textContent = cfg.siteName || "選挙区台帳"; });
    const fbButtons = document.querySelectorAll(".js-feedback");
    if (cfg.feedbackUrl){
      fbButtons.forEach(b => { b.href = cfg.feedbackUrl; b.style.display = ""; });
    } else {
      fbButtons.forEach(b => b.style.display = "none");
    }
    const contact = document.querySelectorAll(".js-contact");
    if (cfg.contactUrl){
      contact.forEach(b => { b.href = cfg.contactUrl; b.textContent = cfg.contactLabel || "連絡先"; b.style.display = ""; });
    } else {
      contact.forEach(b => b.style.display = "none");
    }
  }

  /* ---------------- 起動 ---------------- */
  syncCreateForm();
  setupSiteLinks();
  R.renderAnnouncements();
  S.save();
  R.renderAll();
})();
