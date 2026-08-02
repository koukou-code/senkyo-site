/* ============================================================
   画面の描画
   ============================================================ */
window.DL_RENDER = (function(){
  const S = window.DL_STORE;
  const { LEVELS } = window.DL_DATA;

  function esc(s){
    return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function $id(id){ return document.getElementById(id); }

  // 画面上の一時状態（保存しない）
  const ui = {
    collapsed: new Set(), editingCandidates: new Set(), openMemos: new Set(),
    editingDistricts: new Set(), expandedDistricts: new Set(), drafts: {},
    focusDistrict: null, initialised: new Set()
  };

  /* ---------------- 全体 ---------------- */
  function renderAll(){
    refreshPartyList();
    renderElectionPicker();
    renderProportional();
    renderMain();
    renderSummary();
    const btn = $id("btn-undo");
    const n = S.undoCount();
    btn.disabled = n === 0;
    btn.textContent = n ? "ひとつ前に戻す（" + n + "）" : "ひとつ前に戻す";
  }

  function refreshPartyList(){
    $id("party-list").innerHTML = S.knownParties()
      .map(n => '<option value="' + esc(n) + '"></option>').join("");
  }

  function renderElectionPicker(){
    const data = S.getData(), el = S.activeElection();
    $id("election-select").innerHTML = data.elections
      .map(e => '<option value="' + esc(e.id) + '"' + (e.id === el.id ? " selected" : "") + ">" + esc(e.name) + "</option>")
      .join("");
    const s = S.seatSummary(el);
    $id("election-mode").innerHTML = el.type === "single"
      ? '<span class="mode-chip single">単独選挙</span> 当選1人'
      : '<span class="mode-chip">議席予想</span> ' + el.districts.length + "選挙区 / 定数計" + s.districtSeats +
        (el.proportionalTotal ? " ＋ 比例" + el.proportionalTotal : "");
  }

  /* ---------------- お知らせ ---------------- */
  function renderAnnouncements(){
    const cfg = window.DL_CONFIG || {};
    const list = cfg.announcements || [];
    const panel = $id("panel-news");
    if (!list.length){ panel.style.display = "none"; return; }
    panel.style.display = "block";
    $id("news-body").innerHTML = list.map(a =>
      '<div class="news-item"><div class="news-head"><span class="news-date">' + esc(a.date || "") +
      '</span><span class="news-title">' + esc(a.title || "") + '</span></div>' +
      (a.body ? '<div class="news-text">' + esc(a.body) + "</div>" : "") + "</div>").join("");
  }

  /* ---------------- 比例 ---------------- */
  function renderProportional(){
    const el = S.activeElection();
    const single = el.type === "single";
    $id("panel-prop").style.display = single ? "none" : "block";
    if (single) return;

    const box = $id("prop-rows");
    box.innerHTML = "";
    el.proportional.forEach(p => {
      const row = document.createElement("div");
      row.className = "prop-row";
      row.innerHTML =
        '<input type="text" list="party-list" class="p-party" placeholder="政党" value="' + esc(p.party) + '" />' +
        '<input type="number" class="p-seats" min="0" placeholder="議席" value="' + p.seats + '" />' +
        '<button class="icon-btn del p-del" title="削除">×</button>';
      row.querySelector(".p-party").addEventListener("change", e => {
        p.party = e.target.value.trim(); S.save(); renderSummary(); refreshPartyList();
      });
      row.querySelector(".p-seats").addEventListener("change", e => {
        p.seats = Math.max(0, parseInt(e.target.value, 10) || 0);
        e.target.value = p.seats;
        S.save(); renderSummary(); updatePropTotal();
      });
      row.querySelectorAll("input").forEach(i =>
        i.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }));
      row.querySelector(".p-del").addEventListener("click", () => {
        S.pushUndo();
        el.proportional = el.proportional.filter(x => x.id !== p.id);
        S.save(); renderAll();
      });
      box.appendChild(row);
    });
    if (!el.proportional.length){
      box.innerHTML = '<div class="empty-hint">まだ入力がありません。「＋ 政党を追加」か「得票数から計算」で入れてください。</div>';
    }
    updatePropTotal();
  }

  function updatePropTotal(){
    const el = S.activeElection();
    const sum = el.proportional.reduce((a, p) => a + p.seats, 0);
    const total = el.proportionalTotal;
    $id("prop-total").textContent = total
      ? "入力済み " + sum + " / 総定数 " + total + "（残り " + Math.max(0, total - sum) + "）"
      : "入力済み " + sum + " 議席";
    $id("prop-sub").textContent = sum ? "入力済み " + sum + " 議席" : "（議席数を直接入力、または得票数から計算）";
  }

  /* ---------------- 一覧 ---------------- */
  function renderMain(){
    const el = S.activeElection();
    const single = el.type === "single";
    $id("panel-add").style.display = single ? "none" : "block";
    $id("view-bar").style.display = single ? "none" : "flex";
    $id("main-title").textContent = el.name;

    const term = $id("search-input").value.trim().toLowerCase();
    let list = el.districts;
    if (term){
      list = list.filter(d =>
        (d.label + " " + d.group).toLowerCase().includes(term) ||
        d.candidates.some(c => (c.name || "").toLowerCase().includes(term) ||
          (c.party || "").toLowerCase().includes(term) || (c.memo || "").toLowerCase().includes(term)));
    }
    if ($id("only-undecided").checked) list = list.filter(d => !S.districtIsDecided(d));
    if ($id("only-close").checked) list = list.filter(S.hasToss);

    const decided = el.districts.filter(S.districtIsDecided).length;
    $id("main-count").textContent = single ? ""
      : decided + " / " + el.districts.length + " 選挙区が確定" +
        (list.length !== el.districts.length ? "（表示中 " + list.length + "）" : "");

    const box = $id("district-container");
    box.innerHTML = "";

    if (!el.districts.length){
      box.innerHTML = '<div class="blank-state"><h4>選挙区がまだありません</h4>' +
        "<p>上の「選挙区と候補者を追加」から、1つずつ、または一覧を貼り付けて作れます。</p></div>";
      return;
    }
    if (!list.length){
      box.innerHTML = '<div class="blank-state"><h4>該当する選挙区がありません</h4>' +
        "<p>検索語を変えるか、絞り込みを外してください。</p></div>";
      return;
    }
    if (single){
      const card = renderDistrictCard(el, list[0], true);
      card.classList.add("solo");
      box.appendChild(card);
      return;
    }

    // 初回だけ、大きい選挙はグループを畳んでおく
    if (!ui.initialised.has(el.id)){
      ui.initialised.add(el.id);
      if (el.districts.length > 60){
        el.districts.forEach(d => { if (d.group) ui.collapsed.add(el.id + "::" + d.group); });
      }
    }

    const groups = new Map();
    list.forEach(d => {
      const key = d.group || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });

    groups.forEach((districts, group) => {
      const block = document.createElement("div");
      block.className = "group-block";
      const key = el.id + "::" + group;
      const collapsed = group ? ui.collapsed.has(key) : false;

      if (group){
        const header = document.createElement("div");
        header.className = "group-header" + (collapsed ? " collapsed" : "");
        const dc = districts.filter(S.districtIsDecided).length;
        header.innerHTML = '<span class="caret">▼</span><h3>' + esc(group) + "</h3>" +
          '<span class="group-stat">' + dc + " / " + districts.length + "</span>";
        header.addEventListener("click", () => {
          if (collapsed) ui.collapsed.delete(key); else ui.collapsed.add(key);
          renderMain();
        });
        block.appendChild(header);
      }
      if (!collapsed){
        const grid = document.createElement("div");
        grid.className = "district-grid";
        districts.forEach(d => grid.appendChild(renderDistrictCard(el, d, false)));
        block.appendChild(grid);
      }
      box.appendChild(block);
    });

    if (ui.focusDistrict){
      const target = box.querySelector('[data-district="' + ui.focusDistrict + '"] .new-name');
      ui.focusDistrict = null;
      if (target) target.focus();
    }
  }

  function renderDistrictCard(el, d, isSingle){
    const decided = S.districtIsDecided(d);
    const editing = ui.editingDistricts.has(d.id);
    const compact = !isSingle && !editing && decided &&
      $id("compact-decided").checked && !ui.expandedDistricts.has(d.id);

    const card = document.createElement("div");
    card.dataset.district = d.id;
    card.className = "district-card" + (decided ? " decided" : "") + (compact ? " compact" : "");

    if (compact){
      const head = document.createElement("div");
      head.className = "district-card-head";
      head.innerHTML = '<span class="dlabel">' + esc(d.label) + '</span><span class="status-chip decided">確定</span>';
      card.appendChild(head);
      const w = document.createElement("div");
      w.className = "compact-winners";
      w.innerHTML = S.winnerEntries(d).map(x =>
        '<span class="mark" style="color:' + S.partyColor(x.cand.party) + '">' + S.levelInfo(x.level).mark + "</span>" +
        esc(x.cand.name) + '<span style="color:var(--ink-faint)"> ／ ' + esc(x.cand.party || "無所属") + "</span>").join("<br>");
      card.appendChild(w);
      card.addEventListener("click", () => { ui.expandedDistricts.add(d.id); renderMain(); });
      return card;
    }

    /* --- 見出し --- */
    if (editing){
      const box = document.createElement("div");
      box.className = "district-edit";
      box.innerHTML =
        '<input type="text" class="ed-group" placeholder="グループ" value="' + esc(d.group) + '" />' +
        '<input type="number" class="ed-seat" min="1" placeholder="定数" value="' + d.seatCount + '" />' +
        '<input type="text" class="ed-label full" placeholder="選挙区名" value="' + esc(d.label) + '" />' +
        '<div class="btns"><button class="btn ghost ed-cancel">やめる</button>' +
        '<button class="btn primary ed-save">保存する</button></div>';
      box.querySelectorAll("input").forEach(i =>
        i.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }));
      box.querySelector(".ed-cancel").addEventListener("click", () => { ui.editingDistricts.delete(d.id); renderMain(); });
      box.querySelector(".ed-save").addEventListener("click", () => {
        const label = box.querySelector(".ed-label").value.trim();
        if (!label){ box.querySelector(".ed-label").focus(); return; }
        d.label = label;
        d.group = box.querySelector(".ed-group").value.trim();
        d.seatCount = Math.max(1, parseInt(box.querySelector(".ed-seat").value, 10) || 1);
        if (d.winners.length > d.seatCount) d.winners = d.winners.slice(0, d.seatCount);
        ui.editingDistricts.delete(d.id);
        S.save(); renderAll();
      });
      card.appendChild(box);
    } else {
      const head = document.createElement("div");
      head.className = "district-card-head";
      const chip = decided ? "確定" : (d.seatCount > 1 ? "定数" + d.seatCount + "・" + d.winners.length + "人" : "未定");
      head.innerHTML = '<span class="dlabel">' + esc(d.label) + '</span>' +
        '<span class="status-chip ' + (decided ? "decided" : "") + '">' + esc(chip) + "</span>";
      if (!isSingle){
        const edit = document.createElement("button");
        edit.className = "icon-btn"; edit.title = "選挙区を編集"; edit.textContent = "✎";
        edit.addEventListener("click", () => { ui.editingDistricts.add(d.id); renderMain(); });
        const del = document.createElement("button");
        del.className = "icon-btn del"; del.title = "選挙区を削除"; del.textContent = "×";
        del.addEventListener("click", () => {
          if (!confirm("「" + d.label + "」を候補者ごと削除します。よろしいですか？")) return;
          S.pushUndo();
          el.districts = el.districts.filter(x => x.id !== d.id);
          S.save(); renderAll();
        });
        head.appendChild(edit); head.appendChild(del);
      }
      card.appendChild(head);
    }

    /* --- 候補者 --- */
    const listEl = document.createElement("div");
    listEl.className = "candidate-list";
    if (!d.candidates.length){
      listEl.innerHTML = '<div class="empty-hint">候補者がまだいません。下のフォームから追加してください。</div>';
    }

    d.candidates.forEach(c => {
      if (ui.editingCandidates.has(c.id)){ listEl.appendChild(renderCandidateEditor(d, c)); return; }
      const entry = d.winners.find(w => w.id === c.id);
      const row = document.createElement("div");
      row.className = "candidate-row" + (entry ? " selected" : "");
      row.innerHTML =
        '<input type="checkbox" class="win-box" ' + (entry ? "checked" : "") + ' title="当選予想にする" />' +
        '<span class="c-party-dot" style="background:' + S.partyColor(c.party) + '"></span>' +
        '<span class="c-name">' + esc(c.name) +
          '<span style="color:var(--ink-faint);font-weight:400;"> ／ ' + esc(c.party || "無所属") + "</span></span>" +
        (c.incumbent ? '<span class="badge-inc">現</span>' : "") +
        '<span class="c-terms">' + ((c.terms || c.terms === 0) ? esc(c.terms) + "回" : "") + "</span>" +
        '<button class="memo-btn ' + (c.memo ? "has" : "") + '" title="メモを開く">メモ</button>' +
        '<button class="icon-btn c-edit" title="この候補者を編集">✎</button>' +
        '<button class="icon-btn del c-del" title="この候補者を削除">×</button>';

      if (entry){
        const conf = document.createElement("div");
        conf.className = "conf-group";
        conf.innerHTML = LEVELS.map(l =>
          '<button class="conf-btn ' + (entry.level === l.key ? "on" : "") + '" data-level="' + l.key +
          '" title="' + l.label + '">' + l.mark + " " + l.label + "</button>").join("");
        conf.querySelectorAll(".conf-btn").forEach(b => {
          b.addEventListener("click", () => {
            entry.level = b.dataset.level;
            S.save(); renderMain(); renderSummary();
          });
        });
        row.appendChild(conf);
      }

      row.querySelector(".win-box").addEventListener("change", e => {
        toggleWinner(d, c.id, e.target.checked);
        ui.expandedDistricts.add(d.id);   // 選んだ直後に畳まれると確信度を押せない
        S.save(); renderMain(); renderSummary();
      });
      row.querySelector(".memo-btn").addEventListener("click", () => {
        if (ui.openMemos.has(c.id)) ui.openMemos.delete(c.id); else ui.openMemos.add(c.id);
        renderMain();
      });
      row.querySelector(".c-edit").addEventListener("click", () => { ui.editingCandidates.add(c.id); renderMain(); });
      row.querySelector(".c-del").addEventListener("click", () => {
        if (!confirm(c.name + " を削除します。よろしいですか？")) return;
        S.pushUndo();
        d.candidates = d.candidates.filter(x => x.id !== c.id);
        d.winners = d.winners.filter(w => w.id !== c.id);
        ui.openMemos.delete(c.id); ui.editingCandidates.delete(c.id);
        S.save(); renderAll();
      });
      listEl.appendChild(row);

      if (ui.openMemos.has(c.id)){
        const panel = document.createElement("div");
        panel.className = "memo-panel";
        panel.innerHTML = '<textarea placeholder="情勢・支持基盤・取材メモなど。ここで書き足せます。">' +
          esc(c.memo || "") + '</textarea><div class="memo-foot">入力欄から離れると保存されます</div>';
        const ta = panel.querySelector("textarea");
        ta.addEventListener("change", () => { c.memo = ta.value.trim(); S.save(); renderMain(); });
        listEl.appendChild(panel);
      }
    });
    card.appendChild(listEl);

    /* --- 候補者の追加 --- */
    const draft = ui.drafts[d.id] || { name:"", party:"", terms:"", memo:"", incumbent:false };
    const form = document.createElement("div");
    form.className = "add-candidate-form";
    form.innerHTML =
      '<input type="text" class="new-name" placeholder="候補者名" value="' + esc(draft.name) + '" />' +
      '<input type="text" class="new-party" list="party-list" placeholder="政党" value="' + esc(draft.party) + '" />' +
      '<input type="number" class="new-terms" placeholder="当選回数" min="0" value="' + esc(draft.terms) + '" />' +
      '<input type="text" class="new-memo" placeholder="メモ（任意）" value="' + esc(draft.memo) + '" />' +
      '<label class="inc-row"><input type="checkbox" class="new-inc" ' + (draft.incumbent ? "checked" : "") + " /> 現職</label>" +
      '<button class="add-btn" type="button">＋ 候補者を追加</button>';

    const nameEl = form.querySelector(".new-name"), partyEl = form.querySelector(".new-party");
    const termsEl = form.querySelector(".new-terms"), memoEl = form.querySelector(".new-memo");
    const incEl = form.querySelector(".new-inc");
    function syncDraft(){
      ui.drafts[d.id] = { name: nameEl.value, party: partyEl.value, terms: termsEl.value,
        memo: memoEl.value, incumbent: incEl.checked };
    }
    [nameEl, partyEl, termsEl, memoEl].forEach(i => i.addEventListener("input", syncDraft));
    incEl.addEventListener("change", syncDraft);
    // 名前欄でEnterを押しても追加しない（追加はボタンだけ）
    [nameEl, partyEl, termsEl, memoEl].forEach(i =>
      i.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }));

    form.querySelector(".add-btn").addEventListener("click", () => {
      const name = nameEl.value.trim();
      if (!name){ nameEl.focus(); return; }
      d.candidates.push(S.makeCandidate(name, partyEl.value.trim(),
        termsEl.value === "" ? null : parseInt(termsEl.value, 10), memoEl.value.trim(), incEl.checked));
      delete ui.drafts[d.id];
      ui.focusDistrict = d.id;   // 続けて入力できるよう名前欄に戻す
      S.save(); renderAll();
    });
    card.appendChild(form);
    return card;
  }

  function renderCandidateEditor(d, c){
    const box = document.createElement("div");
    box.className = "cand-edit";
    box.innerHTML =
      '<input type="text" class="e-name" placeholder="候補者名" value="' + esc(c.name) + '" />' +
      '<input type="text" class="e-party" list="party-list" placeholder="政党" value="' + esc(c.party || "") + '" />' +
      '<input type="number" class="e-terms" placeholder="当選回数" min="0" value="' +
        ((c.terms || c.terms === 0) ? esc(c.terms) : "") + '" /><span></span>' +
      '<label class="inc-row"><input type="checkbox" class="e-inc" ' + (c.incumbent ? "checked" : "") + " /> 現職</label>" +
      '<textarea class="e-memo full" placeholder="メモ">' + esc(c.memo || "") + "</textarea>" +
      '<div class="btns"><button class="btn ghost e-cancel">やめる</button>' +
      '<button class="btn primary e-save">保存する</button></div>';
    box.querySelectorAll("input").forEach(i =>
      i.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); }));
    box.querySelector(".e-cancel").addEventListener("click", () => { ui.editingCandidates.delete(c.id); renderMain(); });
    box.querySelector(".e-save").addEventListener("click", () => {
      const name = box.querySelector(".e-name").value.trim();
      if (!name){ box.querySelector(".e-name").focus(); return; }
      c.name = name;
      c.party = box.querySelector(".e-party").value.trim();
      const t = box.querySelector(".e-terms").value;
      c.terms = t === "" ? null : parseInt(t, 10);
      c.memo = box.querySelector(".e-memo").value.trim();
      c.incumbent = box.querySelector(".e-inc").checked;
      ui.editingCandidates.delete(c.id);
      S.save(); renderAll();
    });
    return box;
  }

  function toggleWinner(d, candidateId, checked){
    if (!checked){ d.winners = d.winners.filter(w => w.id !== candidateId); return; }
    if (d.seatCount === 1){ d.winners = [{ id: candidateId, level: "sure" }]; return; }
    if (d.winners.some(w => w.id === candidateId)) return;
    if (d.winners.length >= d.seatCount) d.winners.shift();
    d.winners.push({ id: candidateId, level: "sure" });
  }

  /* ---------------- 集計欄 ---------------- */
  function renderSummary(){
    const el = S.activeElection();
    const body = $id("summary-body");

    if (el.type === "single"){
      const d = el.districts[0];
      const w = d ? S.winnerEntries(d)[0] : null;
      body.innerHTML = w
        ? '<div class="single-result"><div class="who">' + S.levelInfo(w.level).mark + " " + esc(w.cand.name) + "</div>" +
          '<div class="sub">' + esc(w.cand.party || "無所属") +
          ((w.cand.terms || w.cand.terms === 0) ? " ／ 当選" + esc(w.cand.terms) + "回" : "") +
          " ／ " + S.levelInfo(w.level).label + "</div></div>"
        : '<div class="single-result"><div class="sub">まだ予想を選んでいません</div></div>';
      return;
    }

    const s = S.seatSummary(el);
    const rows = S.tallyOf(el);
    const blocs = S.blocTotals(el, rows);
    const pct = s.total ? (s.decided / s.total) * 100 : 0;
    const max = rows.length ? Math.max.apply(null, rows.map(r => r.high)) : 1;

    let html =
      '<div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="progress-label">' + s.decided + " / " + s.total + "</span></div>" +
      '<div class="seat-line">予想済み ' + (s.pickedSeats + s.propSeats) + " / " + s.allSeats + "議席（選挙区 " +
      s.pickedSeats + "／" + s.districtSeats + "・比例 " + s.propSeats + (s.propTotal ? "／" + s.propTotal : "") + "）</div>";

    if (!rows.length){
      html += '<div class="empty-hint">まだ当選予想がありません。</div>';
      body.innerHTML = html;
      return;
    }

    html += '<div class="tally-section">政党別</div>';
    rows.forEach(r => {
      html += tallyItem(r.party, S.partyColor(r.party), r, max, r.goal);
    });
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    html += '<div class="tally-legend">◎確実 ' + sum("sure") + "・○優勢 " + sum("lean") +
      "・△接戦 " + sum("toss") + (s.propSeats ? "・比例 " + s.propSeats : "") + "</div>";

    if (blocs.length){
      html += '<div class="tally-section">会派・連合</div>';
      const bmax = Math.max.apply(null, blocs.map(b => b.high).concat([1]));
      blocs.forEach(b => {
        html += tallyItem(b.bloc.name, b.bloc.color, b, bmax, b.bloc.goal,
          b.members.length ? b.members.join("＋") : "政党が未設定です");
      });
    }

    if (el.majority){
      const top = rows[0];
      html += '<div class="range-box">過半数ライン <b>' + el.majority + "</b>。最多は " + esc(top.party) +
        " で " + top.low + (top.toss ? "〜" + top.high : "") + "議席。</div>";
    }
    body.innerHTML = html;
  }

  function tallyItem(name, color, r, max, goal, sub){
    const seg = (n, op) => n ? '<span style="width:' + (n / max) * 100 + "%;background:" + color + ";opacity:" + op + '"></span>' : "";
    let goalHtml = "";
    if (goal){
      goalHtml = r.low >= goal
        ? '<span class="goal-tag hit">目標' + goal + " 到達</span>"
        : r.high >= goal
          ? '<span class="goal-tag near">目標' + goal + " まで接戦次第</span>"
          : '<span class="goal-tag">目標' + goal + " まであと " + (goal - r.high) + "</span>";
    }
    return '<div class="tally-item"><div class="tally-head">' +
      '<span class="dot" style="background:' + color + '"></span>' +
      "<span>" + esc(name) + "</span>" +
      '<span class="num">' + r.low + (r.toss ? '<span class="plus">〜' + r.high + "</span>" : "") + "</span></div>" +
      (sub ? '<div class="tally-sub">' + esc(sub) + "</div>" : "") +
      '<div class="tally-bar">' + seg(r.sure + r.prop, 1) + seg(r.lean, .6) + seg(r.toss, .28) + "</div>" +
      (goalHtml ? '<div class="goal-line">' + goalHtml + "</div>" : "") + "</div>";
  }

  /* ---------------- テキスト出力 ---------------- */
  function summaryText(){
    const el = S.activeElection();
    const date = new Date().toISOString().slice(0, 10);
    if (el.type === "single"){
      const w = el.districts[0] ? S.winnerEntries(el.districts[0])[0] : null;
      return "【" + el.name + "】予想（" + date + "時点）\n" +
        (w ? w.cand.name + "（" + (w.cand.party || "無所属") + "）／ " + S.levelInfo(w.level).label : "まだ予想なし");
    }
    const rows = S.tallyOf(el);
    const lines = rows.map(r => {
      const parts = [];
      if (r.sure) parts.push("確実" + r.sure);
      if (r.lean) parts.push("優勢" + r.lean);
      if (r.toss) parts.push("接戦" + r.toss);
      if (r.prop) parts.push("比例" + r.prop);
      return r.party + " " + r.low + (r.toss ? "〜" + r.high : "") + "（" + parts.join("・") + "）";
    });
    const blocs = S.blocTotals(el, rows).filter(b => b.high > 0);
    const s = S.seatSummary(el);
    let out = "【" + el.name + "】議席予想（" + date + "時点）\n" + lines.join("\n");
    if (blocs.length){
      out += "\n" + blocs.map(b => "［" + b.bloc.name + "］" + b.low + (b.toss ? "〜" + b.high : "")).join("\n");
    }
    out += "\n選挙区 " + s.decided + "/" + s.total + " 確定";
    if (el.majority) out += "／過半数 " + el.majority;
    return out + "\n※個人の予想です";
  }

  return {
    ui: ui, esc: esc,
    renderAll: renderAll, renderMain: renderMain, renderSummary: renderSummary,
    renderProportional: renderProportional, renderElectionPicker: renderElectionPicker,
    renderAnnouncements: renderAnnouncements, refreshPartyList: refreshPartyList,
    updatePropTotal: updatePropTotal, summaryText: summaryText
  };
})();
