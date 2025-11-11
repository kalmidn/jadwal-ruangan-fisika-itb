/* app.v3a.js — renders a booking table; auto-falls back to .container/body if #booking-table missing */
/* eslint-env browser */
"use strict";

(function () {
  function log(){ try{ console.log("[booking-table]", ...arguments); }catch(_){} }
  function err(){ try{ console.error("[booking-table]", ...arguments); }catch(_){} }
  function onReady(cb){ if (document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", cb,{once:true}); } else { cb(); } }
  function pad2(n){ return n<10 ? "0"+n : String(n); }
  function splitISO(iso){
    if (!iso || typeof iso!=="string" || iso.indexOf("T")===-1) return {date:"",time:""};
    const [d,tpart] = iso.split("T");
    const t = (tpart||"").split(/[+Z]/)[0];                   // HH:MM:SS
    const hhmm = t.split(":");
    return { date: d, time: (hhmm[0]&&hhmm[1]) ? (pad2(+hhmm[0])+":"+pad2(+hhmm[1])) : "" };
  }

  async function loadJSON(){
    const paths = [
      "data/schedule.json?_=" + Date.now(),
      "data/schedule.json",
      "./schedule.json?_=" + Date.now(),
      "./schedule.json"
    ];
    let last=null;
    for (const p of paths){
      try{
        const r = await fetch(p, { cache:"no-store" });
        if (!r.ok) throw new Error("HTTP "+r.status+" @ "+p);
        const j = await r.json();
        log("Loaded", p);
        return j;
      }catch(e){ last=e; }
    }
    throw last || new Error("schedule.json not found");
  }

  function normalize(raw){
    // legacy: { rooms, bookings }
    if (raw && Array.isArray(raw.bookings) && (Array.isArray(raw.rooms) || raw.rooms===undefined)){
      const roomIdx = new Map();
      (raw.rooms||[]).forEach(r=>roomIdx.set(String(r.id), r));
      return (raw.bookings||[]).map(b=>{
        const roomId = String(b.room_id||"");
        const room = roomIdx.get(roomId);
        const building = (room && room.building) || (roomId.includes("-") ? roomId.split("-")[0] : "GF");
        const df = String(b.date_from||"");
        const dt = String(b.date_to||"");
        const byw = Array.isArray(b.byweekday) ? b.byweekday.join(", ") : "";
        const whenText = byw ? `${byw} • ${df} → ${dt}` : (df||dt ? `${df} → ${dt}` : "");
        const timeText = (b.start && b.end) ? `${b.start}–${b.end}` : "";
        return {
          building_name: building,
          rooms_label: roomId.split("-").slice(1).join("-") || roomId,
          whenText, timeText,
          status: String(b.status||"").toLowerCase(),
          title: String(b.title||""),
          byline: String(b.pic_name||"")
        };
      });
    }

    // v2: { buildings, bookings }
    const bIndex = new Map(); // roomId -> building_name
    if (raw && Array.isArray(raw.buildings)){
      raw.buildings.forEach(b=>{
        const bid = String(b.id||"GF"); const bname = b.name || bid;
        (b.rooms||[]).forEach(rn=>{
          const name = (typeof rn==="string") ? rn : (rn && (rn.name||rn.id)) || "";
          const rid = (name.includes("-") && name.split("-")[0].toUpperCase()===bid.toUpperCase())
            ? name : (bid + "-" + name);
          bIndex.set(rid, bname);
        });
      });
    }

    const rows = [];
    (raw && Array.isArray(raw.bookings) ? raw.bookings : []).forEach(b=>{
      const rooms = Array.isArray(b.rooms) ? b.rooms.map(String) : (b.room_id ? [String(b.room_id)] : []);
      if (!rooms.length) return;

      const df = b.date_from ? String(b.date_from) : (b.start ? splitISO(b.start).date : "");
      const dt = b.date_to   ? String(b.date_to)   : (b.end   ? splitISO(b.end).date   : "");
      const startHM = (b.start && b.start.includes("T")) ? splitISO(b.start).time : (b.start||"");
      const endHM   = (b.end   && b.end.includes("T"))   ? splitISO(b.end).time   : (b.end||"");
      const byw = Array.isArray(b.byweekday) ? b.byweekday.join(", ") : "";
      const whenText = byw ? `${byw} • ${df} → ${dt}` : (df||dt ? `${df} → ${dt}` : (b.start&&b.end ? `${b.start} → ${b.end}` : ""));
      const timeText = (startHM && endHM) ? `${startHM}–${endHM}` : "";

      const labels = rooms.map(r=> r.includes("-") ? r.split("-").slice(1).join("-") : r);
      const label = labels.join("+");

      // pick first resolvable building
      let building = "";
      for (const r of rooms){
        const rid = r.includes("-") ? r : (String(b.building_id||"GF") + "-" + r);
        if (bIndex.has(rid)) { building = bIndex.get(rid); break; }
      }
      if (!building) building = String(b.building_id||"GF");

      rows.push({
        building_name: building,
        rooms_label: label,
        whenText, timeText,
        status: String(b.status||"").toLowerCase(),
        title: String(b.title||""),
        byline: String(b.by_name||"")
      });
    });

    log("Rows normalized:", rows.length);
    return rows;
  }

  function mount(){
    // prefer #booking-table; fall back to .container; else body
    return document.getElementById("booking-table")
        || document.querySelector(".container")
        || document.body;
  }

  function renderTable(rows){
    const host = mount();
    if (!host) return;

    if (!document.getElementById("booking-table-style")){
      const st = document.createElement("style");
      st.id = "booking-table-style";
      st.textContent = `
        #booking-table table, .container table { border-collapse: collapse; width: 100%; font-size: 14px; }
        #booking-table th, #booking-table td, .container th, .container td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
        #booking-table th, .container th { background: #f8fafc; font-weight: 600; }
        .status-fixed    { color: #0ea5e9; font-weight: 600; }
        .status-approved { color: #16a34a; font-weight: 600; }
        .status-pending  { color: #d97706; font-weight: 600; }
        .muted { color:#6b7280; }
      `;
      document.head.appendChild(st);
    }

    if (!rows || !rows.length){
      host.insertAdjacentHTML("beforeend", '<div class="muted">Tidak ada booking.</div>');
      return;
    }

    const head = `
      <thead>
        <tr>
          <th>Building</th>
          <th>Rooms</th>
          <th>When</th>
          <th>Time</th>
          <th>Status</th>
          <th>Title / By</th>
        </tr>
      </thead>`;

    const body = rows.map(r=>{
      const statusClass = "status-" + (r.status||"unknown");
      const by = r.byline ? `<div class="muted">${r.byline}</div>` : "";
      return `
        <tr>
          <td>${r.building_name}</td>
          <td>${r.rooms_label}</td>
          <td>${r.whenText}</td>
          <td>${r.timeText}</td>
          <td class="${statusClass}">${r.status}</td>
          <td>${r.title || "-"} ${by}</td>
        </tr>`;
    }).join("");

    const wrapperId = "booking-table-wrapper";
    const wrapper = document.createElement("div");
    wrapper.id = wrapperId;
    wrapper.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;
    host.appendChild(wrapper);
  }

  onReady(async function(){
    try{
      const raw = await loadJSON();
      const rows = normalize(raw);
      renderTable(rows);
    }catch(e){
      err(e);
      const host = mount();
      if (host) host.insertAdjacentHTML("beforeend",
        `<div style="color:#dc2626">Gagal memuat jadwal: ${String(e && (e.message||e))}</div>`);
    }
  });
})();
