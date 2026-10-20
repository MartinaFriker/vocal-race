(function(){
  "use strict";

  // ---------- data ----------
  var TRACKS = {
    monaco: { key:"monaco", name:"Monte Carlo", sub:"Kurz & kurvenreich – guter Einstieg", distance:220, accentVar:"--monaco",
      sky:["#bfe3f2","#eef1ec"], scenery:"coast" },
    nurburgring: { key:"nurburgring", name:"Nürburgring", sub:"Lang & fordernd – Ausdauer gefragt", distance:620, accentVar:"--nurburgring",
      sky:["#cdeada","#eef1ec"], scenery:"forest" },
    monza: { key:"monza", name:"Monza", sub:"Schnell & hart – volles Tempo nötig", distance:380, accentVar:"--monza",
      sky:["#f6d3d3","#eef1ec"], scenery:"grandstand" }
  };
  var DIFFICULTIES = [
    { key:"easy", label:"Einfach", aiSpeed:15 },
    { key:"medium", label:"Mittel", aiSpeed:23 },
    { key:"hard", label:"Schwer", aiSpeed:31 },
    { key:"expert", label:"Experte", aiSpeed:42 }
  ];
  // Farblich/silhouettenhaft an bekannte Marken angelehnt (keine Logos, keine 1:1-Nachbildung),
  // damit die Autos im Spiel klar unterscheidbar sind.
  var CARS = {
    audi:    { key:"audi",    name:"Audi",        ui:"#565b62" },
    lambo:   { key:"lambo",   name:"Lamborghini", ui:"#1e3f8f" },
    bugatti: { key:"bugatti", name:"Bugatti",     ui:"#4fb3e0" },
    ferrari: { key:"ferrari", name:"Ferrari",     ui:"#d21f3c" }
  };
  // Freigestellte Fotos je Auto (vom Nutzer geliefert), ersetzen die gezeichneten Autos.
  var CAR_IMAGES = {
    audi: "assets/cars/audi.png",
    lambo: "assets/cars/lambo.png",
    bugatti: "assets/cars/bugatti.png",
    ferrari: "assets/cars/ferrari.png"
  };
  var carImageEls = {};
  Object.keys(CAR_IMAGES).forEach(function(key){
    var im = new Image();
    im.src = CAR_IMAGES[key];
    carImageEls[key] = im;
  });
  // Optionales, statisches Foto-Hintergrundbild je Strecke (ersetzt die gezeichnete
  // Kulisse, wenn vorhanden). Kein Scrollen - reine Dekoration, Rennstrecke bleibt gezeichnet.
  var TRACK_IMAGES = {
    monaco: "assets/tracks/monaco.jpg",
    nurburgring: "assets/tracks/nurburgring.jpg",
    monza: "assets/tracks/monza.jpg"
  };
  var trackImageEls = {};
  Object.keys(TRACK_IMAGES).forEach(function(key){
    var im = new Image();
    im.src = TRACK_IMAGES[key];
    trackImageEls[key] = im;
  });

  var BASE_SPEED = 13;
  var MAX_SPEED = 54;
  var RAMP_TIME = 5.5;     // Sekunden bis Höchsttempo bei durchgehendem Ton
  var GRACE = 0.35;        // erlaubte kurze Unterbrechung (Atemholen) in Sek.
  var CALIB_DURATION = 1.2;
  var PPU = 6;             // Pixel Scroll je "Distanz-Einheit"

  // ---------- state ----------
  var selectedTrack = "monaco";
  // The chosen car is shared with Vokal-Kart (its kart takes the car's colour).
  var CAR_KEY = "vokalrennen_car";
  var selectedCar = "ferrari";
  try { var savedCar = localStorage.getItem(CAR_KEY); if(savedCar){ selectedCar = savedCar; } } catch(e){}
  var selectedDifficulty = "easy";
  var sensitivity = 1;
  var reducedMotion = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch(e){}

  var audioCtx = null, micStream = null, analyser = null, timeData = null;
  var noiseFloor = 0.02, baseThreshold = 0.04, gaugeMax = 0.2;
  var smoothLevel = 0;

  var player, ai, trackDistance, aiSpeed, scrollOffset, streak, silenceTimer, elapsedRaceTime;
  var raceFinished = false, paused = false, lastFrame = 0;
  var particles = [];
  var calibSamples = [], calibStart = 0, calibCancelled = false;
  var countdownTimer = null;
  var cheerLastUpdate = 0;

  // ---------- elements ----------
  var el = {};
  ["trackGrid","carGrid","diffSeg","bestTimeLine","startBtn","setupError",
   "screen-home","screen-setup","screen-calibrate","screen-race","screen-result","gameRace","gameKart","gameTest","backHomeBtn",
   "calibRing","calibPct","calibLabel","calibCancel",
   "raceCanvas","countdownOverlay","countdownNum","cheer",
   "speedVal","streakVal","distVal","meterState","meterFill","meterThreshold",
   "pauseBtn","aiMarker","playerMarker",
   "resultHeadline","resultBadge","resultTime","resultBest","resultTip","retryBtn","changeTrackBtn",
   "settingsBtn","settingsBackdrop","sensSlider","levelReadout","recalibBtn","closeSettingsBtn",
   "introOverlay","introVideo","introSkip"
  ].forEach(function(id){ el[id] = document.getElementById(id); });

  var ctx = el.raceCanvas.getContext("2d");

  // Intro-Video (vom Nutzer geliefert), einmalig stumm abgespielt.
  var INTRO_VIDEO = "assets/intro.mp4";

  // ---------- intro video ----------
  // Plays once automatically (muted, with a skip button) and then shows the
  // start screen. Mehrere Sicherheitsnetze, falls "ended" nie feuert
  // (Autoplay blockiert, Decode-Fehler, o.ä.), damit die App nie hinter dem
  // Intro hängen bleibt.
  // Played once per visit: coming back from Vokal-Kart goes straight to the game choice.
  var INTRO_SEEN_KEY = "vokalrennen_intro_seen";
  (function initIntro(){
    var overlay = el.introOverlay, video = el.introVideo;
    var seen = false;
    try { seen = sessionStorage.getItem(INTRO_SEEN_KEY) === "1"; } catch(e){}
    if(!overlay || !video || typeof INTRO_VIDEO === "undefined" || seen){ if(overlay) overlay.hidden = true; return; }
    video.muted = true;
    var done = false, objectUrl = null;
    function finishIntro(){
      if(done) return;
      done = true;
      overlay.hidden = true;
      try { sessionStorage.setItem(INTRO_SEEN_KEY, "1"); } catch(e){}
      try{ video.pause(); video.removeAttribute("src"); video.load(); }catch(e){}
      if(objectUrl){ URL.revokeObjectURL(objectUrl); }
    }
    video.addEventListener("ended", finishIntro);
    video.addEventListener("error", finishIntro);
    if(el.introSkip){ el.introSkip.addEventListener("click", finishIntro); }
    // Großzügig, weil das Video beim allerersten Start erst geladen werden muss.
    var fallback = setTimeout(finishIntro, 15000);
    video.addEventListener("ended", function(){ clearTimeout(fallback); });
    function attemptPlay(){
      var p = video.play();
      if(p && p.catch){
        p.catch(function(){
          // Ton-Autoplay von Browser blockiert -> stumm versuchen, damit das Intro nie hängen bleibt.
          if(!video.muted){ video.muted = true; video.play().catch(finishIntro); }
          else { finishIntro(); }
        });
      }
    }
    // Als Blob laden: Safari spielt Videos aus dem Offline-Cache sonst oft nicht ab.
    fetch(INTRO_VIDEO)
      .then(function(res){ if(!res.ok) throw new Error(res.status); return res.blob(); })
      .then(function(blob){
        if(done) return;
        objectUrl = URL.createObjectURL(blob);
        video.src = objectUrl;
        attemptPlay();
      })
      .catch(function(){
        if(done) return;
        video.src = INTRO_VIDEO;
        attemptPlay();
      });
  })();

  // ---------- helpers ----------
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function formatTime(s){
    var m = Math.floor(s/60), sec = s - m*60;
    return m>0 ? (m+":"+(sec<10?"0":"")+sec.toFixed(1)) : sec.toFixed(1)+"s";
  }
  function showScreen(id){
    ["screen-home","screen-setup","screen-calibrate","screen-race","screen-result"].forEach(function(s){
      el[s].hidden = (s!==id);
    });
    // One history entry for everything past the home screen, so the Android back
    // button returns to the game choice instead of closing the app.
    var inGame = history.state && history.state.vokalrennen;
    if(id!=="screen-home" && !inGame){ history.pushState({ vokalrennen:true }, ""); }
    else if(id==="screen-home" && inGame){ history.back(); }
  }

  // ---------- mobile: Bildschirm anlassen ----------
  // Beim Tönen berührt niemand den Bildschirm - ohne Wake Lock geht er mitten im Rennen aus.
  var wakeLock = null, wantWakeLock = false;
  function requestWakeLock(){
    wantWakeLock = true;
    if(wakeLock || !("wakeLock" in navigator) || document.visibilityState!=="visible") return;
    navigator.wakeLock.request("screen").then(function(lock){
      wakeLock = lock;
      lock.addEventListener("release", function(){ wakeLock = null; });
      if(!wantWakeLock){ lock.release().catch(function(){}); }
    }).catch(function(){});
  }
  function releaseWakeLock(){
    wantWakeLock = false;
    if(wakeLock){ wakeLock.release().catch(function(){}); wakeLock = null; }
  }

  // Laufendes Kalibrieren/Countdown/Rennen abbrechen (Zurück-Taste, Mikrofon weg).
  function abortGame(){
    calibCancelled = true;
    if(countdownTimer){ clearInterval(countdownTimer); countdownTimer = null; }
    el.countdownOverlay.hidden = true;
    raceFinished = true;
    stopRaceLoop();
    releaseWakeLock();
  }
  function bestKey(track,diff){ return "vokalrennen_best_"+track+"_"+diff; }
  function readBest(track,diff){
    try { var v = localStorage.getItem(bestKey(track,diff)); return v?parseFloat(v):null; } catch(e){ return null; }
  }
  function writeBestIfBetter(track,diff,timeSec){
    try {
      var prev = readBest(track,diff);
      if(prev===null || timeSec<prev){ localStorage.setItem(bestKey(track,diff), String(timeSec)); return true; }
    } catch(e){}
    return false;
  }

  // ---------- setup screen ----------
  function buildTrackGrid(){
    el.trackGrid.innerHTML = "";
    Object.keys(TRACKS).forEach(function(key){
      var t = TRACKS[key];
      var card = document.createElement("button");
      card.type = "button";
      card.className = "track-card";
      if(TRACK_IMAGES[key]){
        card.style.backgroundImage =
          'linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.66)), url("'+TRACK_IMAGES[key]+'")';
        // Nürburgring-Foto hat links ein Ortsschild ("Nürburgring") einfotografiert,
        // das sich mit unserem eigenen Titel überschneiden würde -> Ausschnitt nach rechts schieben.
        card.style.backgroundPosition = (key==="nurburgring") ? "85% center, 85% center" : "center, center";
      }
      card.dataset.selected = (key===selectedTrack) ? "true" : "false";
      card.setAttribute("role","radio");
      card.setAttribute("aria-checked", key===selectedTrack ? "true":"false");
      card.innerHTML =
        '<span class="track-name">'+t.name+'</span>'+
        '<span class="track-sub">'+t.sub+'</span>'+
        '<span class="track-meta">'+t.distance+' m Strecke</span>';
      card.addEventListener("click", function(){
        selectedTrack = key;
        buildTrackGrid();
        updateBestLine();
      });
      el.trackGrid.appendChild(card);
    });
  }

  function buildCarGrid(){
    el.carGrid.innerHTML = "";
    Object.keys(CARS).forEach(function(key){
      var c = CARS[key];
      var card = document.createElement("button");
      card.type = "button";
      card.className = "car-card";
      card.dataset.selected = (key===selectedCar) ? "true" : "false";
      card.setAttribute("role","radio");
      card.setAttribute("aria-checked", key===selectedCar ? "true":"false");

      var img = document.createElement("img");
      img.className = "car-swatch";
      img.src = CAR_IMAGES[key];
      img.alt = c.name;
      var name = document.createElement("span");
      name.className = "car-name";
      name.textContent = c.name;
      card.appendChild(img);
      card.appendChild(name);

      card.addEventListener("click", function(){
        selectedCar = key;
        try { localStorage.setItem(CAR_KEY, key); } catch(e){}
        buildCarGrid();
      });
      el.carGrid.appendChild(card);
    });
  }

  function buildDiffSeg(){
    el.diffSeg.innerHTML = "";
    DIFFICULTIES.forEach(function(d){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = d.label;
      btn.className = (d.key===selectedDifficulty) ? "is-active" : "";
      btn.addEventListener("click", function(){
        selectedDifficulty = d.key;
        buildDiffSeg();
        updateBestLine();
      });
      el.diffSeg.appendChild(btn);
    });
  }

  function updateBestLine(){
    var best = readBest(selectedTrack, selectedDifficulty);
    el.bestTimeLine.innerHTML = best
      ? "Bestzeit auf dieser Strecke: <strong>"+formatTime(best)+"</strong>"
      : "Noch keine Bestzeit auf dieser Strecke.";
  }

  function showError(msg){
    el.setupError.textContent = msg;
    el.setupError.hidden = false;
  }
  function clearError(){ el.setupError.hidden = true; }

  // ---------- mic / audio ----------
  // Höhere Empfindlichkeit = niedrigere Schwelle. Pro Gerät gespeichert,
  // weil Handy und Laptop sehr unterschiedlich laute Mikrofone haben.
  var SENS_KEY = "vokalrennen_sensitivity";
  function currentThreshold(){ return baseThreshold / sensitivity; }
  try {
    var savedSens = parseFloat(localStorage.getItem(SENS_KEY));
    if(savedSens >= 0.5 && savedSens <= 4){ sensitivity = savedSens; }
  } catch(e){}
  el.sensSlider.value = String(sensitivity);

  function currentRMS(){
    analyser.getFloatTimeDomainData(timeData);
    var sum = 0;
    for(var i=0;i<timeData.length;i++){ var v=timeData[i]; sum += v*v; }
    return Math.sqrt(sum/timeData.length);
  }

  function startFlow(){
    clearError();
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      showError("Dieser Browser unterstützt keinen Mikrofonzugriff. Bitte in Safari auf dem iPad öffnen.");
      return;
    }
    el.startBtn.disabled = true;
    el.startBtn.textContent = "Mikrofon wird angefragt …";

    if(!audioCtx){
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e){ showError("Audio konnte nicht gestartet werden."); resetStartBtn(); return; }
    }
    audioCtx.resume().catch(function(){});

    var proceed = function(){
      el.startBtn.disabled = false;
      resetStartBtn();
      beginCalibration();
    };

    if(micStream){ proceed(); return; }

    navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false } })
      .then(function(stream){
        micStream = stream;
        var src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        timeData = new Float32Array(analyser.fftSize);
        proceed();
      })
      .catch(function(){
        resetStartBtn();
        showError("Kein Mikrofonzugriff erhalten. Bitte in den Browser-Einstellungen erlauben und erneut versuchen.");
      });
  }
  function resetStartBtn(){
    el.startBtn.disabled = false;
    el.startBtn.textContent = "Mikrofon aktivieren & starten";
  }

  // ---------- calibration ----------
  function beginCalibration(){
    calibSamples = [];
    calibCancelled = false;
    calibStart = performance.now();
    el.calibLabel.textContent = "Kurz still sein …";
    stopRaceLoop();
    requestWakeLock();
    showScreen("screen-calibrate");
    requestAnimationFrame(calibStep);
  }
  function calibStep(now){
    if(calibCancelled) return;
    var elapsed = (now-calibStart)/1000;
    calibSamples.push(currentRMS());
    var pct = clamp(elapsed/CALIB_DURATION,0,1);
    el.calibRing.style.setProperty("--p",(pct*100)+"%");
    el.calibPct.textContent = Math.round(pct*100)+"%";
    if(elapsed < CALIB_DURATION){ requestAnimationFrame(calibStep); }
    else { finishCalibration(); }
  }
  function finishCalibration(){
    // Schwelle nur relativ zum gemessenen Umgebungsgeräusch: Handy-Mikrofone liefern
    // viel leisere Pegel als Laptops, ein fester Mindestwert war dort kaum erreichbar.
    // 90. Perzentil statt Mittelwert, damit kurze Geräusche im Raum mitzählen.
    var sorted = calibSamples.slice().sort(function(a,b){ return a-b; });
    var noise = sorted.length ? sorted[Math.floor((sorted.length-1)*0.9)] : 0;
    noiseFloor = noise;
    baseThreshold = clamp(noise*2.5, 0.004, 0.4);
    gaugeMax = baseThreshold*4;
    beginCountdownAndRace();
  }

  // ---------- race setup ----------
  function resizeCanvas(){
    var rect = el.raceCanvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    el.raceCanvas.width = Math.max(1,Math.round(rect.width*dpr));
    el.raceCanvas.height = Math.max(1,Math.round(rect.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener("resize", function(){ if(!el["screen-race"].hidden){ resizeCanvas(); } });

  function beginCountdownAndRace(){
    var t = TRACKS[selectedTrack];
    var diff = DIFFICULTIES.filter(function(d){return d.key===selectedDifficulty;})[0];
    trackDistance = t.distance;
    aiSpeed = diff.aiSpeed;
    player = { distance:0, speed:0 };
    ai = { distance:0 };
    scrollOffset = 0;
    streak = 0;
    silenceTimer = 0;
    smoothLevel = 0;
    elapsedRaceTime = 0;
    raceFinished = false;
    paused = false;
    particles = [];
    cheerLastUpdate = 0;
    stopRaceLoop();
    requestWakeLock();

    el.aiMarker.style.left = "0%";
    el.playerMarker.style.left = "0%";
    el.pauseBtn.textContent = "Pause";
    el.cheer.textContent = "Bereit? Ton halten zum Losfahren!";

    showScreen("screen-race");
    resizeCanvas();
    drawRace();

    el.countdownOverlay.hidden = false;
    var n = 3;
    el.countdownNum.textContent = String(n);
    countdownTimer = setInterval(function(){
      n--;
      if(n>0){ el.countdownNum.textContent = String(n); }
      else if(n===0){ el.countdownNum.textContent = "LOS!"; }
      else {
        clearInterval(countdownTimer);
        countdownTimer = null;
        el.countdownOverlay.hidden = true;
        startRaceLoop();
      }
    }, 700);
  }

  // ---------- race loop ----------
  // Immer nur eine Schleife gleichzeitig (Pause/Weiter hat früher jedes Mal eine neue gestartet).
  var rafId = 0;
  function startRaceLoop(){
    stopRaceLoop();
    lastFrame = performance.now();
    rafId = requestAnimationFrame(raceFrame);
  }
  function stopRaceLoop(){
    if(rafId){ cancelAnimationFrame(rafId); rafId = 0; }
  }
  function raceFrame(now){
    rafId = 0;
    if(raceFinished) return;
    var dt = (now-lastFrame)/1000;
    lastFrame = now;
    dt = Math.min(dt, 0.05);
    if(!paused){ updateRace(dt); }
    drawRace();
    updateHud();
    if(!raceFinished){ rafId = requestAnimationFrame(raceFrame); }
  }

  function updateRace(dt){
    var raw = currentRMS();
    smoothLevel = lerp(smoothLevel, raw, clamp(dt*6,0,1));
    var thr = currentThreshold();
    var voicing = smoothLevel > thr;

    if(voicing){ silenceTimer = 0; streak += dt; }
    else {
      silenceTimer += dt;
      if(silenceTimer > GRACE){ streak = 0; }
    }

    var target = voicing ? (BASE_SPEED + (MAX_SPEED-BASE_SPEED)*clamp(streak/RAMP_TIME,0,1)) : 0;
    var rate = (target > player.speed) ? 3 : 2;
    player.speed = lerp(player.speed, target, clamp(dt*rate,0,1));

    player.distance += Math.max(0,player.speed)*dt;
    ai.distance += aiSpeed*dt;
    scrollOffset += player.speed*dt*PPU;
    elapsedRaceTime += dt;

    if(!reducedMotion && player.speed>4){
      if(Math.random() < dt*Math.min(6, player.speed/8)){
        particles.push({ x:0, y:0, life:0.5 });
      }
    }
    particles.forEach(function(p){ p.life -= dt; p.x -= player.speed*dt*PPU*0.6; });
    particles = particles.filter(function(p){ return p.life>0; });

    updateVoiceUI(voicing, thr);
    updateCheer(voicing);

    if(!raceFinished && (player.distance>=trackDistance || ai.distance>=trackDistance)){
      raceFinished = true;
      var playerWon = player.distance>=trackDistance;
      finishRace(playerWon);
    }
  }

  function updateVoiceUI(voicing, thr){
    var fillPct = clamp(smoothLevel/gaugeMax,0,1)*100;
    var thrPct = clamp(thr/gaugeMax,0,1)*100;
    el.meterFill.style.width = fillPct+"%";
    el.meterFill.classList.toggle("is-active", voicing);
    el.meterThreshold.style.left = thrPct+"%";
    el.meterState.textContent = voicing ? "Aktiv" : "Still";
    el.meterState.classList.toggle("is-active", voicing);
  }

  function updateCheer(voicing){
    if(elapsedRaceTime - cheerLastUpdate < 0.5) return;
    cheerLastUpdate = elapsedRaceTime;
    var msg;
    if(!voicing && streak===0){ msg = "Ton halten, um Gas zu geben!"; }
    else if(streak < 2){ msg = "Weiter so!"; }
    else if(streak < 5){ msg = "Super, halt durch!"; }
    else { msg = "Starke Ausdauer!"; }
    if(player.distance < ai.distance - 8){ msg += " Der Gegner zieht davon."; }
    else if(player.distance > ai.distance + 8){ msg = "Du liegst vorne! " + msg; }
    el.cheer.textContent = msg;
  }

  function updateHud(){
    el.speedVal.textContent = Math.round(player.speed*3.2)+" km/h";
    el.streakVal.textContent = streak.toFixed(1)+" s";
    el.distVal.textContent = Math.round(Math.min(player.distance,trackDistance))+" / "+trackDistance+" m";
    el.playerMarker.style.left = (clamp(player.distance/trackDistance,0,1)*100)+"%";
    el.aiMarker.style.left = (clamp(ai.distance/trackDistance,0,1)*100)+"%";
  }

  // ---------- drawing ----------
  function drawCar(c, x, y, scale, car){
    var body = car.body, accent = car.accent, glass = car.glass, profile = car.profile || "wedge";
    c.save();
    c.translate(x,y);
    c.scale(scale,scale);

    // body proportions per profile: [halfLen, halfHeight, cabinInset]
    var dims = { wedge:[30,10,10], curve:[29,10,9], sleek:[33,9,11], compact:[26,11,8] }[profile];
    var hl = dims[0], hh = dims[1], ci = dims[2];

    c.fillStyle = body;
    if(profile==="wedge"){
      // sportlich-flache Front (angedeutete Keilform)
      c.beginPath();
      c.moveTo(-hl,hh); c.lineTo(-hl+6,-hh*0.2); c.lineTo(-hl+16,-hh);
      c.lineTo(hl-8,-hh); c.lineTo(hl,-hh*0.4); c.lineTo(hl,hh);
      c.closePath(); c.fill();
    } else {
      roundRect(c,-hl,-hh,hl*2,hh*2,6); c.fill();
    }

    // Kabine / Scheiben
    c.fillStyle = glass;
    if(profile==="curve"){
      c.beginPath(); c.ellipse(-2,-hh-3,ci+2,10,0,Math.PI,0,false); c.fill();
    } else {
      roundRect(c,-ci,-hh-8,ci*2,10,4); c.fill();
    }

    // Markentypische Akzente
    if(profile==="wedge"){ // Ferrari-artig: schmaler Heckflügel
      c.fillStyle = accent;
      c.fillRect(hl-10,-hh-6,10,3);
      c.fillRect(hl-11,-hh-6,2,7);
    } else if(profile==="curve"){ // Porsche-artig: Entenbürzel-Spoiler
      c.fillStyle = accent;
      c.beginPath();
      c.moveTo(hl-14,-hh); c.lineTo(hl-4,-hh-5); c.lineTo(hl-2,-hh); c.closePath(); c.fill();
    } else if(profile==="sleek"){ // Mercedes-artig: Kühlergrill-Akzent
      c.fillStyle = accent;
      roundRect(c,-hl,-4,6,8,2); c.fill();
    } else if(profile==="compact"){ // VW-artig: zweifarbiges Dach
      c.fillStyle = accent;
      roundRect(c,-ci-2,-hh-9,ci*2+4,3,2); c.fill();
    }

    c.fillStyle = "#14181f";
    c.beginPath(); c.arc(-hl*0.55,hh,7,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(hl*0.55,hh,7,0,Math.PI*2); c.fill();
    c.restore();
  }
  function roundRect(c,x,y,w,h,r){
    c.beginPath();
    c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);
    c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r);
    c.arcTo(x,y,x+w,y,r);
    c.closePath();
  }

  function drawCoverImage(c,img,dx,dy,dw,dh){
    var sw = img.naturalWidth, sh = img.naturalHeight;
    if(!sw || !sh) return;
    var scale = Math.max(dw/sw, dh/sh);
    var sW = dw/scale, sH = dh/scale;
    var sx = (sw-sW)/2, sy = (sh-sH)/2;
    c.drawImage(img, sx, sy, sW, sH, dx, dy, dw, dh);
  }

  function drawScenery(c,w,h,t,offset){
    var horizon = h*0.62;
    if(t.scenery==="coast"){
      // Meer
      c.fillStyle = "#8fb9cf";
      c.fillRect(0,horizon-16,w,16);
      c.fillStyle = "rgba(255,255,255,.5)";
      var wx = -(offset*0.08)%50;
      for(var wI=-1;wI<w/50+1;wI++){ c.fillRect(wx+wI*50, horizon-9, 18, 2); }
      // ferne Häuser der Küstenstadt (pastellfarben, versetzte Dächer)
      var houseColors = ["#f4d9b0","#e9c7c7","#e4dcb8","#d8c8e0"];
      var bx = -(offset*0.16)%110;
      for(var i=-1;i<w/110+1;i++){
        var hx = bx+i*110, hCol = houseColors[Math.abs(i)%houseColors.length];
        var hh2 = 20 + (Math.abs(i*37)%13);
        c.fillStyle = hCol;
        c.fillRect(hx, horizon-hh2, 26, hh2);
        c.fillStyle = "#b23a3a";
        c.beginPath(); c.moveTo(hx-3,horizon-hh2); c.lineTo(hx+13,horizon-hh2-10); c.lineTo(hx+29,horizon-hh2); c.closePath(); c.fill();
      }
      // felsige Küste im Vordergrund
      c.fillStyle = "#c9c2b3";
      var rx = -(offset*0.28)%140;
      for(var r=-1;r<w/140+1;r++){
        c.beginPath();
        c.moveTo(rx+r*140, horizon);
        c.lineTo(rx+r*140+40, horizon-24);
        c.lineTo(rx+r*140+90, horizon);
        c.closePath(); c.fill();
      }
    } else if(t.scenery==="forest"){
      // ferner Höhenzug
      c.fillStyle = "#a9c9b3";
      c.beginPath(); c.moveTo(0,horizon);
      var rid = -(offset*0.05)%180;
      for(var m=-1;m<w/180+2;m++){ c.lineTo(rid+m*180+90, horizon-38); c.lineTo(rid+m*180+180, horizon); }
      c.lineTo(w,horizon); c.closePath(); c.fill();
      // hintere Baumreihe (kleiner, dunkler)
      c.fillStyle = "#2f6142";
      var fx2 = -(offset*0.14)%70;
      for(var j2=-1;j2<w/70+1;j2++){
        c.beginPath();
        c.moveTo(fx2+j2*70+14,horizon); c.lineTo(fx2+j2*70+30,horizon-30); c.lineTo(fx2+j2*70+46,horizon);
        c.closePath(); c.fill();
      }
      // vordere Baumreihe (größer, heller)
      c.fillStyle = "#3f7a53";
      var fx = -(offset*0.22)%90;
      for(var j=-1;j<w/90+1;j++){
        c.beginPath();
        c.moveTo(fx+j*90+20,horizon);
        c.lineTo(fx+j*90+45,horizon-46);
        c.lineTo(fx+j*90+70,horizon);
        c.closePath(); c.fill();
      }
    } else {
      // Parkbäume hinter den Tribünen
      c.fillStyle = "#4a7a52";
      var tx = -(offset*0.14)%64;
      for(var t2=-1;t2<w/64+1;t2++){
        c.beginPath(); c.arc(tx+t2*64+16, horizon-22, 13, 0, Math.PI*2); c.fill();
      }
      // Tribüne
      c.fillStyle = "#a9a29b";
      c.fillRect(0,horizon-26,w,26);
      c.fillStyle = "#7d7871";
      for(var s=0;s<5;s++){ c.fillRect(0,horizon-26+s*5,w,1); }
      var gx = -(offset*0.25)%60;
      c.fillStyle = "#c2273d";
      for(var k=-1;k<w/60+1;k++){ c.fillRect(gx+k*60,horizon-26,10,26); }
      c.fillStyle = "#f4f6f2";
      for(var k2=-1;k2<w/60+1;k2++){ c.fillRect(gx+k2*60+30,horizon-26,10,26); }
    }
  }

  function drawRace(){
    var w = el.raceCanvas.clientWidth, h = el.raceCanvas.clientHeight;
    if(w===0||h===0) return;
    var t = TRACKS[selectedTrack];
    var grad = ctx.createLinearGradient(0,0,0,h*0.62);
    grad.addColorStop(0,t.sky[0]); grad.addColorStop(1,t.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,w,h*0.62);

    var bgImg = trackImageEls[selectedTrack];
    if(bgImg && bgImg.complete && bgImg.naturalWidth>0){
      drawCoverImage(ctx, bgImg, 0, 0, w, h*0.62);
    } else {
      drawScenery(ctx,w,h,t,scrollOffset);
    }

    var roadTop = h*0.6;
    ctx.fillStyle = "#2b2f38";
    ctx.fillRect(0,roadTop,w,h-roadTop);

    ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.lineWidth = 4;
    ctx.setLineDash([26,22]);
    ctx.lineDashOffset = scrollOffset;
    ctx.beginPath();
    ctx.moveTo(0, roadTop + (h-roadTop)/2);
    ctx.lineTo(w, roadTop + (h-roadTop)/2);
    ctx.stroke();
    ctx.setLineDash([]);

    var carY = roadTop + (h-roadTop)/2;
    particles.forEach(function(p){
      ctx.fillStyle = "rgba(255,255,255,"+clamp(p.life/0.5,0,1)*0.5+")";
      ctx.beginPath();
      ctx.arc(w*0.2 + p.x - 34, carY+6, 5, 0, Math.PI*2);
      ctx.fill();
    });

    var carImg = carImageEls[selectedCar];
    if(carImg && carImg.complete && carImg.naturalWidth>0){
      var cw = 128, chh = cw * (carImg.naturalHeight/carImg.naturalWidth);
      ctx.drawImage(carImg, w*0.2-cw/2, carY-chh*0.58, cw, chh);
    } else {
      drawCar(ctx, w*0.2, carY, 1, { body:"#c8102e", accent:"#161616", glass:"#1c2430", profile:"wedge" });
    }
  }

  // ---------- finish ----------
  function finishRace(playerWon){
    releaseWakeLock();
    var isBest = false;
    if(playerWon){ isBest = writeBestIfBetter(selectedTrack, selectedDifficulty, elapsedRaceTime); }
    showResult(playerWon, isBest);
  }

  function showResult(playerWon, isBest){
    el.resultHeadline.textContent = playerWon ? "Sieg!" : "Knapp verloren";
    el.resultHeadline.className = "result-headline " + (playerWon ? "win" : "lose");
    el.resultTime.textContent = formatTime(elapsedRaceTime);
    var best = readBest(selectedTrack, selectedDifficulty);
    el.resultBest.textContent = best ? formatTime(best) : "–";
    el.resultBadge.hidden = !isBest;
    el.resultTip.textContent = playerWon
      ? "Stark durchgehalten! Für die nächste Stufe: noch länger ohne Pause tönen."
      : "Der Gegner war schneller unterwegs. Versuch, den Ton noch etwas länger ohne Unterbrechung zu halten.";
    showScreen("screen-result");
  }

  // ---------- controls ----------
  el.startBtn.addEventListener("click", startFlow);
  el.calibCancel.addEventListener("click", function(){
    abortGame();
    showScreen("screen-setup");
  });
  el.pauseBtn.addEventListener("click", function(){
    paused = !paused;
    el.pauseBtn.textContent = paused ? "Weiter" : "Pause";
    if(!paused){ startRaceLoop(); }
  });
  el.retryBtn.addEventListener("click", function(){ beginCountdownAndRace(); });
  el.changeTrackBtn.addEventListener("click", function(){
    buildTrackGrid(); buildCarGrid(); buildDiffSeg(); updateBestLine();
    showScreen("screen-setup");
  });

  // Live-Pegel in den Einstellungen, damit man die Empfindlichkeit am Gerät einstellen kann.
  function updateLevelReadout(){
    if(el.settingsBackdrop.hidden) return;
    if(analyser){
      var level = currentRMS();
      el.levelReadout.textContent = "Pegel " + level.toFixed(4) + " · Schwelle " + currentThreshold().toFixed(4) +
        (level > currentThreshold() ? " · aktiv" : "");
    } else {
      el.levelReadout.textContent = "Pegel erscheint nach dem ersten Start.";
    }
    requestAnimationFrame(updateLevelReadout);
  }
  el.settingsBtn.addEventListener("click", function(){
    el.settingsBackdrop.hidden = false;
    requestAnimationFrame(updateLevelReadout);
  });
  el.closeSettingsBtn.addEventListener("click", function(){ el.settingsBackdrop.hidden = true; });
  el.sensSlider.addEventListener("input", function(){
    sensitivity = parseFloat(el.sensSlider.value);
    try { localStorage.setItem(SENS_KEY, String(sensitivity)); } catch(e){}
  });
  el.recalibBtn.addEventListener("click", function(){
    el.settingsBackdrop.hidden = true;
    if(!analyser){ return; }
    if(!el["screen-race"].hidden){ paused = true; }
    beginCalibration();
  });

  // ---------- boot (with hot-reload state carry) -------  // ---------- mobile: App-Wechsel, Zurück-Taste ----------
  function micEnded(){
    if(!micStream) return false;
    var track = micStream.getAudioTracks()[0];
    return !track || track.readyState === "ended";
  }
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "hidden"){
      // Beim Wechsel in eine andere App das Rennen anhalten.
      if(!el["screen-race"].hidden && !raceFinished && !paused){
        paused = true;
        el.pauseBtn.textContent = "Weiter";
      }
      return;
    }
    if(audioCtx && audioCtx.state !== "running"){ audioCtx.resume().catch(function(){}); }
    if(wantWakeLock){ requestWakeLock(); }
    // iOS beendet das Mikrofon oft im Hintergrund -> neu anfragen lassen.
    if(micEnded()){
      micStream = null; analyser = null;
      if(el["screen-setup"].hidden){
        abortGame();
        showScreen("screen-setup");
        showError("Das Mikrofon wurde unterbrochen. Bitte nochmal auf Starten tippen.");
      }
    }
  });
  window.addEventListener("popstate", function(){
    if(el["screen-home"].hidden){
      abortGame();
      el.settingsBackdrop.hidden = true;
      showScreen("screen-home");
    }
  });

  // ---------- game choice ----------
  el.gameRace.addEventListener("click", function(){
    clearError();
    showScreen("screen-setup");
  });
  // Vokal-Kart and the vowel test are separate pages; coming back skips the intro.
  function openPage(url){
    try { sessionStorage.setItem(INTRO_SEEN_KEY, "1"); } catch(e){}
    location.href = url;
  }
  el.gameKart.addEventListener("click", function(){ openPage("kart.html"); });
  el.gameTest.addEventListener("click", function(){ openPage("vokal-test.html"); });
  el.backHomeBtn.addEventListener("click", function(){ showScreen("screen-home"); });

  // ---------- boot ----------
  function init(){
    if(!CARS[selectedCar]){ selectedCar = "ferrari"; }
    buildTrackGrid();
    buildCarGrid();
    buildDiffSeg();
    updateBestLine();
    showScreen("screen-home");
  }
  init();

  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
})();
