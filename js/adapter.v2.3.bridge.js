/* adapter.v2.4.bridge.js — always feed weekly legacy shape */
/* eslint-env browser */
"use strict";

(function () {
  function log(){ console.log("[schedule-bridge]", ...arguments); }
  function err(){ console.error("[schedule-bridge]", ...arguments); }
  function onReady(cb){ if (document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", cb, {once:true}); } else { cb(); } }

  // ---- load v2 from common paths ----
  async function loadV2(){
    const paths = [
      "data/schedule.json?_=" + Date.now(),
      "data/schedule.json",
      "./schedule.json?_=" + Date.now(),
      "./schedule.json"
    ];
    let lastError = null;
    for (const p of paths){
      try{
        const r = await fetch(p, {cache:"no-store"});
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + p);
        const j = await r.json();
        log("Loaded v2 data from", p);
        return j;
      }catch(e){ lastError = e; }
    }
    throw lastError || new Error("schedule.json not found");
  }

  // ---- normalize v2/v1 ----
  function normalize(raw){
    const buildings = Array.isArray(raw.buildings) && raw.buildings.length
      ? raw.buildings
      : [{
          id: "GF",
          name: "Gedung Fisika",
          rooms: (raw.rooms || ["1201","1202","1203","1204","1205","Ruang Staf Lama","Ruang Staf Baru"])
                 .map(r => typeof r==="string" ? r : (r && (r.id||String(r))) || "")
                 .map(s => s.includes("-") ? s : "GF-" + s)
        }];

    const bookings = (Array.isArray(raw.bookings) ? raw.bookings : []).map(b => {
      const rooms = Array.isArray(b.rooms) ? b.rooms.map(String) : (b.room_id ? [String(b.room_id)] : []);
      const building_id = b.building_id ? String(b.building_id)
                        : (rooms[0] && rooms[0].includes("-") ? rooms[0].split("-")[0] : "GF");
      const status = String(b.status || "").toLowerCase();
      const id = b.id ? String(b.id) : (building_id + "-" + Math.random().toString(36).slice(2,8));
      return {...b, id, rooms, building_id, status};
    });

    return { buildings, bookings, updated_at: raw.updated_at || null };
  }

  // ---- expand merged rooms (A+B -> 2 rows) ----
  function expandPerRoom(b){
    const label = b.rooms.join("+");
    const gid = b.id + "::" + label;
    return b.rooms.map(room_id => ({ ...b, room_id, label, group_id: gid }));
  }

  // ---- helpers for formatting ----
  const wdAbbrev = ["SU","MO","TU","WE","TH","FR","SA"]; // JS getDay(): 0..6
  function pad2(n){ return n < 10 ? "0"+n : String(n); }
  function toYMD(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  function toHM(d){ return pad2(d.getHours())+":"+pad2(d.getMinutes()); }

  // ---- convert EVERYTHING to weekly legacy rows ----
  function toLegacyWeekly(meta){
    const out = [];

    meta.bookings.forEach(b => {
      const rows = expandPerRoom(b);
      rows.forEach(r => {
        const common = {
          id: r.id,
          room_id: r.room_id,
          status: r.status,             // "fixed" | "approved" | "pending"
          title: r.title || "",
          by_role: r.by_role || null,
          by_name: r.by_name || null,
          _building_id: r.building_id,
          _merge_label: r.label
        };

        // Case 1: one-off ISO provided (start_dt/end_dt) → convert to weekly-once
        if (r.start_dt && r.end_dt) {
          const ds = new Date(r.start_dt);
          const de = new Date(r.end_dt);
          if (!isNaN(ds) && !isNaN(de)) {
            const ymd = toYMD(ds);
            const wd  = wdAbbrev[ds.getDay()];   // e.g., "WE"
            const st  = toHM(ds);
            const et  = toHM(de);
            out.push({
              ...common,
              date_from: ymd,
              date_to:   ymd,           // same day = one occurrence
              byweekday: [wd],
              start: st,
              end:   et
            });
            return;
          }
          // If parse failed, drop through to other cases
        }

        // Case 2: already weekly in v2/v1
        if (r.date_from && r.date_to && Array.isArray(r.byweekday) && r.start && r.end) {
          out.push({
            ...common,
            date_from: String(r.date_from),
            date_to:   String(r.date_to),
            byweekday: r.byweekday.map(String),
            start:     String(r.start),
            end:       String(r.end)
          });
          return;
        }

        // Case 3: single date + start/end (rare) → convert to weekly-once
        if (r.date && r.start && r.end) {
          const ymd = String(r.date);
          // Try to deduce weekday from ymd; fallback to MO
          let wd = "MO";
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
          if (m) {
            const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
            if (!isNaN(d)) wd = wdAbbrev[d.getDay()];
          }
          out.push({
            ...common,
            date_from: ymd,
            date_to:   ymd,
            byweekday: [wd],
            start: String(r.start),
            end:   String(r.end)
          });
          return;
        }

        // Case 4: start/end are ISO strings (without weekly fields) → convert to weekly-once
        if (r.start && r.end && String(r.start).includes("T")) {
          const ds = new Date(r.start);
          const de = new Date(r.end);
          if (!isNaN(ds) && !isNaN(de)) {
            const ymd = toYMD(ds);
            const wd  = wdAbbrev[ds.getDay()];
            out.push({
              ...common,
              date_from: ymd,
              date_to:   ymd,
              byweekday: [wd],
              start: toHM(ds),
              end:   toHM(de)
            });
            return;
          }
        }

        // If we reach here, data was incomplete → skip to avoid breaking calendar
        // Uncomment for debugging:
        // log("Skipped incomplete booking (no weekly/one-off data):", r);
      });
    });

    return { bookings: out, updated_at: meta.updated_at };
  }

  // ---- fetch monkey-patch: always serve weekly legacy at schedule.json ----
  function installFetchBridge(legacyJSON){
    const originalFetch = window.fetch.bind(window);
    const LEGACY = JSON.stringify(legacyJSON);

    window.fetch = async function(input, init){
      const url = (typeof input === "string") ? input : (input && input.url) || "";
      const bare = url.split("?")[0] || "";
      if (bare.endsWith("/schedule.json") || bare.endsWith("schedule.json")) {
        log("Intercepted", url, "→ legacy weekly schedule.json");
        return new Response(LEGACY, {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return originalFetch(input, init);
    };
  }

  onReady(function(){
    (async function(){
      try{
        const raw = await loadV2();
        const meta = normalize(raw);
        const legacy = toLegacyWeekly(meta);          // <-- ALWAYS weekly fields present
        installFetchBridge(legacy);

        // Nudge app to refetch once
        setTimeout(function(){
          if (!sessionStorage.getItem("scheduleBridgeReloaded")){
            sessionStorage.setItem("scheduleBridgeReloaded","1");
            location.reload();
          }
        }, 60);

        log("Bridge active — weekly legacy feed ready.");

      }catch(e){
        err("Bridge failed:", e);
      }
    })();
  });
})();
