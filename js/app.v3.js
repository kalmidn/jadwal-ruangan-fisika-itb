/* app.v3.js — minimal, robust booking-table renderer (no dependencies) */
/* eslint-env browser */
"use strict";

(function () {
  // ---------- tiny helpers ----------
  function log(){ console.log("[booking-table]", ...arguments); }
  function err(){ console.error("[booking-table]", ...arguments); }
  function onReady(cb){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, { once: true });
    } else { cb(); }
  }
  function pad2(n){ return n < 10 ? "0"+n : String(n); }

  // Parse ISO "2025-10-22T13:00:00+07:00" -> {date:"2025-10-22", time:"13:00"}
  function splitISO(iso){
    if (!iso || typeof iso !== "string" || !iso.includes("T")) return { date:"", time:"" };
    const [d, tpart] = iso.split("T");
    const hhmm = (tpart || "").split(/[+Z]/)[0];             // "13:00:00"
    const parts = (hhmm || "").split(":");
    return { date: d, time: (parts[0] && parts[1]) ? (pad2(+parts[0])+":"+pad2(+parts[1])) : "" };
  }

  // ---------- load schedule.json from common paths ----------
  async function loadSchedule(){
    const paths = [
      "data/schedule.json?_=" + Date.now(),
      "data/schedule.json",
      "./schedule.json?_=" + Date.now(),
      "./schedule.json"
    ];
    let last = null;
    for (const p of paths){
      try{
        const r = await fetch(p, { cache:"no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status + " @ " + p);
        const j = await r.json();
        log("Loaded", p);
        return j;
      }catch(e){ last = e; }
    }
    throw last || new Error("Cannot load schedule.json");
  }

  // ---------- normalization that accepts v2 and legacy ----------
  function normalize(raw){
    // If legacy {rooms, bookings}
    if (raw && Array.isArray(raw.bookings) && (Array.isArray(raw.rooms) || raw.rooms === undefined)) {
      // Legacy rooms may already have {id, name, building}
      const roomsLegacy = Array.isArray(raw.rooms) ? raw.rooms : [];
      const roomIndex = new Map();
      roomsLegacy.forEach(r => roomIndex.set(String(r.id), r));

      const rows = raw.bookings.map(b => {
        const roomId = String(b.room_id || "");
        const r = roomIndex.get(roomId);
        const building_id = roomId.includes("-") ? roomId.split("-")[0] : (r && r.building) || "GF";
        const building_name = (r && r.building) || building_id;
        const status = String(b.status || "").toLowerCase();
        const startHM = String(b.start || "");
        const endHM   = String(b.end || "");
        const df = String(b.date_from || "");
        const dt = String(b.date_to || "");
        const byw = Array.isArray(b.byweekday) ? b.byweekday.map(String) : [];

        return {
          building_id,
          building_name,
          rooms: [roomId],
          label: roomId.split("-").slice(1).join("-") || roomId,
          status,
          title: String(b.title || ""),
          by_role: "",                                     // legacy didn’t always have roles
          by_name: String(b.pic_name || ""),
          whenText: (byw.length ? `${byw.join(", ")} • ${df} → ${dt}` : `${df} → ${dt}`),
          timeText: (startHM && endHM) ? `${startHM}–${endHM}` : "",
        };
      });

      return rows;
    }

    // v2 with {buildings, bookings}
    const buildings = Array.isArray(raw.buildings) ? raw.buildings : [];
    const bIndex = new Map(); // roomId -> {building_id, building_name}
    buildings.forEach(b => {
      const bid = String(b.id || "GF");
      const bname = b.name || bid;
      (b.rooms || []).forEach(rn => {
        const name = (typeof rn === "string") ? rn : (rn && (rn.name || rn.id)) || "";
        // If room already prefixed, keep; else add building prefix for the id
        let rid;
        if (name.includes("-") && name.split("-")[0].toUpperCase() === bid.toUpperCase()) {
          rid = name;
        } else {
          // Keep numeric/simple labels; just use bid-name as id
          const core = name;
          rid = bid + "-" + core;
        }
        bIndex.set(rid, { building_id: bid, building_name: bname });
      });
    });

    const bookings = Array.isArray(raw.bookings) ? raw.bookings : [];
    const rows = [];

    bookings.forEach(b => {
      const rooms = Array.isArray(b.rooms) ? b.rooms.map(String) : (b.room_id ? [String(b.room_id)] : []);
      // derive building per room, fall back to b.building_id
      const status = String(b.status || "").toLowerCase();
      const title  = String(b.title || "");
      const role   = b.by_role ? String(b.by_role) : "";
      const name   = b.by_name ? String(b.by_name) : "";

      // Weekly fields (preferred if present)
      const df = b.date_from ? String(b.date_from) : (b.start ? splitISO(b.start).date : "");
      const dt = b.date_to   ? String(b.date_to)   : (b.end   ? splitISO(b.end).date   : "");
      const byw = Array.isArray(b.byweekday) ? b.byweekday.map(String) : [];
      const startHM = b.start && b.start.includes("T") ? splitISO(b.start).time : (b.start || "");
      const endHM   = b.end   && b.end.includes("T")   ? splitISO(b.end).time   : (b.end   || "");

      const whenText = byw.length
        ? `${byw.join(", ")} • ${df} → ${dt}`
        : (df || dt) ? `${df} → ${dt}` : (b.start && b.end) ? `${b.start} → ${b.end}` : "";

      const timeText = (startHM && endHM) ? `${startHM}–${endHM}` : "";

      if (!rooms.length) return; // skip malformed

      // Make one display row (merged rooms show as A+B etc.)
      const labels = rooms.map(r => r.includes("-") ? r.split("-").slice(1).join("-") : r);
      const label  = labels.join("+");

      // Choose building name from the first room we can resolve
      let building_id = String(b.building_id || "");
      let building_name = building_id || "";
      for (const rn of rooms) {
        const rid = rn.includes("-") ? rn : (building_id ? (building_id + "-" + rn) : rn);
        const info = bIndex.get(rid);
        if (info) { building_id = info.building_id; building_name = info.building_name; break; }
      }
      if (!building_id) building_id = "GF";
      if (!building_name) building_name = building_id;

      rows.push({
        building_id,
        building_name,
        rooms: rooms.slice(),
        label,
        status,
        title,
        by_role: role,
        by_name: name,
        whenText,
        timeText
      });
    });

    return rows;
  }

  // ---------- render a simple table ----------
  function renderTable(rows){
    const host = document.getElementById("booking-table");
    if (!host) return;

    if (!rows || !rows.length) {
      host.innerHTML = '<div style="color:#6b7280">Tidak ada booking.</div>';
      return;
    }

    // Small CSS (scoped)
    const styleId = "booking-table-inline-style";
    if (!document.getElementById(styleId)) {
      const st = document.createElement("style");
      st.id = styleId;
      st.textContent = `
        #booking-table table { border-collapse: collapse; width: 100%; font-size: 14px; }
        #booking-table th, #booking-table td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
        #booking-table th { background: #f8fafc; font-weight: 600; }
        #booking-table .status-fixed    { color: #0ea5e9; font-weight: 600; }
        #booking-table .status-approved { color: #16a34a; font-weight: 600; }
        #booking-table .status-pending  { color: #d97706; font-weight: 600; }
        #booking-table .byline { color:#6b7280; }
      `;
      document.head.appendChild(st);
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

    const body = rows.map(r => {
      const statusClass = "status-" + (r.status || "unknown");
      const by = (r.by_role ? `[${r.by_role}] ` : "") + (r.by_name || "");
      return `
        <tr>
          <td>${r.building_name || r.building_id}</td>
          <td>${r.label}</td>
          <td>${r.whenText}</td>
          <td>${r.timeText}</td>
          <td class="${statusClass}">${r.status}</td>
          <td>
            ${r.title ? r.title : "-"}
            <div class="byline">${by}</div>
          </td>
        </tr>`;
    }).join("");

    host.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;
  }

  // ---------- boot ----------
  onReady(async function(){
    try{
      const raw = await loadSchedule();
      const rows = normalize(raw);
      renderTable(rows);
    }catch(e){
      err(e);
      const host = document.getElementById("booking-table");
      if (host) host.innerHTML = `<div style="color:#dc2626">Gagal memuat jadwal: ${String(e && (e.message||e))}</div>`;
    }
  });
})();
