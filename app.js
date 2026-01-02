// app.js
(function(){
  'use strict';

  // =========================
  // Data model
  // =========================
  function defaultData(){
    return {
      meta: {
        title: 'Nieuwe route',
        subtitle: '',
        version: '1.0'
        // characters optioneel
      },
      settings: {
        visibilityMode: 'nextOnly',
        multiLocationSlotMode: 'all',
        showOptionalSlots: true,
        listShowFutureSlots: true,
        mapShowFutureLocations: false
      },
      prestart: {
        useLocationId: '',
        meetingPoint: { lat: 51.220418, lng: 4.440854, label: 'Aan de voordeur' },
        message: 'Nog niet aan het startpunt. Ga naar de startlocatie om te beginnen.',
        maps: { label: 'Route naar startpunt' },
        images: []
      },
      slots: [
        { id:'start', label:'Start', required:true }
      ],
      locaties: []
    };
  }

  var DATA = defaultData();

  // =========================
  // State
  // =========================
  var map = null;
  var markerLayer = null;
  var routeLayer = null;

  var showRouteArrows = true;
  var showLocLabels = true;

  var meetingMarker = null;
  var meetingPickMode = false;

  // locationId -> {marker, circle}
  var locRender = {};

  // =========================
  // Helpers
  // =========================
  function byId(id){ return document.getElementById(id); }

  function esc(s){
    s = (s==null ? '' : String(s));
    return s.replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
  }

  function existsIn(list, key, value){
    for(var i=0;i<list.length;i++){
      if(list[i] && list[i][key] === value) return true;
    }
    return false;
  }

  function uniqueId(prefix, list, key){
    var i=1, id;
    do{
      id = prefix + String(i).padStart(2,'0');
      i++;
    }while(existsIn(list, key, id));
    return id;
  }

  function findLocById(id){
    for(var i=0;i<DATA.locaties.length;i++){
      if(DATA.locaties[i].id===id) return DATA.locaties[i];
    }
    return null;
  }

  function slotIds(){
    var ids=[];
    for(var i=0;i<DATA.slots.length;i++){
      if(DATA.slots[i] && DATA.slots[i].id) ids.push(DATA.slots[i].id);
    }
    return ids;
  }

  function getSlotById(slotId){
    for(var i=0;i<DATA.slots.length;i++){
      var s = DATA.slots[i];
      if(s && s.id === slotId) return s;
    }
    return null;
  }

  function isSlotRequired(slotId){
    var s = getSlotById(slotId);
    return !!(s && s.required);
  }

  function isStartSlot(slotId){ return slotId === 'start'; }
  function isEndSlot(slotId){ return slotId === 'end'; }

  function getSlotLocationCounts(){
    var counts = {};
    if(!DATA || !DATA.locaties) return counts;
    for(var i=0;i<DATA.locaties.length;i++){
      var l = DATA.locaties[i];
      if(!l || !l.slot) continue;
      counts[l.slot] = (counts[l.slot] || 0) + 1;
    }
    return counts;
  }

  function getLocationsBySlot(){
    var mapBySlot = {};
    for(var i=0;i<DATA.locaties.length;i++){
      var l = DATA.locaties[i];
      if(!l || !l.slot) continue;
      if(l.lat == null || l.lng == null) continue;

      if(!mapBySlot[l.slot]) mapBySlot[l.slot] = [];
      mapBySlot[l.slot].push({ lat:l.lat, lng:l.lng, id:l.id });
    }
    return mapBySlot;
  }

  function bearingDeg(from, to){
    // simpele bearing in graden (voldoende voor visueel)
    var dy = to.lat - from.lat;
    var dx = to.lng - from.lng;
    var rad = Math.atan2(dy, dx);
    return rad * 180 / Math.PI;
  }

  // =========================
  // Map init + legend
  // =========================
  function initMap(){
    map = L.map('map').setView([51.220418, 4.440854], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
    routeLayer  = L.layerGroup().addTo(map);

    // map click handler
    map.on('click', function(e){
      if(meetingPickMode){
        meetingPickMode = false;
        setMeetingPoint(e.latlng.lat, e.latlng.lng);
        renderMeetingMarker();
        return;
      }
      addLocFromMap(e.latlng.lat, e.latlng.lng);
    });

    initLegend();
  }

  function initLegend(){
    var legendCtrl = L.control({ position: 'topright' });

    legendCtrl.onAdd = function(){
      var div = L.DomUtil.create('div', 'mapLegend');

      div.innerHTML =
        '<div class="lgTitle" id="legendTitle" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px">' +
        '  <span>Legenda</span>' +
        '  <span id="legendChevron" style="opacity:.75">▾</span>' +
        '</div>' +

        '<div id="legendBody">' +

        '  <div class="lgToggle" style="margin-top:8px">' +
        '    <input id="toggleLabels" type="checkbox" checked>' +
        '    <label for="toggleLabels">Toon labels</label>' +
        '  </div>' +

        '  <div class="lgRow"><span class="swCircle swStart"></span> Start</div>' +
        '  <div class="lgRow"><span class="swCircle swEnd"></span> Eind</div>' +

        '  <div class="lgRow" style="margin-top:6px"><span class="swCircle swReqSingle"></span> Vereist</div>' +
        '  <div class="lgRow"><span class="swCircle swReqMulti"></span> Vereist (meerdere locaties)</div>' +
        '  <div class="lgRow"><span class="swCircle swOptSingle"></span> Optioneel</div>' +
        '  <div class="lgRow"><span class="swCircle swOptMulti"></span> Optioneel (meerdere locaties)</div>' +

        '  <div class="lgToggle" style="margin-top:8px">' +
        '    <input id="toggleRouteArrows" type="checkbox" checked>' +
        '    <label for="toggleRouteArrows">Toon routelijnen</label>' +
        '  </div>' +

        '  <div id="arrowLegendDetails" style="margin-top:6px">' +
        '    <div class="lgRow"><span class="swLine"></span> Route naar vereist</div>' +
        '    <div class="lgRow"><span class="swLine opt"></span> Route naar optioneel</div>' +
        '  </div>' +

        '  <div class="lgActions">' +
        '    <button id="btnFitRoute" type="button">📍 Centreer op route</button>' +
        '  </div>' +

        '</div>';

      // voorkomen dat scroll/drag op de kaart “meepakt”
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };

    legendCtrl.addTo(map);

    // ✅ bindings pas nadat de legend in de DOM zit
    setTimeout(bindLegendUI, 0);
  }

  function bindLegendUI(){
    var title = byId('legendTitle');
    var body  = byId('legendBody');
    var chev  = byId('legendChevron');

    if(title && body){
      title.addEventListener('click', function(){
        var collapsed = body.style.display === 'none';
        body.style.display = collapsed ? 'block' : 'none';
        if(chev) chev.textContent = collapsed ? '▾' : '▸';
      });
    }

    var cbLab = byId('toggleLabels');
    if(cbLab){
      cbLab.checked = !!showLocLabels;
      cbLab.addEventListener('change', function(){
        showLocLabels = !!cbLab.checked;
        renderLocMarkers();
      });
    }

    var cb = byId('toggleRouteArrows');
    if(cb){
      cb.checked = !!showRouteArrows;
      cb.addEventListener('change', function(){
        showRouteArrows = !!cb.checked;
        drawRouteArrows();
        var details = byId('arrowLegendDetails');
        if(details) details.style.display = showRouteArrows ? 'block' : 'none';
      });
    }

    var b = byId('btnFitRoute');
    if(b){
      b.addEventListener('click', function(){
        fitMapToData();
      });
    }

    // init details visibility
    var details2 = byId('arrowLegendDetails');
    if(details2) details2.style.display = showRouteArrows ? 'block' : 'none';
  }

  // =========================
  // Meeting point
  // =========================
  function setMeetingPoint(lat,lng){
    DATA.prestart.meetingPoint.lat = lat;
    DATA.prestart.meetingPoint.lng = lng;
    var latEl = byId('preMeetingLat');
    var lngEl = byId('preMeetingLng');
    if(latEl) latEl.value = lat;
    if(lngEl) lngEl.value = lng;
  }

  function renderMeetingMarker(){
    var mp = DATA.prestart.meetingPoint;
    if(!mp || mp.lat==null || mp.lng==null) return;

    if(!meetingMarker){
      meetingMarker = L.marker([mp.lat, mp.lng], { draggable:true }).addTo(map);

      meetingMarker.on('drag', function(ev){
        var ll = ev.target.getLatLng();
        setMeetingPoint(ll.lat, ll.lng);
      });
      meetingMarker.on('dragend', function(ev){
        var ll = ev.target.getLatLng();
        setMeetingPoint(ll.lat, ll.lng);
        validateAndRender();
      });
    }

    meetingMarker.setLatLng([mp.lat, mp.lng]);
    var txt = mp.label ? mp.label : 'Meeting point';
    meetingMarker.bindPopup('<b>'+esc(txt)+'</b>').closePopup();
  }

  // =========================
  // Start-slot/prestart sync
  // =========================
  function ensureStartSlot(){
    for(var i=0;i<DATA.slots.length;i++){
      if(DATA.slots[i] && DATA.slots[i].id === 'start') return;
    }
    DATA.slots.unshift({ id:'start', label:'Start', required:true });
  }

  function getFirstStartLocationId(){
    for(var i=0;i<DATA.locaties.length;i++){
      var l = DATA.locaties[i];
      if(l && l.slot === 'start' && l.id) return l.id;
    }
    return null;
  }

  function createStartLocationFromMeetingPoint(){
    var mp = (DATA.prestart && DATA.prestart.meetingPoint) ? DATA.prestart.meetingPoint : null;
    var lat = mp && mp.lat!=null ? mp.lat : 51.220418;
    var lng = mp && mp.lng!=null ? mp.lng : 4.440854;

    var base = 'startloc';
    var id = base;
    var n = 1;
    while(findLocById(id)){
      n++;
      id = base + n;
    }

    var naam = (mp && mp.label) ? ('Start: ' + mp.label) : 'Startlocatie';

    var loc = {
      id: id,
      slot: 'start',
      naam: naam,
      lat: lat,
      lng: lng,
      radius: 50,
      images: [],
      routeHint: '',
      uitleg: { kort:'', uitgebreid:'' },
      vragen: []
    };

    DATA.locaties.unshift(loc);
    return id;
  }

  function makePrestartStartSlot(){
    ensureStartSlot();

    var startLocId = getFirstStartLocationId();
    if(!startLocId){
      startLocId = createStartLocationFromMeetingPoint();
    }

    if(!DATA.prestart) DATA.prestart = defaultData().prestart;
    DATA.prestart.useLocationId = startLocId;

    var loc = findLocById(startLocId);
    if(loc){
      if(!DATA.prestart.meetingPoint) DATA.prestart.meetingPoint = { lat:loc.lat, lng:loc.lng, label:'Start' };
      DATA.prestart.meetingPoint.lat = loc.lat;
      DATA.prestart.meetingPoint.lng = loc.lng;
      if(!DATA.prestart.meetingPoint.label) DATA.prestart.meetingPoint.label = 'Start';
    }
  }

  function syncPrestartToStartDataNonDestructive(){
    if(!DATA) return;

    if(!DATA.meta) DATA.meta = { title:'(import)', subtitle:'', version:'1.0' };
    if(!DATA.settings) DATA.settings = defaultData().settings;
    if(!DATA.prestart) DATA.prestart = defaultData().prestart;
    if(!DATA.slots) DATA.slots = [];
    if(!DATA.locaties) DATA.locaties = [];

    // startslot enkel toevoegen indien ontbreekt
    ensureStartSlot();

    // startloc id enkel invullen als leeg
    var startLocId = (DATA.prestart && DATA.prestart.useLocationId) ? DATA.prestart.useLocationId : '';
    if(!startLocId){
      var base = 'startloc';
      var id = base;
      var n = 1;
      while(findLocById(id)){
        n++;
        id = base + n;
      }
      startLocId = id;
      DATA.prestart.useLocationId = startLocId;
    }

    // startloc enkel aanmaken indien ontbreekt
    var loc = findLocById(startLocId);
    if(!loc){
      loc = {
        id: startLocId,
        slot: 'start',
        naam: 'Start',
        lat: null,
        lng: null,
        radius: 50,
        images: [],
        routeHint: '',
        uitleg: { kort:'', uitgebreid:'' },
        vragen: []
      };
      DATA.locaties.unshift(loc);
    } else {
      if(!loc.slot) loc.slot = 'start';
    }

    // meetingpoint aanvullen
    if(!DATA.prestart.meetingPoint){
      DATA.prestart.meetingPoint = { lat:null, lng:null, label:'Start' };
    }
    var mp = DATA.prestart.meetingPoint;
    if(!mp.label) mp.label = 'Start';

    if((mp.lat == null || mp.lng == null) && (loc.lat != null && loc.lng != null)){
      if(mp.lat == null) mp.lat = loc.lat;
      if(mp.lng == null) mp.lng = loc.lng;
    }
    if((loc.lat == null || loc.lng == null) && (mp.lat != null && mp.lng != null)){
      if(loc.lat == null) loc.lat = mp.lat;
      if(loc.lng == null) loc.lng = mp.lng;
    }

    if(loc.radius == null) loc.radius = 50;
    if(!loc.naam) loc.naam = 'Start';
  }

  // =========================
  // Locations add/render
  // =========================
  function getLastRadiusDefault(){
    if(DATA.locaties && DATA.locaties.length){
      var last = DATA.locaties[DATA.locaties.length-1];
      if(last && typeof last.radius === 'number' && !isNaN(last.radius)) return last.radius;
    }
    return 30;
  }

  function addLocFromMap(lat,lng){
    var locId = prompt('Locatie id?', uniqueId('loc', DATA.locaties, 'id'));
    if(!locId) return;

    if(findLocById(locId)){
      alert('Deze locatie-id bestaat al.');
      return;
    }

    var lastSlotId = (DATA.slots && DATA.slots.length && DATA.slots[DATA.slots.length-1].id)
      ? DATA.slots[DATA.slots.length-1].id
      : 'start';

    var slot = prompt('Slot id? (bv. start, stop01, end)', lastSlotId);
    if(!slot) slot = lastSlotId;
    if(!slot) slot = 'start';

    var naam = prompt('Naam?', locId) || locId;

    var loc = {
      id: locId,
      slot: slot,
      naam: naam,
      lat: lat,
      lng: lng,
      radius: getLastRadiusDefault(),
      images: [],
      routeHint: '',
      uitleg: { kort:'', uitgebreid:'' },
      vragen: []
    };
    DATA.locaties.push(loc);

    if(!DATA.prestart.useLocationId && slot === 'start'){
      DATA.prestart.useLocationId = locId;
    }

    renderAll();
  }

  function makeLabeledIcon(id, slot, slotCounts){
    var n = (slot && slotCounts && slotCounts[slot]) ? slotCounts[slot] : 0;
    var suffix = (n > 1) ? (' ×' + n) : '';
    var txt = (id || '') + (slot ? (' • ' + slot + suffix) : '');
    var extra = isStartSlot(slot) ? ' isStart' : (isEndSlot(slot) ? ' isEnd' : '');
    return L.divIcon({
      className: 'locLabelIcon',
      html: '<div class="locLabelBubble'+extra+'">'+esc(txt)+'</div>',
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });
  }

  function renderLocMarkers(){
    var COLOR_START = '#18a957';
    var COLOR_END   = '#d64545';
    var COLOR_REQ_SINGLE = '#2A81FF';
    var COLOR_MULTI = '#7B4CFF';
    var COLOR_OPT   = '#666';

    markerLayer.clearLayers();
    locRender = {};
    var slotCounts = getSlotLocationCounts();

    for(var i=0;i<DATA.locaties.length;i++){
      (function(){
        var loc = DATA.locaties[i];
        if(!loc || loc.lat==null || loc.lng==null) return;

        var markerOpts = { draggable:true };
        if(showLocLabels){
          markerOpts.icon = makeLabeledIcon(loc.id, loc.slot, slotCounts);
        }

        var m = L.marker([loc.lat, loc.lng], markerOpts).addTo(markerLayer);

        var req = isSlotRequired(loc.slot);
        var multi = (loc.slot && slotCounts[loc.slot] > 1);

        var circleOpts;

        if(req){
          circleOpts = {
            radius: (loc.radius || 50),
            weight: multi ? 3 : 2,
            color: multi ? COLOR_MULTI : COLOR_REQ_SINGLE,
            fillColor: multi ? COLOR_MULTI : COLOR_REQ_SINGLE,
            opacity: 0.9,
            fillOpacity: 0.10
          };
        }else{
          circleOpts = {
            radius: (loc.radius || 50),
            weight: 2,
            color: multi ? COLOR_MULTI : COLOR_OPT,
            fillColor: multi ? COLOR_MULTI : '#999',
            opacity: multi ? 0.85 : 0.75,
            fillOpacity: 0.05,
            dashArray: '10 10',
            lineCap: 'butt'
          };
        }

        if(isStartSlot(loc.slot)){
          circleOpts.color = COLOR_START;
          circleOpts.fillColor = COLOR_START;
          circleOpts.opacity = 0.95;
          circleOpts.fillOpacity = 0.10;
          if(circleOpts.dashArray) circleOpts.opacity = 0.75;
        }
        if(isEndSlot(loc.slot)){
          circleOpts.color = COLOR_END;
          circleOpts.fillColor = COLOR_END;
          circleOpts.opacity = 0.95;
          circleOpts.fillOpacity = 0.10;
        }

        var c = L.circle([loc.lat, loc.lng], circleOpts).addTo(markerLayer);

        m.on('drag', function(ev){
          var ll = ev.target.getLatLng();
          loc.lat = ll.lat;
          loc.lng = ll.lng;
          c.setLatLng(ll);
          renderLocsTable();
        });

        m.on('dragend', function(ev){
          var ll = ev.target.getLatLng();
          loc.lat = ll.lat;
          loc.lng = ll.lng;
          c.setLatLng(ll);
          validateAndRender();
          drawRouteArrows();
        });

        m.on('click', function(){
          openLocEditor(loc.id);
        });

        var popup = '<b>'+esc(loc.naam||loc.id)+'</b><br><span class="mini">'+esc(loc.id)+' · slot='+esc(loc.slot||'')+'</span>';
        m.bindPopup(popup);

        locRender[loc.id] = { marker:m, circle:c };
      })();
    }
  }

  // =========================
  // Route arrows (ONE definition)
  // =========================
  function drawRouteArrows(){
    routeLayer.clearLayers();
    if(!showRouteArrows) return;

    var bySlot = getLocationsBySlot();

    for(var i=0;i<DATA.slots.length;i++){
      var s = DATA.slots[i];
      if(!s || !s.id || !s.unlockAfterSlot) continue;

      var fromId = s.unlockAfterSlot;
      var toId = s.id;

      var fromPts = bySlot[fromId] || [];
      var toPts = bySlot[toId] || [];
      if(!fromPts.length || !toPts.length) continue;

      var toRequired = isSlotRequired(toId);

      var lineOpts = toRequired
        ? { weight: 2, opacity: 0.65 }
        : { weight: 2, opacity: 0.45, dashArray: '8 10', lineCap: 'butt' };

      for(var a=0;a<fromPts.length;a++){
        for(var b=0;b<toPts.length;b++){
          var from = fromPts[a];
          var to = toPts[b];

          L.polyline([[from.lat, from.lng],[to.lat, to.lng]], lineOpts)
            .addTo(routeLayer);

          // Pijl-icoon stond bij jou uitgecomment; laten we dat zo houden.
          // Als je het terug wil, plug je hier addArrowAt terug in.
          // var t = 0.85;
          // var arrowPos = { lat: from.lat + (to.lat-from.lat)*t, lng: from.lng + (to.lng-from.lng)*t };
          // var ang = bearingDeg(from, to) + 90;
          // addArrowAt(arrowPos, ang, toRequired).addTo(routeLayer);
          bearingDeg(from, to); // houdt functie "used" (optioneel)
        }
      }
    }
  }

  // =========================
  // UI bind
  // =========================
  function bindUI(){
    byId('btnNew').addEventListener('click', function(){
      DATA = defaultData();
      syncPrestartToStartDataNonDestructive();
      syncUIFromData();
      renderAll();
    });

    byId('btnExport').addEventListener('click', exportJson);
    byId('btnImport').addEventListener('click', function(){ byId('fileImport').click(); });
    byId('fileImport').addEventListener('change', importJsonFile);

    // meta
    byId('metaTitle').addEventListener('input', function(){ DATA.meta.title = this.value; });
    byId('metaSubtitle').addEventListener('input', function(){ DATA.meta.subtitle = this.value; });
    byId('metaVersion').addEventListener('input', function(){ DATA.meta.version = this.value; });

    byId('metaCharactersEnabled').addEventListener('change', function(){
      var enabled = !!this.checked;
      byId('metaCharactersBox').style.display = enabled ? 'block' : 'none';
      if(enabled){
        if(!DATA.meta.characters) DATA.meta.characters = { enabled:true, source:'personages.json' };
        DATA.meta.characters.enabled = true;
      }else{
        delete DATA.meta.characters;
      }
    });

    byId('metaCharactersSource').addEventListener('input', function(){
      if(!DATA.meta.characters) DATA.meta.characters = { enabled:true, source:'personages.json' };
      DATA.meta.characters.source = this.value;
    });

    // settings
    byId('setVisibilityMode').addEventListener('change', function(){ DATA.settings.visibilityMode = this.value; validateAndRender(); });
    byId('setMultiLocSlotMode').addEventListener('change', function(){ DATA.settings.multiLocationSlotMode = this.value; validateAndRender(); });
    byId('setShowOptionalSlots').addEventListener('change', function(){ DATA.settings.showOptionalSlots = !!this.checked; validateAndRender(); });
    byId('setListShowFutureSlots').addEventListener('change', function(){ DATA.settings.listShowFutureSlots = !!this.checked; validateAndRender(); });
    byId('setMapShowFutureLocations').addEventListener('change', function(){ DATA.settings.mapShowFutureLocations = !!this.checked; validateAndRender(); });

    // prestart (✅ maar één set listeners)
    byId('preUseLocationId').addEventListener('change', function(){
      DATA.prestart.useLocationId = this.value;
      syncPrestartToStartDataNonDestructive();
      renderAll();
    });

    byId('preMeetingLabel').addEventListener('input', function(){
      DATA.prestart.meetingPoint.label = this.value;
      syncPrestartToStartDataNonDestructive();
      renderAll();
    });

    byId('preMeetingLat').addEventListener('input', function(){
      DATA.prestart.meetingPoint.lat = parseFloat(this.value||0);
      syncPrestartToStartDataNonDestructive();
      renderAll();
    });

    byId('preMeetingLng').addEventListener('input', function(){
      DATA.prestart.meetingPoint.lng = parseFloat(this.value||0);
      syncPrestartToStartDataNonDestructive();
      renderAll();
    });

    byId('preMessage').addEventListener('input', function(){ DATA.prestart.message = this.value; });
    byId('preMapsLabel').addEventListener('input', function(){ DATA.prestart.maps.label = this.value; });

    byId('btnSetMeetingPoint').addEventListener('click', function(){
      meetingPickMode = true;
      alert('Klik nu op de kaart om het meeting point te zetten.');
    });

    byId('btnMakePrestartStartSlot').addEventListener('click', function(){
      makePrestartStartSlot();
      syncUIFromData();
      renderAll();
    });

    byId('btnSyncPrestartStart').addEventListener('click', function(){
      syncPrestartToStartDataNonDestructive();
      syncUIFromData();
      renderAll();
    });

    // slots
    byId('btnAddSlot').addEventListener('click', function(){
      var id = uniqueId('stop', DATA.slots, 'id');

      var prevId = '';
      for(var p = DATA.slots.length - 1; p >= 0; p--){
        var prev = DATA.slots[p];
        if(prev && prev.id && prev.required){
          prevId = prev.id;
          break;
        }
      }

      var newSlot = { id:id, label:id, required:true };
      if(prevId) newSlot.unlockAfterSlot = prevId;

      DATA.slots.push(newSlot);

      renderSlotsTable();
      renderLocsTable();
      validateAndRender();
      drawRouteArrows();
    });
  }

  // =========================
  // Tables (slots/locs)
  // =========================
  function renderSlotsTable(){
    var tb = byId('slotsTable').querySelector('tbody');
    var html = '';
    var sids = slotIds();
    var slotCounts = getSlotLocationCounts();

    for(var i=0;i<DATA.slots.length;i++){
      var s = DATA.slots[i];
      if(!s) continue;

      html += '<tr>';
      html += '<td><input data-i="'+i+'" data-k="id" class="slotInp" type="text" value="'+esc(s.id||'')+'"></td>';

      var count = slotCounts[s.id] || 0;
      var badge = (count > 1) ? ' <span class="slotBadge">×'+count+'</span>' : '';

      html += '<td>'
        + '<input data-i="'+i+'" data-k="label" class="slotInp" type="text" value="'+esc(s.label||'')+'">'
        + badge
        + '</td>';

      html += '<td style="text-align:center"><input data-i="'+i+'" data-k="required" class="slotChk" type="checkbox" '+(s.required?'checked':'')+'></td>';

      html += '<td><select data-i="'+i+'" data-k="unlockAfterSlot" class="slotSel">';
      html += '<option value=""></option>';

      if(s.unlockAfterSlot && s.id && s.unlockAfterSlot === s.id){
        html += '<option value="'+esc(s.id)+'" selected>⚠ '+esc(s.id)+' (ongeldig: zichzelf)</option>';
      }

      for(var j=0;j<sids.length;j++){
        var sid = sids[j];
        if(s.id && sid === s.id) continue;
        var sel = (s.unlockAfterSlot === sid) ? 'selected' : '';
        html += '<option value="'+esc(sid)+'" '+sel+'>'+esc(sid)+'</option>';
      }
      html += '</select></td>';

      html += '<td><select data-i="'+i+'" data-k="completeMode" class="slotSel">';
      var modes = ['', 'all', 'any', 'nearest', 'random'];
      for(var k=0;k<modes.length;k++){
        var mv = modes[k];
        var sel2 = (s.completeMode===mv) ? 'selected' : '';
        html += '<option value="'+esc(mv)+'" '+sel2+'>'+esc(mv)+'</option>';
      }
      html += '</select></td>';

      html += '<td style="text-align:right"><span class="linklike" data-del-slot="'+i+'">verwijder</span></td>';
      html += '</tr>';
    }

    tb.innerHTML = html;

    // slot inputs
    var inps = tb.querySelectorAll('.slotInp');
    for(var a=0;a<inps.length;a++){
      inps[a].addEventListener('input', function(){
        var i = parseInt(this.getAttribute('data-i'),10);
        var k = this.getAttribute('data-k');
        DATA.slots[i][k] = this.value;
        validateAndRender();
      });

      inps[a].addEventListener('blur', function(){
        renderSlotsTable();
        renderLocsTable();
        renderPrestartUseLocationDropdown();
        validateAndRender();
        drawRouteArrows();
      });
    }

    var chks = tb.querySelectorAll('.slotChk');
    for(var b=0;b<chks.length;b++){
      chks[b].addEventListener('change', function(){
        var i = parseInt(this.getAttribute('data-i'),10);
        DATA.slots[i].required = !!this.checked;
        renderLocMarkers();
        drawRouteArrows();
        validateAndRender();
      });
    }

    var sels = tb.querySelectorAll('.slotSel');
    for(var c2=0;c2<sels.length;c2++){
      sels[c2].addEventListener('change', function(){
        var i = parseInt(this.getAttribute('data-i'),10);
        var k = this.getAttribute('data-k');
        var v = this.value;

        if(v==='') delete DATA.slots[i][k];
        else DATA.slots[i][k] = v;

        drawRouteArrows();
        validateAndRender();
      });
    }

    var dels = tb.querySelectorAll('[data-del-slot]');
    for(var d=0;d<dels.length;d++){
      dels[d].addEventListener('click', function(){
        var idx = parseInt(this.getAttribute('data-del-slot'),10);
        if(!confirm('Slot verwijderen? (locaties die ernaar verwijzen blijven bestaan)')) return;
        DATA.slots.splice(idx,1);
        renderAll();
      });
    }
  }

  function renderLocsTable(){
    var tb = byId('locsTable').querySelector('tbody');
    var html = '';
    var sids = slotIds();

    for(var i=0;i<DATA.locaties.length;i++){
      var l = DATA.locaties[i];
      if(!l) continue;

      var latlng = (l.lat!=null && l.lng!=null) ? (l.lat.toFixed(6)+', '+l.lng.toFixed(6)) : '';

      html += '<tr>';
      html += '<td><input data-i="'+i+'" data-k="id" class="locInp" type="text" value="'+esc(l.id||'')+'"></td>';

      html += '<td><select data-i="'+i+'" data-k="slot" class="locSel">';
      html += '<option value=""></option>';
      for(var j=0;j<sids.length;j++){
        var sid = sids[j];
        var sel = (l.slot===sid) ? 'selected' : '';
        html += '<option value="'+esc(sid)+'" '+sel+'>'+esc(sid)+'</option>';
      }
      html += '</select></td>';

      html += '<td><input data-i="'+i+'" data-k="naam" class="locInp" type="text" value="'+esc(l.naam||'')+'"></td>';
      html += '<td><input data-i="'+i+'" data-k="radius" class="locNum" type="number" step="1" value="'+esc(l.radius||50)+'"></td>';

      html += '<td class="mini"><span class="linklike" data-zoom="'+esc(l.id)+'">'+esc(latlng)+'</span></td>';
      html += '<td style="text-align:right"><span class="linklike" data-edit="'+esc(l.id)+'">edit</span> · <span class="linklike" data-del-loc="'+i+'">verwijder</span></td>';
      html += '</tr>';
    }

    tb.innerHTML = html;

    var inps = tb.querySelectorAll('.locInp');
    for(var a=0;a<inps.length;a++){
      inps[a].addEventListener('input', function(){
        var i = parseInt(this.getAttribute('data-i'),10);
        var k = this.getAttribute('data-k');
        DATA.locaties[i][k] = this.value;
        renderAll(); // id-wijziging beïnvloedt locRender mapping
      });
    }

    var nums = tb.querySelectorAll('.locNum');
    for(var b=0;b<nums.length;b++){
      nums[b].addEventListener('input', function(){
        var i = parseInt(this.getAttribute('data-i'),10);
        var v = parseFloat(this.value||0);
        DATA.locaties[i].radius = v;

        var loc = DATA.locaties[i];
        var rr = locRender[loc.id];
        if(rr && rr.circle) rr.circle.setRadius(v||0);

        validateAndRender();
      });
    }

    var sels = tb.querySelectorAll('.locSel');
    for(var c=0;c<sels.length;c++){
      sels[c].addEventListener('change', function(){
        var i = parseInt(this.getAttribute('data-i'),10);
        DATA.locaties[i].slot = this.value;
        renderPrestartUseLocationDropdown();
        renderLocMarkers();
        drawRouteArrows();
        validateAndRender();
      });
    }

    var edits = tb.querySelectorAll('[data-edit]');
    for(var e=0;e<edits.length;e++){
      edits[e].addEventListener('click', function(){
        openLocEditor(this.getAttribute('data-edit'));
      });
    }

    var zooms = tb.querySelectorAll('[data-zoom]');
    for(var z=0;z<zooms.length;z++){
      zooms[z].addEventListener('click', function(){
        zoomToLoc(this.getAttribute('data-zoom'));
      });
    }

    var dels = tb.querySelectorAll('[data-del-loc]');
    for(var d=0;d<dels.length;d++){
      dels[d].addEventListener('click', function(){
        var idx = parseInt(this.getAttribute('data-del-loc'),10);
        if(!confirm('Locatie verwijderen?')) return;
        DATA.locaties.splice(idx,1);
        renderAll();
      });
    }
  }

  function zoomToLoc(locId){
    var rr = locRender[locId];
    if(rr && rr.marker){
      map.setView(rr.marker.getLatLng(), Math.max(map.getZoom(), 16), { animate:true });
      rr.marker.openPopup();
    }
  }

  function openLocEditor(locId){
    var loc = findLocById(locId);
    if(!loc) return;

    var rh = prompt('routeHint', loc.routeHint || '');
    if(rh != null) loc.routeHint = rh;

    var kort = prompt('uitleg.kort', (loc.uitleg && loc.uitleg.kort) ? loc.uitleg.kort : '');
    if(!loc.uitleg) loc.uitleg = { kort:'', uitgebreid:'' };
    if(kort != null) loc.uitleg.kort = kort;

    var uit = prompt('uitleg.uitgebreid', (loc.uitleg && loc.uitleg.uitgebreid) ? loc.uitleg.uitgebreid : '');
    if(uit != null) loc.uitleg.uitgebreid = uit;

    var qtxt = (loc.vragen && loc.vragen.length) ? loc.vragen.join('\n') : '';
    var nq = prompt('vragen (1 per lijn)', qtxt);
    if(nq != null){
      var lines = nq.split('\n');
      var out=[];
      for(var i=0;i<lines.length;i++){
        var t = lines[i].trim();
        if(t) out.push(t);
      }
      loc.vragen = out;
    }

    renderAll();
  }

  // =========================
  // Prestart dropdown
  // =========================
  function renderPrestartUseLocationDropdown(){
    var sel = byId('preUseLocationId');
    if(!sel) return;

    var cur = DATA.prestart.useLocationId || '';
    var html = '<option value=""></option>';

    for(var i=0;i<DATA.locaties.length;i++){
      var l = DATA.locaties[i];
      if(!l || !l.id) continue;
      var label = l.id + (l.naam ? ' — ' + l.naam : '');
      var s = (cur===l.id) ? 'selected' : '';
      html += '<option value="'+esc(l.id)+'" '+s+'>'+esc(label)+'</option>';
    }
    sel.innerHTML = html;
  }

  // =========================
  // Validation
  // =========================
  function validate(){
    var issues = { errors:[], warns:[], oks:[] };

    var ALLOWED_VIS = { nextOnly:true, all:true, allAfterStart:true };
    var ALLOWED_MULTI = { all:true, any:true, nearest:true, random:true };

    var vis = DATA.settings && DATA.settings.visibilityMode;
    if(vis && !ALLOWED_VIS[vis]) issues.errors.push('settings.visibilityMode onbekend: ' + vis);

    var ml = DATA.settings && DATA.settings.multiLocationSlotMode;
    if(ml && !ALLOWED_MULTI[ml]) issues.errors.push('settings.multiLocationSlotMode onbekend: ' + ml);

    var seenSlots = {};
    var hasStartSlot = false;

    for(var i=0;i<DATA.slots.length;i++){
      var s = DATA.slots[i];
      if(!s || !s.id) continue;

      if(seenSlots[s.id]) issues.errors.push('Dubbele slot id: ' + s.id);
      seenSlots[s.id] = true;

      if(s.id === 'start') hasStartSlot = true;

      if(s.unlockAfterSlot && !seenSlots[s.unlockAfterSlot]){
        // nog niet volledig betrouwbaar tijdens iteratie; we checken later opnieuw
      }
    }

    if(vis === 'allAfterStart' && !hasStartSlot){
      issues.warns.push('visibilityMode=allAfterStart maar slot "start" bestaat niet.');
    }

    var seenLocs = {};
    var locCountBySlot = {};
    var hasStartLocation = false;

    for(var j=0;j<DATA.locaties.length;j++){
      var l = DATA.locaties[j];
      if(!l || !l.id) continue;

      if(seenLocs[l.id]) issues.errors.push('Dubbele locatie id: ' + l.id);
      seenLocs[l.id] = true;

      if(l.lat == null || l.lng == null) issues.errors.push('Locatie zonder lat/lng: ' + l.id);

      if(l.slot){
        if(!seenSlots[l.slot]) issues.errors.push('Locatie ' + l.id + ' verwijst naar onbekend slot: ' + l.slot);
        locCountBySlot[l.slot] = (locCountBySlot[l.slot] || 0) + 1;
      }

      if(l.slot === 'start') hasStartLocation = true;

      if(l.radius != null && l.radius < 10) issues.warns.push('Radius < 10m bij locatie ' + l.id);
      if(l.radius != null && l.radius > 1000) issues.warns.push('Radius > 1000m bij locatie ' + l.id);
    }

    for(var k=0;k<DATA.slots.length;k++){
      var ss = DATA.slots[k];
      if(ss && ss.unlockAfterSlot && !seenSlots[ss.unlockAfterSlot]){
        issues.errors.push('Slot ' + (ss.id || '?') + ' unlockAfterSlot bestaat niet: ' + ss.unlockAfterSlot);
      }
      if(ss && ss.id && ss.unlockAfterSlot && ss.unlockAfterSlot === ss.id){
        issues.errors.push('Slot ' + ss.id + ' unlockAfterSlot verwijst naar zichzelf.');
      }
    }

    for(var sid in seenSlots){
      var slotObj = getSlotById(sid);
      if(slotObj && slotObj.required && !locCountBySlot[sid]){
        issues.warns.push('Required slot zonder locaties: ' + sid);
      }
      if(slotObj && slotObj.completeMode === 'random' && (locCountBySlot[sid]||0) <= 1){
        issues.warns.push('completeMode=random maar slechts 1 locatie in slot ' + sid);
      }
    }

    if(ml && ml !== 'all'){
      var anyMulti = false;
      for(var s2 in locCountBySlot){
        if(locCountBySlot[s2] > 1){ anyMulti = true; break; }
      }
      if(!anyMulti){
        issues.warns.push('multiLocationSlotMode=' + ml + ' maar geen enkel slot heeft meerdere locaties.');
      }
    }

    var ps = DATA.prestart || {};
    var psLocId = ps.useLocationId;

    if(psLocId && !seenLocs[psLocId]){
      issues.warns.push('prestart.useLocationId verwijst naar een niet-bestaande locatie (' + psLocId + ').');
    }

    if(ps && (!ps.useLocationId || !hasStartSlot || !hasStartLocation)){
      issues.warns.push('Deze route gebruikt een prestart zonder bijhorende startslot/startlocatie. Builder werkt beter na sync.');
    }

    if(issues.errors.length === 0){
      issues.oks.push('Geen blokkerende fouten gevonden.');
    }

    return issues;
  }

  function renderValidation(){
    var v = validate();
    var box = byId('validationBox');
    if(!box) return;

    var html = '';

    if(v.errors.length){
      html += '<div class="err"><b>Fouten</b><ul>';
      for(var i=0;i<v.errors.length;i++) html += '<li>'+esc(v.errors[i])+'</li>';
      html += '</ul></div>';
    }

    if(v.warns.length){
      html += '<div class="warn"><b>Waarschuwingen</b><ul>';
      for(var j=0;j<v.warns.length;j++) html += '<li>'+esc(v.warns[j])+'</li>';
      html += '</ul></div>';
    }

    if(v.oks.length){
      html += '<div class="ok"><b>OK</b><ul>';
      for(var k=0;k<v.oks.length;k++) html += '<li>'+esc(v.oks[k])+'</li>';
      html += '</ul></div>';
    }

    box.innerHTML = html || '<span class="mini">Nog niets om te valideren.</span>';
  }

  function validateAndRender(){
    renderValidation();
  }

  // =========================
  // Import / Export
  // =========================
  function exportJson(){
    var out = JSON.parse(JSON.stringify(DATA));

    if(!out.meta || !out.meta.characters){
      if(out.meta && out.meta.characters) delete out.meta.characters;
    }

    for(var i=0;i<out.slots.length;i++){
      var s = out.slots[i];
      if(!s) continue;
      if(!s.unlockAfterSlot) delete s.unlockAfterSlot;
      if(!s.completeMode) delete s.completeMode;
    }

    if(out.prestart && !out.prestart.maps) out.prestart.maps = { label:'' };

    var json = JSON.stringify(out, null, 2);
    var blob = new Blob([json], { type:'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (out.meta && out.meta.title ? out.meta.title : 'route') + '.json';
    document.body.appendChild(a);
    a.click();

    setTimeout(function(){
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 250);
  }

  function importJsonFile(ev){
    var f = ev.target.files && ev.target.files[0];
    if(!f) return;

    var r = new FileReader();
    r.onload = function(){
      try{
        var obj = JSON.parse(r.result);
        if(!obj || typeof obj !== 'object') throw new Error('Geen object');

        if(!obj.meta) obj.meta = { title:'(import)', subtitle:'', version:'1.0' };
        if(!obj.settings) obj.settings = defaultData().settings;
        if(!obj.prestart) obj.prestart = defaultData().prestart;
        if(!obj.slots) obj.slots = [];
        if(!obj.locaties) obj.locaties = [];

        DATA = obj;

        syncPrestartToStartDataNonDestructive();
        syncUIFromData();
        renderAll();

        setTimeout(function(){
          try { map.invalidateSize(true); } catch(e){}
          try { renderLocMarkers(); } catch(e){}
          try { drawRouteArrows(); } catch(e){}
        }, 50);

        fitMapToData();

      }catch(e){
        alert('Import mislukt: ' + (e && e.message ? e.message : e));
      }finally{
        ev.target.value = '';
      }
    };
    r.readAsText(f);
  }

  // =========================
  // Sync UI
  // =========================
  function syncUIFromData(){
    byId('metaTitle').value = DATA.meta.title || '';
    byId('metaSubtitle').value = DATA.meta.subtitle || '';
    byId('metaVersion').value = DATA.meta.version || '1.0';

    var hasChars = !!(DATA.meta && DATA.meta.characters);
    byId('metaCharactersEnabled').checked = hasChars;
    byId('metaCharactersBox').style.display = hasChars ? 'block' : 'none';
    byId('metaCharactersSource').value = hasChars ? (DATA.meta.characters.source || 'personages.json') : 'personages.json';

    byId('setVisibilityMode').value = DATA.settings.visibilityMode || 'nextOnly';
    byId('setMultiLocSlotMode').value = DATA.settings.multiLocationSlotMode || 'all';
    byId('setShowOptionalSlots').checked = !!DATA.settings.showOptionalSlots;
    byId('setListShowFutureSlots').checked = !!DATA.settings.listShowFutureSlots;
    byId('setMapShowFutureLocations').checked = !!DATA.settings.mapShowFutureLocations;

    byId('preMeetingLabel').value = (DATA.prestart.meetingPoint && DATA.prestart.meetingPoint.label) ? DATA.prestart.meetingPoint.label : '';
    byId('preMeetingLat').value = (DATA.prestart.meetingPoint && DATA.prestart.meetingPoint.lat!=null) ? DATA.prestart.meetingPoint.lat : '';
    byId('preMeetingLng').value = (DATA.prestart.meetingPoint && DATA.prestart.meetingPoint.lng!=null) ? DATA.prestart.meetingPoint.lng : '';
    byId('preMessage').value = DATA.prestart.message || '';
    byId('preMapsLabel').value = (DATA.prestart.maps && DATA.prestart.maps.label) ? DATA.prestart.maps.label : '';
  }

  // =========================
  // Render all
  // =========================
  function renderAll(){
    renderMeetingMarker();
    renderSlotsTable();
    renderLocsTable();
    renderLocMarkers();
    drawRouteArrows();
    renderPrestartUseLocationDropdown();

    if(DATA.prestart && DATA.prestart.useLocationId){
      var sel = byId('preUseLocationId');
      if(sel) sel.value = DATA.prestart.useLocationId;
    }

    validateAndRender();
  }

  function fitMapToData(){
    var pts = [];

    if(DATA.prestart && DATA.prestart.meetingPoint){
      var mp = DATA.prestart.meetingPoint;
      if(mp.lat != null && mp.lng != null) pts.push([mp.lat, mp.lng]);
    }

    for(var i=0;i<DATA.locaties.length;i++){
      var l = DATA.locaties[i];
      if(l && l.lat != null && l.lng != null) pts.push([l.lat, l.lng]);
    }

    if(!pts.length) return;

    try{
      var bounds = L.latLngBounds(pts);
      map.fitBounds(bounds, { padding:[30,30], animate:true });
    }catch(e){}
  }

  // =========================
  // Init
  // =========================
  document.addEventListener('DOMContentLoaded', function(){
    initMap();
    bindUI();

    // Zorg dat startstructuur klopt
    makePrestartStartSlot();
    syncUIFromData();
    renderAll();
  });

})();
