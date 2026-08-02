/* ============================================================
   PNG出力（キャンバスに直接描く。外部ライブラリなし）
   ============================================================ */
window.DL_IMAGE = (function(){
  const S = window.DL_STORE;

  const W = 1200;
  const PAD = 56;
  const SANS = '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif';
  const SERIF = '"Shippori Mincho", "Hiragino Mincho ProN", serif';

  const C = {
    bg: "#f7f4ea", ink: "#2b2621", soft: "#5c5347", faint: "#948a78",
    line: "#d8cfb8", strong: "#b8ab8c", red: "#a13d34", track: "#e6e0cd"
  };

  async function ensureFonts(){
    if (!document.fonts || !document.fonts.load) return;
    try{
      await Promise.all([
        document.fonts.load('800 40px "Shippori Mincho"'),
        document.fonts.load('700 26px "Zen Kaku Gothic New"'),
        document.fonts.load('400 20px "Zen Kaku Gothic New"')
      ]);
    }catch(err){ /* 読めなくても既定フォントで描く */ }
  }

  function layout(el){
    const rows = S.tallyOf(el);
    const blocs = S.blocTotals(el, rows).filter(b => b.bloc.parties.length);
    let h = 190;                       // 見出し
    if (el.type === "single") return { rows: rows, blocs: [], height: 420 };
    h += 96;                           // 全体の帯
    h += 44 + rows.length * 58;        // 政党別
    if (blocs.length) h += 44 + blocs.length * 58;
    h += 96;                           // 脚注
    return { rows: rows, blocs: blocs, height: Math.max(560, h) };
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBarSegment(ctx, x, y, w, h, color, alpha){
    if (w <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }

  async function render(){
    const el = S.activeElection();
    await ensureFonts();
    const info = layout(el);
    const H = info.height;

    const canvas = document.createElement("canvas");
    const scale = 2;                   // 高解像度
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("この環境ではPNGを作れませんでした。");
    ctx.scale(scale, scale);

    // 背景
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.strong;
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    const cfg = window.DL_CONFIG || {};
    const date = new Date();
    const dateStr = date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日時点";

    // 見出し
    let y = PAD + 20;
    ctx.fillStyle = C.red;
    ctx.font = '700 15px ' + SANS;
    ctx.fillText("DISTRICT LEDGER ／ 議席予想", PAD, y);
    y += 46;
    ctx.fillStyle = C.ink;
    ctx.font = '800 40px ' + SERIF;
    ctx.fillText(el.name, PAD, y);
    y += 32;
    ctx.fillStyle = C.faint;
    ctx.font = '400 18px ' + SANS;
    ctx.fillText(dateStr, PAD, y);

    // 罫
    y += 26;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    y += 34;

    if (el.type === "single"){
      const d = el.districts[0];
      const w = d ? S.winnerEntries(d)[0] : null;
      ctx.fillStyle = C.soft;
      ctx.font = '400 20px ' + SANS;
      ctx.fillText("当選予想", PAD, y);
      y += 60;
      if (w){
        ctx.fillStyle = S.partyColor(w.cand.party);
        roundRect(ctx, PAD, y - 34, 16, 44, 3); ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.font = '800 46px ' + SERIF;
        ctx.fillText(w.cand.name, PAD + 34, y);
        y += 40;
        ctx.fillStyle = C.soft;
        ctx.font = '400 22px ' + SANS;
        ctx.fillText((w.cand.party || "無所属") + " ／ " + S.levelInfo(w.level).label, PAD + 34, y);
      } else {
        ctx.fillStyle = C.faint;
        ctx.font = '400 24px ' + SANS;
        ctx.fillText("まだ予想を選んでいません", PAD, y);
      }
      drawFooter(ctx, H, cfg);
      return canvas;
    }

    const s = S.seatSummary(el);
    const rows = info.rows;

    // 全体の帯
    const barX = PAD, barW = W - PAD * 2, barH = 34;
    const denom = Math.max(s.allSeats, rows.reduce((a, r) => a + r.high, 0), 1);
    ctx.fillStyle = C.track;
    roundRect(ctx, barX, y, barW, barH, 4); ctx.fill();
    let cx = barX;
    rows.forEach(r => {
      const color = S.partyColor(r.party);
      const wLow = (r.low / denom) * barW;
      const wToss = (r.toss / denom) * barW;
      drawBarSegment(ctx, cx, y, wLow, barH, color, 1); cx += wLow;
      drawBarSegment(ctx, cx, y, wToss, barH, color, .32); cx += wToss;
    });
    // 過半数ライン
    if (el.majority && s.allSeats){
      const mx = barX + (el.majority / denom) * barW;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(mx, y - 8); ctx.lineTo(mx, y + barH + 8); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.ink; ctx.font = '700 14px ' + SANS;
      ctx.fillText("過半数 " + el.majority, mx + 6, y - 12);
    }
    y += barH + 26;
    ctx.fillStyle = C.faint; ctx.font = '400 16px ' + SANS;
    ctx.fillText("全" + s.allSeats + "議席（選挙区 " + s.districtSeats +
      (s.propTotal ? " ＋ 比例 " + s.propTotal : "") + "）／ 選挙区 " + s.decided + "/" + s.total + " 確定", PAD, y);
    y += 42;

    y = drawRows(ctx, y, "政党別", rows.map(r => ({
      name: r.party, color: S.partyColor(r.party), r: r,
      goal: r.goal, sub: breakdown(r)
    })), denom, el);

    if (info.blocs.length){
      y = drawRows(ctx, y, "会派・連合", info.blocs.map(b => ({
        name: b.bloc.name, color: b.bloc.color, r: b,
        goal: b.bloc.goal, sub: b.members.join("＋")
      })), denom, el);
    }

    drawFooter(ctx, H, cfg);
    return canvas;
  }

  function breakdown(r){
    const parts = [];
    if (r.sure) parts.push("確実" + r.sure);
    if (r.lean) parts.push("優勢" + r.lean);
    if (r.toss) parts.push("接戦" + r.toss);
    if (r.prop) parts.push("比例" + r.prop);
    return parts.join("・");
  }

  function drawRows(ctx, y, title, items, denom, el){
    ctx.fillStyle = C.soft;
    ctx.font = '700 17px ' + SANS;
    ctx.fillText(title, PAD, y);
    y += 26;

    const nameX = PAD + 22, numRight = W - PAD;
    const barX = PAD + 240, barW = W - PAD - 240 - 130;

    items.forEach(it => {
      // 色チップ
      ctx.fillStyle = it.color;
      roundRect(ctx, PAD, y - 14, 14, 18, 3); ctx.fill();
      // 名前
      ctx.fillStyle = C.ink;
      ctx.font = '700 22px ' + SANS;
      ctx.fillText(clip(ctx, it.name, 200), nameX, y);
      // 内訳
      if (it.sub){
        ctx.fillStyle = C.faint;
        ctx.font = '400 14px ' + SANS;
        ctx.fillText(clip(ctx, it.sub, 210), nameX, y + 20);
      }
      // 帯
      ctx.fillStyle = C.track;
      roundRect(ctx, barX, y - 15, barW, 20, 3); ctx.fill();
      let cx = barX;
      const wSure = ((it.r.sure + it.r.prop) / denom) * barW;
      const wLean = (it.r.lean / denom) * barW;
      const wToss = (it.r.toss / denom) * barW;
      drawBarSegment(ctx, cx, y - 15, wSure, 20, it.color, 1); cx += wSure;
      drawBarSegment(ctx, cx, y - 15, wLean, 20, it.color, .6); cx += wLean;
      drawBarSegment(ctx, cx, y - 15, wToss, 20, it.color, .28);
      // 数字
      ctx.fillStyle = C.ink;
      ctx.font = '800 26px ' + SERIF;
      ctx.textAlign = "right";
      const label = it.r.toss ? it.r.low + "〜" + it.r.high : String(it.r.low);
      ctx.fillText(label, numRight, y + 2);
      ctx.textAlign = "left";
      // 目標
      if (it.goal){
        ctx.font = '700 13px ' + SANS;
        ctx.fillStyle = it.r.low >= it.goal ? "#4d7a34" : (it.r.high >= it.goal ? "#9a7b2f" : C.faint);
        ctx.textAlign = "right";
        const g = it.r.low >= it.goal ? "目標" + it.goal + " 到達"
          : it.r.high >= it.goal ? "目標" + it.goal + " 接戦次第"
          : "目標" + it.goal + " まであと" + (it.goal - it.r.high);
        ctx.fillText(g, numRight, y + 22);
        ctx.textAlign = "left";
      }
      y += 58;
    });
    return y + 12;
  }

  function clip(ctx, text, maxWidth){
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
  }

  function drawFooter(ctx, H, cfg){
    const y = H - 52;
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, y - 26); ctx.lineTo(W - PAD, y - 26); ctx.stroke();
    ctx.fillStyle = C.faint;
    ctx.font = '400 15px ' + SANS;
    ctx.fillText("※個人の予想です。報道機関・選挙管理委員会とは関係ありません。", PAD, y);
    const right = [cfg.siteName || "選挙区台帳", cfg.siteUrl || ""].filter(Boolean).join(" ／ ");
    ctx.textAlign = "right";
    ctx.fillText(right, W - PAD, y);
    ctx.textAlign = "left";
  }

  async function download(){
    const canvas = await render();
    const name = S.activeElection().name.replace(/[\\/:*?"<>|]/g, "_");
    const stamp = new Date().toISOString().slice(0, 10);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob){ reject(new Error("画像を作れませんでした。")); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name + "-" + stamp + ".png";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve(true);
      }, "image/png");
    });
  }

  return { render: render, download: download };
})();
