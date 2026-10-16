// Test page for vowel recognition: live formants, vowel chart, per-person calibration.
(function(){
  "use strict";
  var VA = window.VowelAnalysis;
  var VOWELS = VA.VOWELS;

  var PROFILES_KEY = "vokaltest_profiles";
  var SELECTED_KEY = "vokaltest_selected";
  var CALIB_SECONDS = 2;
  var NOISE_SECONDS = 1;
  var HISTORY_MS = 200;        // smoothing window; older frames are dropped
  var SURE_CONFIDENCE = 0.25;  // nearest vowel must be clearly closer than the runner-up

  var el = {};
  ["micBtn","micError","bigLetter","bigStatus","bigFormants","meterFill","meterThr","chart",
   "profileSelect","deleteProfileBtn","profileName","calibGrid","saveProfileBtn","resetStatsBtn","stats"
  ].forEach(function(id){ el[id] = document.getElementById(id); });
  var ctx = el.chart.getContext("2d");

  // ---------- state ----------
  var audioCtx = null, analyser = null, timeData = null;
  var threshold = 0.004, gaugeMax = 0.02;
  var phase = "off";           // off | noise | live
  var noiseSamples = [], phaseStart = 0;
  var hist = [], trail = [];   // hist: { t, envelope, f1, f2 } of recent voiced frames
  var current = null;          // { cls, f1, f2 } (f1/f2 may be null)
  var lastFrame = 0;
  var stats = {}; VOWELS.forEach(function(v){ stats[v] = 0; });
  var recording = null;        // { vowel, start, envs, f1s, f2s }
  var draft = {};              // per vowel { env, f1, f2 } being recorded for the profile name field
  var profiles = loadProfiles();
  var selected = "preset:child";
  try { selected = localStorage.getItem(SELECTED_KEY) || selected; } catch(e){}

  // ---------- profiles ----------
  function loadProfiles(){
    var raw = {};
    try { raw = JSON.parse(localStorage.getItem(PROFILES_KEY)) || {}; } catch(e){}
    var valid = {};
    Object.keys(raw).forEach(function(name){
      var ok = VOWELS.every(function(v){ return raw[name][v] && Array.isArray(raw[name][v].env); });
      if(ok){ valid[name] = raw[name]; }
    });
    return valid;
  }
  function storeProfiles(){
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch(e){}
  }
  function selectedProfile(){
    return selected.indexOf("profile:") === 0 ? profiles[selected.slice(8)] || null : null;
  }
  function presetKind(){ return selected === "preset:adult" ? "adult" : "child"; }
  // Freshly recorded vowels take effect immediately, before the profile is saved.
  function entryFor(v){
    var prof = selectedProfile();
    return draft[v] || (prof && prof[v]) || null;
  }
  function activeTemplates(){
    var out = {};
    VOWELS.forEach(function(v){
      var e = entryFor(v);
      out[v] = e ? e.env : VA.presetEnvelope(presetKind(), v);
    });
    return out;
  }
  // Where each vowel sits on the chart (measured F1/F2 if known, otherwise the preset).
  function chartPositions(){
    var out = {};
    VOWELS.forEach(function(v){
      var e = entryFor(v);
      out[v] = e && e.f1 && e.f2 ? { f1: e.f1, f2: e.f2 } : VA.PRESETS[presetKind()][v];
    });
    return out;
  }
  function buildProfileSelect(){
    el.profileSelect.innerHTML = "";
    var opts = [["preset:child","Kind (Standardwerte)"],["preset:adult","Erwachsene (Standardwerte)"]];
    Object.keys(profiles).sort().forEach(function(name){ opts.push(["profile:"+name, "Profil: "+name]); });
    if(!opts.some(function(o){ return o[0] === selected; })){ selected = "preset:child"; }
    opts.forEach(function(o){
      var opt = document.createElement("option");
      opt.value = o[0]; opt.textContent = o[1];
      el.profileSelect.appendChild(opt);
    });
    el.profileSelect.value = selected;
    el.deleteProfileBtn.hidden = selected.indexOf("profile:") !== 0;
  }
  el.profileSelect.addEventListener("change", function(){
    selected = el.profileSelect.value;
    try { localStorage.setItem(SELECTED_KEY, selected); } catch(e){}
    if(selected.indexOf("profile:") === 0){
      var name = selected.slice(8);
      el.profileName.value = name;
      draft = JSON.parse(JSON.stringify(profiles[name]));
    } else {
      el.profileName.value = "";
      draft = {};
    }
    hist = [];
    buildProfileSelect();
    buildCalibGrid();
  });
  el.deleteProfileBtn.addEventListener("click", function(){
    if(selected.indexOf("profile:") !== 0) return;
    var name = selected.slice(8);
    if(!window.confirm("Profil \"" + name + "\" löschen?")) return;
    delete profiles[name];
    storeProfiles();
    selected = "preset:child"; draft = {}; el.profileName.value = "";
    buildProfileSelect(); buildCalibGrid();
  });
  el.saveProfileBtn.addEventListener("click", function(){
    var name = el.profileName.value.trim();
    var missing = VOWELS.filter(function(v){ return !draft[v]; });
    if(!name){ window.alert("Bitte zuerst einen Namen eingeben."); el.profileName.focus(); return; }
    if(missing.length){ window.alert("Es fehlen noch: " + missing.join(", ").toUpperCase()); return; }
    profiles[name] = JSON.parse(JSON.stringify(draft));
    storeProfiles();
    selected = "profile:" + name;
    try { localStorage.setItem(SELECTED_KEY, selected); } catch(e){}
    buildProfileSelect(); buildCalibGrid();
  });

  // ---------- calibration buttons ----------
  function buildCalibGrid(){
    el.calibGrid.innerHTML = "";
    VOWELS.forEach(function(v){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "calib-btn" + (draft[v] ? " is-done" : "") + (recording && recording.vowel === v ? " is-recording" : "");
      b.disabled = phase !== "live" || (recording && recording.vowel !== v);
      var label = recording && recording.vowel === v ? "halten …"
        : !draft[v] ? "antippen"
        : draft[v].f1 && draft[v].f2 ? Math.round(draft[v].f1) + "/" + Math.round(draft[v].f2) : "gespeichert";
      b.innerHTML = "<b>" + v + "</b><small>" + label + "</small>";
      b.addEventListener("click", function(){ startRecording(v); });
      el.calibGrid.appendChild(b);
    });
  }
  function startRecording(v){
    if(phase !== "live" || recording) return;
    recording = { vowel: v, start: performance.now(), envs: [], f1s: [], f2s: [] };
    buildCalibGrid();
  }
  function finishRecording(){
    var r = recording;
    recording = null;
    if(r.envs.length < 8){
      window.alert("Für " + r.vowel.toUpperCase() + " war zu wenig Stimme zu hören. Bitte nochmal antippen und den Vokal laut und gleichmässig halten.");
    } else {
      var env = VA.medianEnvelope(r.envs).map(function(x){ return Math.round(x * 10) / 10; });
      var hasF = r.f1s.length >= 5;
      draft[r.vowel] = { env: env, f1: hasF ? Math.round(VA.median(r.f1s)) : null, f2: hasF ? Math.round(VA.median(r.f2s)) : null };
    }
    buildCalibGrid();
  }

  // ---------- stats ----------
  function buildStats(){
    el.stats.innerHTML = VOWELS.map(function(v){
      return "<div><b>" + v + "</b><span>" + stats[v].toFixed(1) + " s</span></div>";
    }).join("");
  }
  el.resetStatsBtn.addEventListener("click", function(){
    VOWELS.forEach(function(v){ stats[v] = 0; });
    buildStats();
  });

  // ---------- microphone ----------
  function rms(){
    analyser.getFloatTimeDomainData(timeData);
    var s = 0;
    for(var i = 0; i < timeData.length; i++){ s += timeData[i] * timeData[i]; }
    return Math.sqrt(s / timeData.length);
  }
  function showError(msg){ el.micError.textContent = msg; el.micError.hidden = false; }

  el.micBtn.addEventListener("click", function(){
    el.micError.hidden = true;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      showError("Dieser Browser unterstützt keinen Mikrofonzugriff.");
      return;
    }
    if(!audioCtx){
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e){ showError("Audio konnte nicht gestartet werden."); return; }
    }
    audioCtx.resume().catch(function(){});
    el.micBtn.disabled = true;
    // Same settings as the game, so the test shows what the game will hear.
    navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false } })
      .then(function(stream){
        var src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        timeData = new Float32Array(analyser.fftSize);
        el.micBtn.hidden = true;
        startNoise();
        lastFrame = performance.now();
        requestAnimationFrame(frame);
      })
      .catch(function(){
        el.micBtn.disabled = false;
        showError("Kein Mikrofonzugriff erhalten. Bitte in den Browser-Einstellungen erlauben und erneut versuchen.");
      });
  });
  function startNoise(){
    phase = "noise"; noiseSamples = []; phaseStart = performance.now();
    el.bigStatus.textContent = "Kurz still sein …";
    buildCalibGrid();
  }

  // ---------- main loop ----------
  function frame(now){
    var dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    var level = rms();

    if(phase === "noise"){
      noiseSamples.push(level);
      if((now - phaseStart) / 1000 >= NOISE_SECONDS){
        // Same rule as the game: relative to the room noise (90th percentile).
        var sorted = noiseSamples.slice().sort(function(a, b){ return a - b; });
        threshold = Math.max(0.004, sorted[Math.floor((sorted.length - 1) * 0.9)] * 2.5);
        gaugeMax = threshold * 4;
        phase = "live";
        buildCalibGrid();
      }
    } else if(phase === "live"){
      var voiced = level > threshold;
      if(voiced){
        var r = VA.analyzeFrame(timeData, audioCtx.sampleRate);
        if(r){
          hist.push({ t: now, envelope: r.envelope, f1: r.f1, f2: r.f2 });
          if(recording){
            recording.envs.push(r.envelope);
            if(r.f1){ recording.f1s.push(r.f1); recording.f2s.push(r.f2); }
          }
        }
      } else {
        hist = [];
      }
      // drop old frames so the display never freezes on a stale value
      while(hist.length && now - hist[0].t > HISTORY_MS){ hist.shift(); }
      if(hist.length >= 3){
        var env = VA.medianEnvelope(hist.map(function(h){ return h.envelope; }));
        var withF = hist.filter(function(h){ return h.f1; });
        var f1 = withF.length >= 2 ? VA.median(withF.map(function(h){ return h.f1; })) : null;
        var f2 = withF.length >= 2 ? VA.median(withF.map(function(h){ return h.f2; })) : null;
        current = { cls: VA.classify(env, activeTemplates()), f1: f1, f2: f2 };
        if(f1){ trail.push({ f1: f1, f2: f2 }); if(trail.length > 40){ trail.shift(); } }
      } else {
        current = null;
        if(trail.length){ trail.shift(); }
      }
      if(current && current.cls && current.cls.confidence >= SURE_CONFIDENCE && !recording){
        stats[current.cls.vowel] += dt;
      }
      if(recording && (now - recording.start) / 1000 >= CALIB_SECONDS){ finishRecording(); }
      updateBig();
    }

    el.meterFill.style.width = Math.min(100, level / gaugeMax * 100) + "%";
    el.meterFill.classList.toggle("is-active", phase === "live" && level > threshold);
    el.meterThr.style.left = Math.min(100, threshold / gaugeMax * 100) + "%";
    if(Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)){ buildStats(); }
    drawChart();
    requestAnimationFrame(frame);
  }

  function updateBig(){
    var L = el.bigLetter;
    L.classList.remove("is-sure", "is-unsure");
    if(recording){
      L.textContent = recording.vowel;
      el.bigStatus.textContent = recording.vowel.toUpperCase() + " halten …";
    } else if(!current || !current.cls){
      L.textContent = "–";
      el.bigStatus.textContent = "Still – sprich einen Vokal";
    } else if(current.cls.confidence >= SURE_CONFIDENCE){
      L.textContent = current.cls.vowel;
      L.classList.add("is-sure");
      el.bigStatus.textContent = "Erkannt: " + current.cls.vowel.toUpperCase();
    } else {
      L.textContent = current.cls.vowel;
      L.classList.add("is-unsure");
      el.bigStatus.textContent = "Unsicher: " + current.cls.vowel.toUpperCase() + " oder " + (current.cls.runnerUp || "").toUpperCase();
    }
    el.bigFormants.textContent = current && current.f1
      ? "F1 " + Math.round(current.f1) + " Hz · F2 " + Math.round(current.f2) + " Hz"
      : "F1 – · F2 –";
  }

  // ---------- vowel chart ----------
  // Classic phonetics layout: F2 from high (left) to low (right), F1 from low (top) to high (bottom).
  var F2_MIN = 500, F2_MAX = 4000, F1_MIN = 200, F1_MAX = 1400;
  function sizeChart(){
    var rect = el.chart.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    el.chart.width = Math.max(1, Math.round(rect.width * dpr));
    el.chart.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", sizeChart);
  function xOf(f2, w){ return w * (Math.log(F2_MAX) - Math.log(f2)) / (Math.log(F2_MAX) - Math.log(F2_MIN)); }
  function yOf(f1, h){ return h * (Math.log(f1) - Math.log(F1_MIN)) / (Math.log(F1_MAX) - Math.log(F1_MIN)); }

  function drawChart(){
    var w = el.chart.clientWidth, h = el.chart.clientHeight;
    if(!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    [600, 1000, 1500, 2000, 3000].forEach(function(f){
      var x = xOf(f, w);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(f + "", x + 3, h - 6);
    });
    [300, 500, 800, 1100].forEach(function(f){
      var y = yOf(f, h);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(f + "", 4, y - 3);
    });
    ctx.fillText("F2 (Hz) →", w - 74, 14);
    ctx.fillText("↓ F1 (Hz)", 4, 14);

    var protos = chartPositions();
    var hit = current && current.cls ? current.cls.vowel : null;
    VOWELS.forEach(function(v){
      var p = protos[v], x = xOf(p.f2, w), y = yOf(p.f1, h);
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = v === hit ? "rgba(200,255,61,.25)" : "rgba(255,255,255,.07)"; ctx.fill();
      ctx.strokeStyle = v === hit ? "#c8ff3d" : "rgba(255,255,255,.3)"; ctx.stroke();
      ctx.fillStyle = "#f5f3ec";
      ctx.font = "700 20px Rajdhani, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(v.toUpperCase(), x, y + 1);
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      ctx.font = "11px 'IBM Plex Mono', monospace";
    });

    trail.forEach(function(t, i){
      ctx.beginPath();
      ctx.arc(xOf(t.f2, w), yOf(t.f1, h), 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(200,255,61," + (0.08 + 0.4 * i / trail.length) + ")";
      ctx.fill();
    });
    if(current && current.f1){
      ctx.beginPath();
      ctx.arc(xOf(current.f2, w), yOf(current.f1, h), 7, 0, Math.PI * 2);
      ctx.fillStyle = "#c8ff3d"; ctx.fill();
    }
  }

  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible" && audioCtx && audioCtx.state !== "running"){ audioCtx.resume().catch(function(){}); }
  });

  // ---------- boot ----------
  buildProfileSelect();
  if(selected.indexOf("profile:") === 0){
    el.profileName.value = selected.slice(8);
    draft = JSON.parse(JSON.stringify(profiles[selected.slice(8)]));
  }
  buildCalibGrid();
  buildStats();
  sizeChart();
  drawChart();

  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
})();
