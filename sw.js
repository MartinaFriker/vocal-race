// Service Worker: macht das Spiel offline spielbar und installierbar.
// Bei jeder Änderung an Dateien der App VERSION erhöhen, damit die Geräte
// die neue Version laden (alte Caches werden dann gelöscht).
var VERSION = "v2";
var APP_CACHE = "vokalrennen-app-" + VERSION;
var FONT_CACHE = "vokalrennen-fonts";

var APP_FILES = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "assets/cars/audi.png",
  "assets/cars/lambo.png",
  "assets/cars/bugatti.png",
  "assets/cars/ferrari.png",
  "assets/tracks/monaco.jpg",
  "assets/tracks/nurburgring.jpg",
  "assets/tracks/monza.jpg",
  "assets/intro.mp4"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(function(cache){ return cache.addAll(APP_FILES.map(function(u){ return new Request(u, { cache:"reload" }); })); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(key){
        if(key !== APP_CACHE && key !== FONT_CACHE){ return caches.delete(key); }
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Safari lädt Videos mit Range-Requests; aus dem Cache muss dann ein 206 kommen.
function rangeResponse(request, response){
  var range = request.headers.get("range");
  if(!range) return response;
  return response.arrayBuffer().then(function(buf){
    var m = /bytes=(\d*)-(\d*)/.exec(range);
    var start = m && m[1] ? parseInt(m[1], 10) : 0;
    var end = m && m[2] ? parseInt(m[2], 10) : buf.byteLength - 1;
    end = Math.min(end, buf.byteLength - 1);
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      statusText: "Partial Content",
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "video/mp4",
        "Content-Range": "bytes " + start + "-" + end + "/" + buf.byteLength,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes"
      }
    });
  });
}

self.addEventListener("fetch", function(event){
  var request = event.request;
  if(request.method !== "GET") return;
  var url = new URL(request.url);

  // Google Fonts: einmal laden, danach aus dem Cache (auch offline).
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    event.respondWith(
      caches.open(FONT_CACHE).then(function(cache){
        return cache.match(request).then(function(hit){
          if(hit) return hit;
          return fetch(request).then(function(res){
            if(res.ok || res.type === "opaque"){ cache.put(request, res.clone()); }
            return res;
          });
        });
      })
    );
    return;
  }

  if(url.origin !== self.location.origin) return;

  // Seitenaufrufe immer mit der gespeicherten App-Seite beantworten.
  if(request.mode === "navigate"){
    event.respondWith(
      caches.match("index.html", { cacheName: APP_CACHE })
        .then(function(hit){ return hit || fetch(request); })
        .catch(function(){ return fetch(request); })
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: APP_CACHE, ignoreSearch: true, ignoreVary: true }).then(function(hit){
      if(hit) return rangeResponse(request, hit);
      return fetch(request);
    })
  );
});
