const CACHE_NAME = "pindou-cache-v2";
const ASSETS = ["./index.html", "./style.css", "./app.js", "./manifest.webmanifest", "./icon.svg", "./icon-maskable.svg"];

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isAppShell(url) {
  try {
    const u = new URL(url);
    const p = u.pathname;
    return p.endsWith("/") || p.endsWith("/index.html") || p.endsWith("/app.js") || p.endsWith("/style.css") || p.endsWith("/manifest.webmanifest");
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (!isSameOrigin(req.url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // For navigations / app-shell assets: always try network first so users get the newest version.
      if (req.mode === "navigate" || isAppShell(req.url)) {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh && fresh.ok) {
            cache.put(req, fresh.clone());
            return fresh;
          }
        } catch {
          // ignore and fall back to cache below
        }

        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        return (await caches.match("./index.html")) || new Response("Offline", { status: 503 });
      }

      // For other assets: cache-first with background revalidate.
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) {
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(req);
              if (fresh && fresh.ok) await cache.put(req, fresh.clone());
            } catch {
              // ignore
            }
          })()
        );
        return cached;
      }

      try {
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      } catch {
        // fallback to app shell
        return (await caches.match("./index.html")) || new Response("Offline", { status: 503 });
      }
    })()
  );
});

