/* adapter.v2.5.bridge.js — force legacy bare-array weekly feed */
/* eslint-env browser */
"use strict";

(function () {
  function log(){ console.log("[schedule-bridge]", ...arguments); }
  function err(){ console.error("[schedule-bridge]", ...arguments); }

  function onReady(cb){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, { once: true });
    } else {
      cb();
    }
  }

  // Load v2 JSON from common paths
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
        const r = await fetch(p, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + p);
        const j = await r.json();
        log("Loaded v2 data from", p);
        return j;
      }catch(e){ lastError = e; }
    }
    throw lastError || new Error("schedule.json not found");
  }

  // Normalize both v2 and old formats into {bookings}
  function normalize(raw){
    const bookingsSrc = Array.isArray(raw.bookings) ? raw.bookings : Array.isArray(raw) ? raw : [];
    const bookings = bookingsSrc.map(b => {
      const rooms = Array.isArray(b.rooms) ? b.rooms.map(String)
                  : b.room_id ? [String(b.room_id)] : [];
      const building_id = b.building_id
        ? String(b.building_id)
        : (rooms[0] && rooms[0].includes("-") ? rooms[0].split("-")[0] : "GF");
      const status = String(b.status || "").toLowerCase();
      const id = b.id ? String(b.id) : (building_id + "-" + Math.random().toString(36).slice(2,8));
      return { ...b, id, rooms, building_id, status };
    });
    return { bookings };
  }

  // Expand merged (rooms: ["AX-A","AX-B"]) → per-room rows
  function expandPerRoom(b){
    const label = b.rooms.join("+");
    const gid = b.id + "::" + label;
    return b.rooms.map(room_id => ({ ...b, room_id, label, group_id: gid }));
  }

  // Helpers
  const WD_ABBR = ["SU","MO","TU","WE","TH","FR","SA"];
  function pad2(n){ return n < 10 ? "0"+n : String(n); }
  function toYMD(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  function toHM(d){ return pad2(d.getHours())+":"+pad2(d.getMinutes()); }

  // Convert EVERYTHING to legacy WEEKLY **bare array**
  function toLegacyWeeklyBare(meta){
    const out = [];

    meta.bookings.forEach(b => {
      const rows = expandPerRoom(b);

      rows.forEach(r => {
        // If one-off ISO exists, convert to weekly-once (same date_from/date_to)
        if (r.start_dt && r.end_dt) {
          const ds = new Date(r.start_dt);
          const de = new Date(r.end_dt);
          if (!isNaN(ds) && !isNaN(de)) {
            out.push({
              id: String(r.id),
              room_id: String(r.room_id),
              date_from: toYMD(ds),
              date_to: toYMD(ds),
              byweekday: [ WD_ABBR[ds.getDay()] ],
              start: toHM(ds),
              end: toHM(de),
              status: String(r.status || ""),
              title: String(r.title || ""),
              by_role: r.by_role ? String(r.by_role) : "",
              by_name: r.by_name ? String(r.by_name) : ""
            });
            return;
          }
        }

        // Already weekly v1/v2
        if (r.date_from && r.date_to && Array.isArray(r.byweekday) && r.start && r.end) {
          out.push({
            id: String(r.id),
            room_id: String(r.room_id),
            date_from: String(r.date_from),
            date_to: String(r.date_to),
            byweekday: r.byweekday.map(String),
            start: String(r.start),
            end: String(r.end),
            status: String(r.status || ""),
            title: String(r.title || ""),
            by_role: r.by_role ? String(r.by_role) : "",
            by_name: r.by_name ? String(r.by_name) : ""
          });
          return;
        }

        // Single date + start/end → weekly-once
        if (r.date && r.start && r.end) {
          const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(r.date));
          let wd = "MO";
          if (parts) {
            const d = new Date(+parts[1], +parts[2]-1, +parts[3]);
            if (!isNaN(d)) wd = WD_ABBR[d.getDay()];
          }
          out.push({
            id: String(r.id),
            room_id: String(r.room_id),
            date_from: String(r.date),
            date_to: String(r.date),
            byweekday: [wd],
            start: String(r.start),
            end: String(r.end),
            status: String(r.status || ""),
            title: String(r.title || ""),
            by_role: r.by_role ? String(r.by_role) : "",
            by_name: r.by_name ? String(r.by_name) : ""
          });
          return;
        }

        // ISO start/end without weekly fields → weekly-once
        if (r.start && r.end && String(r.start).includes("T")) {
          const ds = new Date(r.start);
          const de = new Date(r.end);
          if (!isNaN(ds) && !isNaN(de)) {
            out.push({
              id: String(r.id),
              room_id: String(r.room_id),
              date_from: toYMD(ds),
              date_to: toYMD(ds),
              byweekday: [ WD_ABBR[ds.getDay()] ],
              start: toHM(ds),
              end: toHM(de),
              status: String(r.status || ""),
              title: String(r.title || ""),
              by_role: r.by_role ? String(r.by_role) : "",
              by_name: r.by_name ? String(r.by_name) : ""
            });
            return;
          }
        }

        // If we reach here, the row is incomplete; skip to avoid breaking calendar
      });
    });

    return out;
  }

  // Monkey-patch fetch to serve a **bare array** at schedule.json
  function installFetchBridge(legacyArray){
    const originalFetch = window.fetch.bind(window);
    const LEGACY = JSON.stringify(legacyArray);

    window.fetch = async function(input, init){
      const url = (typeof input === "string") ? input : (input && input.url) || "";
      const bare = (url.split("?")[0] || "");
      if (bare.endsWith("/schedule.json") || bare.endsWith("schedule.json")) {
        log("Intercepted", url, "→ returning legacy bare-array schedule.json");
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
        const legacyBare = toLegacyWeeklyBare(meta);
        installFetchBridge(legacyBare);

        // Nudge your app to refetch once
        setTimeout(function(){
          if (!sessionStorage.getItem("scheduleBridgeReloaded")){
            sessionStorage.setItem("scheduleBridgeReloaded","1");
            location.reload();
          }
        }, 60);

        log("Bridge active — legacy bare-array feed ready. Items:", legacyBare.length);
      }catch(e){
        err("Bridge failed:", e);
      }
    })();
  });
})();
