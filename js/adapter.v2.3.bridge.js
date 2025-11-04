/* adapter.v2.3.bridge.js — feed legacy calendar by emulating old schedule.json */
/* eslint-env browser */
"use strict";

(function () {
  // ---------- helpers ----------
  function log() { console.log("[schedule-bridge]", ...arguments); }
  function err() { console.error("[schedule-bridge]", ...arguments); }

  function onReady(cb) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, { once: true });
    } else {
      cb();
    }
  }

  // ---------- load v2 JSON from common paths ----------
  async function loadV2() {
    const paths = [
      "data/schedule.json?_=" + Date.now(),
      "data/schedule.json",
      "./schedule.json?_=" + Date.now(),
      "./schedule.json"
    ];
    let lastError = null;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      try {
        const res = await fetch(p, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status + " for " + p);
        const json = await res.json();
        log("Loaded v2 data from", p);
        return json;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error("schedule.json not found");
  }

  // ---------- normalize buildings + bookings (accept v1 or v2) ----------
  function normalize(raw) {
    const buildings = Array.isArray(raw.buildings) && raw.buildings.length
      ? raw.buildings
      : [{
          id: "GF",
          name: "Gedung Fisika",
          rooms: (raw.rooms || [
            "1201","1202","1203","1204","1205","Ruang Staf Lama","Ruang Staf Baru"
          ]).map(r => (typeof r === "string" ? r : (r && (r.id || String(r))) || "" ))
           .map(s => s.includes("-") ? s : ("GF-" + s))
        }];

    const bookingsSrc = Array.isArray(raw.bookings) ? raw.bookings : [];
    const bookings = bookingsSrc.map(b => {
      const rooms = Array.isArray(b.rooms)
        ? b.rooms.slice().map(String)
        : (b.room_id ? [String(b.room_id)] : []);
      const building_id = b.building_id
        ? String(b.building_id)
        : (rooms[0] && rooms[0].includes("-") ? rooms[0].split("-")[0] : "GF");
      const status = String(b.status || "").toLowerCase();
      const id = b.id ? String(b.id) : (building_id + "-" + Math.random().toString(36).slice(2, 8));
      return { ...b, id, rooms, building_id, status };
    });

    return { buildings, bookings, updated_at: raw.updated_at || null };
  }

  // ---------- expand merged rooms to per-room entries (legacy expects single room) ----------
  function expandPerRoom(b) {
    const label = b.rooms.join("+");
    const gid = b.id + "::" + label;
    return b.rooms.map(room_id => ({ ...b, room_id, label, group_id: gid }));
  }

  // ---------- convert to legacy JSON your app expects ----------
  // Legacy row rules (based on your earlier dataset):
  // - Weekly recurrence: date_from, date_to, byweekday[], start, end
  // - One-off: start_dt, end_dt (ISO 8601)
  // - Always: id, room_id, status, title, by_role/by_name (optional)
  function toLegacyJSON(meta) {
    const legacyRows = [];

    meta.bookings.forEach(b => {
      const rows = expandPerRoom(b);
      rows.forEach(r => {
        // Copy common fields
        const common = {
          id: r.id,
          room_id: r.room_id,
          status: r.status,           // "fixed" | "approved" | "pending"
          title: r.title || "",
          by_role: r.by_role || null,
          by_name: r.by_name || null,
          // optional decoration for UI (harmless if unused)
          _building_id: r.building_id,
          _merge_label: r.label
        };

        // Weekly vs one-off
        if (r.start_dt && r.end_dt) {
          // already one-off
          legacyRows.push({
            ...common,
            start_dt: r.start_dt,
            end_dt: r.end_dt
          });
        } else if (r.date_from && r.date_to && r.byweekday && r.start && r.end) {
          // weekly recurrence (already in legacy shape)
          legacyRows.push({
            ...common,
            date_from: r.date_from,
            date_to: r.date_to,
            byweekday: r.byweekday.slice(),
            start: r.start,
            end: r.end
          });
        } else if (r.start && r.end && r.date) {
          // rare: single date + start/end (convert to one-off ISO)
          const sd = r.date + "T" + r.start + ":00";
          const ed = r.date + "T" + r.end + ":00";
          legacyRows.push({ ...common, start_dt: sd, end_dt: ed });
        } else {
          // If v2 provided pure ISO datetimes, keep them
          if (r.start && r.end && r.start.includes("T")) {
            legacyRows.push({ ...common, start_dt: r.start, end_dt: r.end });
          } else {
            // If missing pieces, drop silently to avoid breaking calendar
            // (or you can log for diagnostics)
            // log("Skipped incomplete booking:", r);
          }
        }
      });
    });

    // Keep a top-level object (most legacy apps expect an object, not a bare array)
    return { bookings: legacyRows, updated_at: meta.updated_at };
  }

  // ---------- monkey-patch fetch to serve legacy JSON at schedule.json ----------
  function installFetchBridge(legacyJSON) {
    const originalFetch = window.fetch.bind(window);
    const LEGACY = JSON.stringify(legacyJSON);

    window.fetch = async function (input, init) {
      let url = (typeof input === "string") ? input : (input && input.url) || "";
      // Be permissive: if the filename ends with schedule.json (with or without path/query)
      const bare = url.split("?")[0];
      if (bare.endsWith("/schedule.json") || bare.endsWith("schedule.json")) {
        log("Intercepted request for", url, "→ returning legacy schedule.json");
        return new Response(LEGACY, {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return originalFetch(input, init);
    };
  }

  // ---------- boot ----------
  onReady(function () {
    (async function () {
      try {
        const raw = await loadV2();
        const meta = normalize(raw);
        const legacy = toLegacyJSON(meta);
        installFetchBridge(legacy);

        // If your app already booted and tried to fetch earlier, trigger a soft reload:
        // (Most apps fetch on load; this ensures they refetch after we patched fetch.)
        if (document.visibilityState !== "prerender") {
          // Try to nudge: dispatch a custom event many apps listen to, then fallback to reload
          window.dispatchEvent(new Event("schedule:reload"));
          // If nothing listens, a soft reload usually makes the app fetch again
          setTimeout(function () {
            // Only reload once per session to avoid loops
            if (!sessionStorage.getItem("scheduleBridgeReloaded")) {
              sessionStorage.setItem("scheduleBridgeReloaded", "1");
              location.reload();
            }
          }, 80);
        }

        log("Bridge active — legacy `schedule.json` is now virtual and fed from v2.");

      } catch (e) {
        err("Bridge failed:", e);
        // As last resort, leave things as-is (your app may still read its own JSON)
      }
    })();
  });
})();
