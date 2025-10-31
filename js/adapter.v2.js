<script>
(async function(){
  // 1) Load schedule.json (cache-busted)
  async function loadSchedule() {
    const res = await fetch('data/schedule.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('schedule.json not found');
    const raw = await res.json();

    // Back-compat buildings
    const buildings = raw.buildings ?? [{
      id: 'GF',
      name: 'Gedung Fisika',
      rooms: (raw.rooms ?? []).map(r => r.id)  // fallback to old rooms list if present
    }];

    const combinables = raw.combinables ?? [];

    // Normalize bookings
    const bookings = (raw.bookings ?? []).map(b => {
      const rooms = b.rooms ?? (b.room_id ? [b.room_id] : []);
      const lower = (b.status || '').toLowerCase();
      return {
        ...b,
        building_id: b.building_id ?? (rooms[0]?.split('-')[0] || 'GF'),
        rooms,
        status: lower
      };
    });

    return { buildings, combinables, bookings, raw };
  }

  // 2) Expand merged bookings to per-room (A+B shows in both columns)
  function expandForRender(bookings) {
    const out = [];
    bookings.forEach(b => {
      const label = b.rooms.join('+');
      const gid = b.id + '::' + label;
      b.rooms.forEach(room => out.push({ ...b, room, label, group_id: gid }));
    });
    return out;
  }

  // 3) Populate the building & room selects if present
  function populateFilters(data) {
    const bSel = document.getElementById('buildingFilter');
    const rSel = document.getElementById('roomFilter');
    if (!bSel || !rSel) return;

    // Building
    bSel.innerHTML = '<option value="all">Semua gedung</option>';
    data.buildings.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id; opt.textContent = b.name;
      bSel.appendChild(opt);
    });

    bSel.onchange = () => rebuildRooms(data);

    // Initial rooms
    rebuildRooms(data);
  }

  function rebuildRooms(data) {
    const bSel = document.getElementById('buildingFilter');
    const rSel = document.getElementById('roomFilter');
    if (!bSel || !rSel) return;

    const bid = bSel.value;
    rSel.innerHTML = '<option value="all">Semua ruangan</option>';

    let rooms = [];
    if (bid === 'all') {
      data.buildings.forEach(b => rooms.push(...b.rooms));
    } else {
      rooms = (data.buildings.find(b => b.id === bid) || {}).rooms || [];
    }
    rooms.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      rSel.appendChild(opt);
    });
  }

  // 4) Filter helpers (by building/room/status)
  function applyFilters(items) {
    const bSel = document.getElementById('buildingFilter');
    const rSel = document.getElementById('roomFilter');
    const sSel = document.getElementById('statusFilter');

    const bid = bSel ? bSel.value : 'all';
    const rid = rSel ? rSel.value : 'all';
    const sid = sSel ? sSel.value : 'all';

    return items.filter(b => {
      if (bid !== 'all' && b.building_id !== bid) return false;
      if (rid !== 'all' && b.room !== rid) return false;
      if (sid !== 'all' && (b.status || '') !== sid) return false;
      return true;
    });
  }

  // 5) Patch your renderer entry-point
  //    We assume your app exposes a global render function like window.renderDay/Month or a boot hook.
  //    If not, we can replace the boot completely—ping me if that’s the case.

  const data = await loadSchedule();
  populateFilters(data);

  // Try to detect your global grid builders (day/month). If not found, we skip gracefully.
  const tryRender = () => {
    const expanded = expandForRender(data.bookings);
    const filtered = applyFilters(expanded);

    // If your app exposes public functions, call them here.
    if (window.renderFromExternalData) {
      window.renderFromExternalData(filtered); // hypothetical hook
    } else {
      // Fallback: dispatch a custom event so your existing code can listen & render
      window.dispatchEvent(new CustomEvent('schedule:data', { detail: { rows: filtered, raw: data.raw } }));
    }
  };

  // Re-render when filters change
  ['buildingFilter','roomFilter','statusFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', tryRender);
  });

  // Initial render
  tryRender();
})();
</script>
