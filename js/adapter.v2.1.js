<script defer>
"use strict";

/* ========= adapter.v2.1.js (safe & defensive) ========= */
(function () {

  // ---- 0) small helpers ----
  function log(...args){ console.log("[schedule-adapter]", ...args); }
  function err(...args){ console.error("[schedule-adapter]", ...args); }

  function onReady(cb){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, { once:true });
    } else { cb(); }
  }

  function isoWeekdayAbbrevToNum(ab){ // MO..SU → 1..7
    const map = { MO:1, TU:2, WE:3, TH:4, FR:5, SA:6, SU:7 };
    return map[ab?.toUpperCase()] || null;
  }

  // ---- 1) load schedule.json from common paths ----
  async function loadJSONWithFallback() {
    const paths = [
      "./schedule.json",
      "./schedule.json?_=" + Date.now(),
      "data/schedule.json",
      "data/schedule.json?_=" + Date.now()
    ];

    let lastError = null;
    for (const p of paths) {
      try {
        const res = await fetch(p, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status + " for " + p);
        const json = await res.json();
        log("Loaded JSON from", p);
        return { json, path: p };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error("schedule.json not found at any known path");
  }

  // ---- 2) normalize to v2 structure (back-compatible) ----
  function normalize(raw){
    // Buildings
    const buildings = Array.isArray(raw.buildings) && raw.buildings.length
      ? raw.buildings
      : [{
          id: "GF",
          name: "Gedung Fisika",
          rooms: (raw.rooms || ["1201","1202","1203","1204","1205","Ruang Staf Lama","Ruang Staf Baru"])
                 .map(r => (typeof r === "string" ? r : r.id || String(r))).map(s => s.includes("-") ? s : "GF-" + s)
        }];

    // Combinables (optional)
    const combinables = Array.isArray(raw.combinables) ? raw.combinables : [];

    // Bookings list
    const src = Array.isArray(raw.bookings) ? raw.bookings : [];
    const bookings = src.map(b => {
      // rooms normalization: support {room_id:"GF-1201"} or {rooms:["AX-A","AX-B"]}
      let rooms = Array.isArray(b.rooms) ? b.rooms.slice() : (b.room_id ? [b.room_id] : []);
      rooms = rooms.map(r => String(r));

      // building id: use explicit or derive from first room prefix (e.g., "GF-1201" → "GF")
      const building_id = b.building_id
        ? String(b.building_id)
        : (rooms[0] && rooms[0].includes("-") ? rooms[0].split("-")[0] : "GF");

      const status = String(b.status || "").toLowerCase();

      return {
        ...b,
        id: String(b.id || `${building_id}-${Math.random().toString(36).slice(2,8)}`),
        building_id,
        rooms,
        status
      };
    });

    return {
      version: raw.version || 1,
      updated_at: raw.updated_at || null,
      buildings,
      combinables,
      bookings
    };
  }

  // ---- 3) expand merged rooms → per-room rows for renderers ----
  function expandForRender(bookings){
    const out = [];
    for (const b of bookings) {
      const label = b.rooms.join("+");
      const gid   = b.id + "::" + label;
      for (const r of b.rooms) {
        out.push({ ...b, room: r, label, group_id: gid });
      }
    }
    return out;
  }

  // ---- 4) populate filters if they exist (non-breaking) ----
  function populateFilters(meta){
    const bSel = document.getElementById("buildingFilter");
    const rSel = document.getElementById("roomFilter");
    if (!bSel || !rSel) return;

    // Building list
    bSel.innerHTML = "";
    const allB = document.createElement("option");
    allB.value = "all"; allB.textContent = "Semua gedung";
    bSel.appendChild(allB);
    for (const b of meta.buildings) {
      const o = document.createElement("option");
      o.value = b.id; o.textContent = b.name || b.id;
      bSel.appendChild(o);
    }

    // Populate rooms for selected building (or all)
    const rebuildRooms = () => {
      const bid = bSel.value || "all";
      rSel.innerHTML = "";
      const allR = document.createElement("option");
      allR.value = "all"; allR.textContent = "Semua ruangan";
      rSel.appendChild(allR);

      let rooms = [];
      if (bid === "all") {
        meta.buildings.forEach(b => rooms.push(...b.rooms));
      } else {
        const bb = meta.buildings.find(x => x.id === bid);
        rooms = bb ? bb.rooms.slice() : [];
      }
      for (const id of rooms) {
        const o = document.createElement("option");
        o.value = id; o.textContent = id;
        rSel.appendChild(o);
      }
    };

    bSel.addEventListener("change", rebuildRooms);
    rebuildRooms();
  }

  // ---- 5) apply UI filters (building/room/status) ----
  function applyFilters(rows){
    const bSel = document.getElementById("buildingFilter");
    const rSel = document.getElementById("roomFilter");
    const sSel = document.getElementById("statusFilter");

    const bid = bSel ? bSel.value : "all";
    const rid = rSel ? rSel.value : "all";
    const sid = sSel ? sSel.value : "all";

    return rows.filter(b => {
      if (bid !== "all" && b.building_id !== bid) return false;
      if (rid !== "all" && b.room !== rid) return false;
      if (sid !== "all" && (b.status || "") !== sid) return false;
      return true;
    });
  }

  // ---- 6) minimal fallback renderer (so you can SEE data even if your calendar doesn’t hook yet) ----
  function ensureFallbackContainer(){
    let c = document.getElementById("fallbackSchedule");
    if (c) return c;
    c = document.createElement("div");
    c.id = "fallbackSchedule";
    c.style.marginTop = "10px";
    c.style.fontSize = "13px";
    // Put it after controls if possible
    const controls = document.querySelector(".controls") || document.body;
    controls.insertAdjacentElement("afterend", c);
    return c;
  }

  function renderFallback(rows){
    const c = ensureFallbackContainer();
    if (!rows.length) {
      c.innerHTML = '<div style="color:#6b7280">Tidak ada data jadwal untuk filter saat ini.</div>';
      return;
    }
    const head = `
      <thead><tr>
        <th align="left">Building</th>
        <th align="left">Room</th>
        <th align="left">When</th>
        <th align="left">Title</th>
        <th align="left">Status</th>
        <th align="left">By</th>
      </tr></thead>`;
    const body = rows.slice(0, 200).map(b => {
      const when = (b.start_dt && b.end_dt)
        ? `${b.start_dt} → ${b.end_dt}`
        : `${b.date_from || ""}..${b.date_to || ""} ${Array.isArray(b.byweekday)?b.byweekday.join(","):''} ${b.start||''}-${b.end||''}`;
      return `<tr>
        <td>${b.building_id}</td>
        <td>${b.room}${b.label && b.label.length>1 ? ` <span style="opacity:.7">(${b.label})</span>` : ""}</td>
        <td>${when}</td>
        <td>${b.title || ""}</td>
        <td>${b.status || ""}</td>
        <td>${(b.by_role ? "["+b.by_role+"] " : "") + (b.by_name || "")}</td>
      </tr>`;
    }).join("");
    c.innerHTML = `<div style="margin:6px 0; font-weight:600;">Pratinjau Data (fallback)</div>
                   <table style="border-collapse:collapse; width:100%;">
                     ${head}
                     <tbody>${body}</tbody>
                   </table>`;
  }

  // ---- 7) main boot ----
  onReady(async function(){
    try {
      const { json, path } = await loadJSONWithFallback();
      const meta = normalize(json);
      populateFilters(meta);

      // Expand merged rooms into per-room rows
      const expanded = expandForRender(meta.bookings);

      // Apply current UI filters
      let filtered = applyFilters(expanded);

      // 7.a) If your app provides a hook, call it
      if (typeof window.onScheduleDataLoaded === "function") {
        log("Using onScheduleDataLoaded hook with", filtered.length, "rows");
        window.onScheduleDataLoaded(filtered, meta);
      } else {
        // 7.b) Otherwise render a small table so you can verify data
        log("No app hook found; using fallback table renderer");
        renderFallback(filtered);
      }

      // Re-render on filter changes
      ["buildingFilter","roomFilter","statusFilter"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", () => {
          const rows = applyFilters(expanded);
          if (typeof window.onScheduleDataLoaded === "function") {
            window.onScheduleDataLoaded(rows, meta);
          } else {
            renderFallback(rows);
          }
        });
      });

    } catch (e) {
      err("Failed to load/parse schedule.json:", e);
      const c = ensureFallbackContainer();
      c.innerHTML = `<div style="color:#dc2626">Gagal memuat schedule.json — ${String(e.message || e)}</div>`;
    }
  });

})();
</script>
