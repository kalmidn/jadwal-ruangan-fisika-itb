/* adapter.v2.2.js — robust loader + normalizer + fallback renderer */
/* eslint-env browser */
"use strict";

(function () {
  // ---------- small helpers ----------
  function log() { console.log("[schedule-adapter]", ...arguments); }
  function err() { console.error("[schedule-adapter]", ...arguments); }

  function onReady(cb) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, { once: true });
    } else {
      cb();
    }
  }

  // ---------- load schedule.json from common paths ----------
  async function loadJSONWithFallback() {
    const paths = [
      "./schedule.json",
      "./schedule.json?_=" + Date.now(),
      "data/schedule.json",
      "data/schedule.json?_=" + Date.now()
    ];
    let lastError = null;
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      try {
        const res = await fetch(p, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status + " for " + p);
        const json = await res.json();
        log("Loaded JSON from", p);
        return { json: json, path: p };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error("schedule.json not found at any known path");
  }

  // ---------- normalize to v2 (back-compatible with v1) ----------
  function normalize(raw) {
    // buildings
    var buildings;
    if (Array.isArray(raw.buildings) && raw.buildings.length > 0) {
      buildings = raw.buildings;
    } else {
      // fallback to old single-building schema
      var fallbackRooms = raw.rooms || [
        "1201", "1202", "1203", "1204", "1205", "Ruang Staf Lama", "Ruang Staf Baru"
      ];
      buildings = [{
        id: "GF",
        name: "Gedung Fisika",
        rooms: fallbackRooms.map(function (r) {
          var s = typeof r === "string" ? r : (r && (r.id || String(r))) || "";
          return s.indexOf("-") !== -1 ? s : "GF-" + s;
        })
      }];
    }

    var combinables = Array.isArray(raw.combinables) ? raw.combinables : [];

    // bookings
    var src = Array.isArray(raw.bookings) ? raw.bookings : [];
    var bookings = src.map(function (b) {
      var rooms = Array.isArray(b.rooms) ? b.rooms.slice() : (b.room_id ? [String(b.room_id)] : []);
      rooms = rooms.map(function (r) { return String(r); });

      var building_id = b.building_id
        ? String(b.building_id)
        : (rooms[0] && rooms[0].indexOf("-") !== -1 ? rooms[0].split("-")[0] : "GF");

      var status = String(b.status || "").toLowerCase();

      var id = b.id
        ? String(b.id)
        : (building_id + "-" + Math.random().toString(36).slice(2, 8));

      return Object.assign({}, b, {
        id: id,
        building_id: building_id,
        rooms: rooms,
        status: status
      });
    });

    return {
      version: raw.version || 1,
      updated_at: raw.updated_at || null,
      buildings: buildings,
      combinables: combinables,
      bookings: bookings
    };
  }

  // ---------- expand merged bookings to per-room rows ----------
  function expandForRender(bookings) {
    var out = [];
    for (var i = 0; i < bookings.length; i++) {
      var b = bookings[i];
      var label = b.rooms.join("+");
      var gid = b.id + "::" + label;
      for (var j = 0; j < b.rooms.length; j++) {
        var r = b.rooms[j];
        out.push(Object.assign({}, b, { room: r, label: label, group_id: gid }));
      }
    }
    return out;
  }

  // ---------- populate filters if present (non-breaking) ----------
  function populateFilters(meta) {
    var bSel = document.getElementById("buildingFilter");
    var rSel = document.getElementById("roomFilter");
    if (!bSel || !rSel) return;

    // building list
    bSel.innerHTML = "";
    var allB = document.createElement("option");
    allB.value = "all";
    allB.textContent = "Semua gedung";
    bSel.appendChild(allB);
    for (var i = 0; i < meta.buildings.length; i++) {
      var b = meta.buildings[i];
      var o = document.createElement("option");
      o.value = b.id;
      o.textContent = b.name || b.id;
      bSel.appendChild(o);
    }

    function rebuildRooms() {
      var bid = bSel.value || "all";
      rSel.innerHTML = "";
      var allR = document.createElement("option");
      allR.value = "all";
      allR.textContent = "Semua ruangan";
      rSel.appendChild(allR);

      var rooms = [];
      if (bid === "all") {
        for (var k = 0; k < meta.buildings.length; k++) {
          rooms = rooms.concat(meta.buildings[k].rooms);
        }
      } else {
        var bb = null;
        for (var m = 0; m < meta.buildings.length; m++) {
          if (meta.buildings[m].id === bid) { bb = meta.buildings[m]; break; }
        }
        rooms = bb ? bb.rooms.slice() : [];
      }

      for (var n = 0; n < rooms.length; n++) {
        var ro = document.createElement("option");
        ro.value = rooms[n];
        ro.textContent = rooms[n];
        rSel.appendChild(ro);
      }
    }

    bSel.addEventListener("change", rebuildRooms);
    rebuildRooms();
  }

  // ---------- apply UI filters ----------
  function applyFilters(rows) {
    var bSel = document.getElementById("buildingFilter");
    var rSel = document.getElementById("roomFilter");
    var sSel = document.getElementById("statusFilter");

    var bid = bSel ? bSel.value : "all";
    var rid = rSel ? rSel.value : "all";
    var sid = sSel ? sSel.value : "all";

    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (bid !== "all" && r.building_id !== bid) continue;
      if (rid !== "all" && r.room !== rid) continue;
      if (sid !== "all" && (r.status || "") !== sid) continue;
      out.push(r);
    }
    return out;
  }

  // ---------- minimal fallback renderer (so you SEE data) ----------
  function ensureFallbackContainer() {
    var c = document.getElementById("fallbackSchedule");
    if (c) return c;
    c = document.createElement("div");
    c.id = "fallbackSchedule";
    c.style.marginTop = "10px";
    c.style.fontSize = "13px";
    var controls = document.querySelector(".controls") || document.body;
    controls.insertAdjacentElement("afterend", c);
    return c;
  }

  function renderFallback(rows) {
    var c = ensureFallbackContainer();
    if (!rows.length) {
      c.innerHTML = '<div style="color:#6b7280">Tidak ada data jadwal untuk filter saat ini.</div>';
      return;
    }
    var head = '' +
      '<thead><tr>' +
      '<th align="left">Building</th>' +
      '<th align="left">Room</th>' +
      '<th align="left">When</th>' +
      '<th align="left">Title</th>' +
      '<th align="left">Status</th>' +
      '<th align="left">By</th>' +
      '</tr></thead>';
    var body = "";
    for (var i = 0; i < rows.length && i < 200; i++) {
      var b = rows[i];
      var when = (b.start_dt && b.end_dt)
        ? (b.start_dt + " → " + b.end_dt)
        : ((b.date_from || "") + ".." + (b.date_to || "") + " " +
           (Array.isArray(b.byweekday) ? b.byweekday.join(",") : "") +
           " " + (b.start || "") + "-" + (b.end || ""));
      body += "<tr>" +
        "<td>" + (b.building_id || "") + "</td>" +
        "<td>" + (b.room || "") + (b.label && b.label.length > 1 ? ' <span style="opacity:.7">(' + b.label + ")</span>" : "") + "</td>" +
        "<td>" + when + "</td>" +
        "<td>" + (b.title || "") + "</td>" +
        "<td>" + (b.status || "") + "</td>" +
        "<td>" + ((b.by_role ? "[" + b.by_role + "] " : "") + (b.by_name || "")) + "</td>" +
        "</tr>";
    }
    c.innerHTML =
      '<div style="margin:6px 0; font-weight:600;">Pratinjau Data (fallback)</div>' +
      '<table style="border-collapse:collapse; width:100%;">' +
      head +
      "<tbody>" + body + "</tbody>" +
      "</table>";
  }

  // ---------- main boot ----------
  onReady(function () {
    (async function () {
      try {
        var loaded = await loadJSONWithFallback();
        var meta = normalize(loaded.json);
        populateFilters(meta);

        var expanded = expandForRender(meta.bookings);
        var filtered = applyFilters(expanded);

        if (typeof window.onScheduleDataLoaded === "function") {
          log("Using onScheduleDataLoaded hook with", filtered.length, "rows");
          window.onScheduleDataLoaded(filtered, meta);
        } else {
          log("No app hook found; using fallback table renderer");
          renderFallback(filtered);
        }

        var ids = ["buildingFilter", "roomFilter", "statusFilter"];
        for (var i = 0; i < ids.length; i++) {
          var el = document.getElementById(ids[i]);
          if (!el) continue;
          el.addEventListener("change", function () {
            var rows = applyFilters(expanded);
            if (typeof window.onScheduleDataLoaded === "function") {
              window.onScheduleDataLoaded(rows, meta);
            } else {
              renderFallback(rows);
            }
          });
        }
      } catch (e) {
        err("Failed to load/parse schedule.json:", e);
        var c = ensureFallbackContainer();
        c.innerHTML = '<div style="color:#dc2626">Gagal memuat schedule.json — ' +
                      String(e && (e.message || e)) + "</div>";
      }
    })();
  });
})();
