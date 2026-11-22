/*
 * 자비스(lab.jarada.co.kr) '관찰일지' 화면에서 아이별 수업 횟수를 엑셀(CSV)로 받는 즐겨찾기 버튼.
 * - 원장님이 로그인한 브라우저에서 직접 누르는 방식이라 아이디·비밀번호를 어디에도 저장하지 않음.
 * - 화면 왼쪽 목록(#st_list_new)의 줄마다 붙어 있는 data-user_info(학생 정보)를 읽음.
 *   재원 → 휴원 → 퇴원 라디오를 차례로 눌러 목록이 바뀌기를 기다렸다가 모두 모으고, 끝나면 원래 고른 상태로 되돌림.
 * - 같은 아이가 주 2회면 목록에 두 줄로 나와서 학생 ID로 한 줄로 합침 (수업은 '화 2교시 / 목 3교시'처럼 같이 적음).
 * - 설치 안내: tools/jarvis-export.html (이 함수를 그대로 즐겨찾기 주소로 만들어 줌)
 */
async function jaradaJarvisExport() {
  // 목록은 탭을 바꿀 때 통째로 새로 그려질 수 있어서 매번 다시 찾음
  const getList = () => document.getElementById("st_list_new");
  if (!getList()) { alert("자라다 자비스 '관찰일지' 화면에서 눌러 주세요."); return; }
  if (window.__jaradaExporting) return;
  window.__jaradaExporting = true;
  const STATUS = { "01": "재원", "02": "휴원", "03": "퇴원" };
  const radios = { "01": document.getElementById("t_work1"), "02": document.getElementById("t_work2"), "03": document.getElementById("t_work3") };
  const labelCount = (code) => Number(((document.getElementById("tw_cnt_new" + Number(code)) || {}).textContent || "").replace(/\D/g, "")) || 0;
  const val = (id) => ((document.getElementById(id) || {}).value || "").trim();
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;top:16px;right:16px;background:#1f2937;color:#fff;padding:12px 16px;border-radius:12px;font:600 14px/1.5 sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:320px;";
  const say = (t) => { box.textContent = t; };
  try {
    const filtered = !!(val("wday") || val("teacher") || val("student_seach_name"));
    if (filtered
      && !confirm("요일 · 강사명 · 원생명 중 골라진 것이 있어요.\n전체 아이를 받으려면 셋 다 비우고 다시 눌러 주세요.\n\n지금 골라진 그대로 받을까요?")) return;
    document.body.appendChild(box);
    say("자비스 수업 횟수를 받는 중이에요…");
    const decode = (b) => { try { return JSON.parse(decodeURIComponent(atob(b))); } catch (e) { return null; } };
    const readList = (fallbackStatus) => [...(getList() || document.createElement("ul")).querySelectorAll("a.list_student")].map((a) => {
      const infoEl = a.querySelector("[data-user_info]");
      const info = (infoEl && decode(infoEl.getAttribute("data-user_info"))) || {};
      const etc = a.querySelectorAll(".etc_info");
      const shown = etc[1] ? etc[1].textContent.trim() : "";
      const nameEl = a.querySelector("span");
      return {
        id: a.getAttribute("data-id") || info.STD_ID || "",
        name: (nameEl ? nameEl.textContent.trim() : "") || info.STD_NM || "",
        age: info.STD_AGE_NUM != null && info.STD_AGE_NUM !== "" ? String(info.STD_AGE_NUM) : (etc[0] ? etc[0].textContent.replace(/\D/g, "") : ""),
        phone: info.HP_NO || "",
        count: /^\d+$/.test(shown) ? Number(shown) : Number(info.IMG_CNT2) || 0,
        status: STATUS[info.STD_STATUS] || fallbackStatus,
        lesson: info.LESSON_NM1 || info.LESSON_NM || "",
        teacher: info.TEACHER_NM || "",
      };
    });
    // 라디오를 누르고 목록이 새로 그려질 때까지 기다림 (바뀐 뒤 0.8초 동안 조용하면 끝, 30초 넘으면 포기)
    const listHtml = () => { const l = getList(); return l ? l.innerHTML : ""; };
    const switchTo = (code) => new Promise((resolve) => {
      const before = listHtml();
      let quiet = null, done = false;
      const changed = () => listHtml() !== before;
      const finish = (ok) => { if (done) return; done = true; obs.disconnect(); clearTimeout(quiet); clearTimeout(limit); resolve(ok); };
      // 화면 어디가 바뀌든 지켜보다가, 목록이 바뀐 뒤 0.8초 조용하면 끝
      const obs = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(() => { if (changed()) finish(true); }, 800); });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      const limit = setTimeout(() => finish(changed()), 30000);
      radios[code].click();
    });
    const start = Object.keys(radios).find((c) => radios[c] && radios[c].checked) || "01";
    const order = [start, ...["01", "02", "03"].filter((c) => c !== start)];
    const all = new Map();
    const got = {}, failed = [], short = [];
    for (const code of order) {
      if (!radios[code]) continue;
      if (code !== start) {
        if (labelCount(code) === 0) { got[code] = 0; continue; } // 0명이면 누를 필요 없음
        say(`${STATUS[code]} 목록을 불러오는 중이에요…`);
        const ok = await switchTo(code);
        if (!ok) { failed.push(STATUS[code]); continue; }
      }
      const rows = readList(STATUS[code]);
      const ids = new Set();
      for (const r of rows) {
        const key = r.id || `${r.name}|${r.phone}`;
        ids.add(key);
        const ex = all.get(key);
        if (ex) {
          if (r.lesson && !ex.lessons.includes(r.lesson)) ex.lessons.push(r.lesson);
          if (r.teacher && !ex.teachers.includes(r.teacher)) ex.teachers.push(r.teacher);
          ex.count = Math.max(ex.count, r.count);
        } else {
          all.set(key, { ...r, lessons: r.lesson ? [r.lesson] : [], teachers: r.teacher ? [r.teacher] : [] });
        }
      }
      got[code] = ids.size;
      // 화면 숫자(재원(303) 등)보다 적게 모였으면 알려 줌 (목록이 나눠서 불러와지는 경우 등)
      const want = labelCount(code);
      if (!filtered && want && ids.size < want) short.push(`${STATUS[code]} ${ids.size}명 / 화면 숫자 ${want}명`);
    }
    if (radios[start] && !radios[start].checked) { say("처음 화면으로 되돌리는 중이에요…"); await switchTo(start); }
    if (!all.size) { alert("받을 아이가 없어요. 관찰일지 왼쪽 목록에 아이가 보이는지 확인해 주세요."); return; }
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const head = ["학생ID", "이름", "나이", "연락처", "상태", "수업 횟수", "수업(요일·교시)", "선생님", "받은 날짜"];
    const cell = (v) => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const statusOrder = { "재원": 0, "휴원": 1, "퇴원": 2 };
    const lines = [...all.values()]
      .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || a.name.localeCompare(b.name, "ko"))
      .map((r) => [r.id, r.name, r.age, r.phone, r.status, r.count, r.lessons.join(" / "), r.teachers.join(" / "), ymd].map(cell).join(","));
    const csv = "﻿" + [head.join(","), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `자비스_수업횟수_${ymd}.csv`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 2000);
    const summary = ["01", "02", "03"].filter((c) => c in got).map((c) => `${STATUS[c]} ${got[c]}명`).join(" · ");
    alert(`${summary}을(를) 받았어요 (모두 ${all.size}명).\n파일: 자비스_수업횟수_${ymd}.csv${failed.length ? `\n\n${failed.join("·")} 목록은 불러오지 못했어요. 그 탭을 직접 누른 뒤 다시 받아 주세요.` : ""}${short.length ? `\n\n화면 숫자보다 적게 모였어요: ${short.join(", ")}` : ""}`);
  } finally {
    window.__jaradaExporting = false;
    box.remove();
  }
}
