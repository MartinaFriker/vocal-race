// Vowel recognition from microphone samples.
// Estimates the first two formants (F1, F2) with LPC analysis and picks the
// closest vowel prototype. No dependencies; works in the browser and in Node.
(function(root){
  "use strict";

  var TARGET_RATE = 12000;   // analysis rate: keeps formants up to ~5 kHz (children's /i/ F2 can reach 3.5 kHz)
  var FIR_TAPS = 63;
  var PRE_EMPHASIS = 0.97;
  var LPC_ORDER = 10;
  // Wider poles model the overall spectral tilt rather than a resonance.
  var MAX_BW = 500;

  var VOWELS = ["a","e","i","o","u"];

  // Typical formant values (Hz). Children's formants are roughly 20-25 % higher than adults'.
  var PRESETS = {
    child: { a:{f1:950,f2:1650}, e:{f1:520,f2:2700}, i:{f1:380,f2:3100}, o:{f1:560,f2:1050}, u:{f1:400,f2:900} },
    adult: { a:{f1:750,f2:1350}, e:{f1:420,f2:2300}, i:{f1:300,f2:2600}, o:{f1:450,f2:850},  u:{f1:320,f2:750} }
  };

  // ---------- low-pass + decimation ----------
  var firCache = {};
  function lowPass(sampleRate, factor){
    var key = sampleRate + "/" + factor;
    if(firCache[key]) return firCache[key];
    var cutoff = 0.45 / factor; // relative to the input rate, just below the new Nyquist
    var h = new Float32Array(FIR_TAPS), mid = (FIR_TAPS - 1) / 2, sum = 0;
    for(var k = 0; k < FIR_TAPS; k++){
      var n = k - mid;
      var sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
      var win = 0.54 - 0.46 * Math.cos(2 * Math.PI * k / (FIR_TAPS - 1));
      h[k] = sinc * win;
      sum += h[k];
    }
    for(var j = 0; j < FIR_TAPS; j++){ h[j] /= sum; }
    firCache[key] = h;
    return h;
  }

  function decimate(x, sampleRate){
    var factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
    if(factor === 1) return { y: Float64Array.from(x), rate: sampleRate };
    var h = lowPass(sampleRate, factor);
    var outLen = Math.floor((x.length - FIR_TAPS) / factor) + 1;
    var y = new Float64Array(Math.max(0, outLen));
    for(var n = 0; n < outLen; n++){
      var acc = 0, base = n * factor;
      for(var k = 0; k < FIR_TAPS; k++){ acc += h[k] * x[base + k]; }
      y[n] = acc;
    }
    return { y: y, rate: sampleRate / factor };
  }

  // ---------- LPC ----------
  // Levinson-Durbin recursion; returns a[0..p] with a[0] = 1.
  function lpc(signal, order){
    var n = signal.length, r = new Float64Array(order + 1);
    for(var lag = 0; lag <= order; lag++){
      var s = 0;
      for(var i = lag; i < n; i++){ s += signal[i] * signal[i - lag]; }
      r[lag] = s;
    }
    if(r[0] <= 1e-12) return null;
    r[0] *= 1.0001; // white-noise correction for numerical stability
    var a = new Float64Array(order + 1), tmp = new Float64Array(order + 1);
    a[0] = 1;
    var err = r[0];
    for(var m = 1; m <= order; m++){
      var acc = r[m];
      for(var j = 1; j < m; j++){ acc += a[j] * r[m - j]; }
      var k = -acc / err;
      tmp.set(a);
      for(var q = 1; q < m; q++){ a[q] = tmp[q] + k * tmp[m - q]; }
      a[m] = k;
      err *= (1 - k * k);
      if(err <= 0) return null;
    }
    return a;
  }

  // Roots of z^p + a1 z^(p-1) + ... + ap via Durand-Kerner iteration.
  function polyRoots(a){
    var p = a.length - 1;
    var re = new Float64Array(p), im = new Float64Array(p);
    for(var i = 0; i < p; i++){
      // spread starting points on a circle, slightly rotated to avoid symmetry
      var ang = 2 * Math.PI * i / p + 0.4;
      re[i] = 0.9 * Math.cos(ang); im[i] = 0.9 * Math.sin(ang);
    }
    for(var iter = 0; iter < 300; iter++){
      var maxStep = 0;
      for(var r = 0; r < p; r++){
        // evaluate polynomial at root r (Horner)
        var vr = 1, vi = 0;
        for(var c = 1; c <= p; c++){
          var nr = vr * re[r] - vi * im[r] + a[c];
          var ni = vr * im[r] + vi * re[r];
          vr = nr; vi = ni;
        }
        // product of differences to the other roots
        var dr = 1, di = 0;
        for(var s = 0; s < p; s++){
          if(s === r) continue;
          var xr = re[r] - re[s], xi = im[r] - im[s];
          var tr = dr * xr - di * xi;
          di = dr * xi + di * xr; dr = tr;
        }
        var den = dr * dr + di * di;
        if(den < 1e-30) continue;
        var qr = (vr * dr + vi * di) / den, qi = (vi * dr - vr * di) / den;
        re[r] -= qr; im[r] -= qi;
        maxStep = Math.max(maxStep, Math.abs(qr) + Math.abs(qi));
      }
      if(maxStep < 1e-10) break;
    }
    return { re: re, im: im };
  }

  // ---------- spectral envelope ----------
  // The LPC envelope sampled at log-spaced frequencies, in dB, with level and overall
  // tilt removed. Comparing envelope shapes still works when two formants merge into
  // one broad peak (O and U at children's pitches), where picking F1/F2 fails.
  var ENV_BANDS = 24, ENV_MIN_HZ = 250, ENV_MAX_HZ = 4500;
  var ENV_FREQS = [];
  for(var b = 0; b < ENV_BANDS; b++){
    ENV_FREQS.push(ENV_MIN_HZ * Math.pow(ENV_MAX_HZ / ENV_MIN_HZ, b / (ENV_BANDS - 1)));
  }

  function envelopeFromLpc(a, fs){
    var env = new Array(ENV_BANDS);
    for(var b = 0; b < ENV_BANDS; b++){
      var w = 2 * Math.PI * ENV_FREQS[b] / fs, re = 0, im = 0;
      for(var k = 0; k < a.length; k++){ re += a[k] * Math.cos(w * k); im -= a[k] * Math.sin(w * k); }
      env[b] = -10 * Math.log10(re * re + im * im + 1e-20);
    }
    return detrend(env);
  }
  // Remove mean and linear slope (over log frequency): loudness and microphone/voice
  // brightness should not change which vowel is recognised.
  function detrend(env){
    var n = env.length, mx = (n - 1) / 2, my = 0, sxy = 0, sxx = 0;
    for(var i = 0; i < n; i++){ my += env[i]; }
    my /= n;
    for(var j = 0; j < n; j++){ sxy += (j - mx) * (env[j] - my); sxx += (j - mx) * (j - mx); }
    var slope = sxy / sxx, out = new Array(n);
    for(var q = 0; q < n; q++){ out[q] = env[q] - my - slope * (q - mx); }
    return out;
  }

  // Preset templates: synthesise each vowel from the formant table (pulse train through
  // formant resonators, like a speech synthesiser) and run it through the same analysis a
  // real voice gets, so the templates carry the same measurement quirks.
  var PRESET_PITCH = { child: 280, adult: 160 };
  var presetCache = {};
  function synthVowel(f0, formants, rate, len){
    var x = new Float64Array(len), next = 0, n, k;
    for(n = 0; n < len; n++){ if(n >= next){ x[n] = 1; next = n + rate / f0; } }
    for(k = 0; k < 2; k++){ var s = 0; for(n = 0; n < len; n++){ s = 0.97 * s + x[n]; x[n] = s; } } // glottal tilt
    formants.forEach(function(f){
      var T = 1 / rate, C = -Math.exp(-2 * Math.PI * f[1] * T);
      var B = 2 * Math.exp(-Math.PI * f[1] * T) * Math.cos(2 * Math.PI * f[0] * T), A = 1 - B - C, y1 = 0, y2 = 0;
      for(n = 0; n < len; n++){ var v = A * x[n] + B * y1 + C * y2; x[n] = v; y2 = y1; y1 = v; }
    });
    for(n = len - 1; n > 0; n--){ x[n] -= x[n - 1]; } // lip radiation
    var out = new Float32Array(2048), peak = 0;
    for(n = 0; n < 2048; n++){ peak = Math.max(peak, Math.abs(x[len - 2048 + n])); }
    for(n = 0; n < 2048; n++){ out[n] = 0.3 * x[len - 2048 + n] / peak; }
    return out;
  }
  function presetEnvelope(kind, vowel){
    var key = kind + vowel;
    if(presetCache[key]) return presetCache[key];
    var p = PRESETS[kind][vowel], rate = 48000;
    var upper = kind === "child" ? [[3600, 150], [4300, 200]] : [[3000, 150], [3700, 200]];
    var formants = [[p.f1, 70], [p.f2, 90]].concat(upper);
    // average over a few pitches around the typical one so the template is not tied to one F0
    var f0 = PRESET_PITCH[kind], envs = [];
    [0.85, 1, 1.18].forEach(function(m){
      var r = analyzeFrame(synthVowel(f0 * m, formants, rate, 9600), rate);
      if(r){ envs.push(r.envelope); }
    });
    presetCache[key] = medianEnvelope(envs);
    return presetCache[key];
  }

  // ---------- frame analysis ----------
  // Returns { envelope, f1, f2 } for a frame; f1/f2 are null when they cannot be told apart.
  // Returns null only if the frame is unusable (silence, numerical failure).
  function analyzeFrame(samples, sampleRate){
    var d = decimate(samples, sampleRate);
    var x = d.y, fs = d.rate, n = x.length;
    if(n < 64) return null;
    for(var i = n - 1; i > 0; i--){ x[i] -= PRE_EMPHASIS * x[i - 1]; }
    for(var w = 0; w < n; w++){ x[w] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * w / (n - 1)); }

    // Fewer poles than the adult rule of thumb (2 + kHz): children's short vocal tracts have
    // only 3-4 formants below 6 kHz, and extra poles latch onto single voice harmonics.
    var a = lpc(x, LPC_ORDER);
    if(!a) return null;

    // F1/F2 for display only.
    var roots = polyRoots(a);
    var formants = [];
    for(var r = 0; r < roots.re.length; r++){
      if(roots.im[r] <= 0) continue;
      var mag = Math.hypot(roots.re[r], roots.im[r]);
      var freq = Math.atan2(roots.im[r], roots.re[r]) * fs / (2 * Math.PI);
      var bw = -Math.log(mag) * fs / Math.PI;
      if(freq > 150 && freq < fs / 2 - 150 && bw > 0 && bw <= MAX_BW){ formants.push(freq); }
    }
    formants.sort(function(p, q){ return p - q; });
    var ok = formants.length >= 2;
    return { envelope: envelopeFromLpc(a, fs), f1: ok ? formants[0] : null, f2: ok ? formants[1] : null };
  }

  // ---------- classification ----------
  // templates: { a: envelope, e: envelope, ... }
  function classify(envelope, templates){
    var best = null, second = null;
    VOWELS.forEach(function(v){
      var t = templates[v];
      if(!t) return;
      var s = 0;
      for(var i = 0; i < envelope.length; i++){ var d = envelope[i] - t[i]; s += d * d; }
      var dist = Math.sqrt(s / envelope.length); // RMS difference in dB
      if(!best || dist < best.dist){ second = best; best = { vowel: v, dist: dist }; }
      else if(!second || dist < second.dist){ second = { vowel: v, dist: dist }; }
    });
    if(!best) return null;
    // 1 = clearly this vowel, 0 = exactly between two vowels
    var confidence = second ? 1 - best.dist / second.dist : 1;
    return { vowel: best.vowel, dist: best.dist, runnerUp: second && second.vowel, confidence: confidence };
  }

  // Element-wise median of several envelopes (smoothing and calibration).
  function medianEnvelope(envelopes){
    if(!envelopes.length) return null;
    var out = new Array(envelopes[0].length);
    for(var i = 0; i < out.length; i++){
      out[i] = median(envelopes.map(function(e){ return e[i]; }));
    }
    return out;
  }

  function median(values){
    if(!values.length) return NaN;
    var s = values.slice().sort(function(p, q){ return p - q; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  var api = {
    analyzeFrame: analyzeFrame, classify: classify, presetEnvelope: presetEnvelope,
    medianEnvelope: medianEnvelope, median: median, VOWELS: VOWELS, PRESETS: PRESETS
  };
  if(typeof module !== "undefined" && module.exports){ module.exports = api; }
  else { root.VowelAnalysis = api; }
})(this);
