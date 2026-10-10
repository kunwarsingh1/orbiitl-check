# Fixing findings

Snippets for the most common findings. Adapt names and paths to your setup, and
re-run `orbiitl-check` afterwards to confirm. Findings are tagged with the
layer they live in, so find your layer below.

- [Deployment level: reverse proxy (Caddy / nginx)](#deployment-level-reverse-proxy)
- [Code level: the app (Next.js / Vite / others)](#code-level-the-app)
- [Infra level: DNS, CDN, firewall](#infra-level-dns-cdn-firewall)

## Deployment level: reverse proxy

### Caddy

```caddy
app.example.com {
    # Caddy redirects HTTP -> HTTPS automatically for a hostname site block.
    # If `headers.http-no-redirect` fires, look for an explicit `http://` site
    # block, `auto_https off`, or the app itself answering on port 80.

    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "DENY"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "camera=(), microphone=(), geolocation=()"
        -Server
        -X-Powered-By
    }

    # Never serve sourcemaps, even if one slips into a deploy.
    @maps path *.map
    respond @maps 404

    reverse_proxy localhost:3000
}
```

Add `preload` to HSTS only once every subdomain serves HTTPS and you
understand that preload is hard to undo.

### nginx

```nginx
# Redirect all plain HTTP to HTTPS
server {
    listen 80;
    server_name app.example.com;
    return 301 https://$host$request_uri;
}

# Refuse requests that arrive by bare IP or an unknown name
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    ssl_reject_handshake on;   # nginx >= 1.19.4
    return 444;
}

server {
    listen 443 ssl;
    server_name app.example.com;

    server_tokens off;         # hides the nginx version in `Server`

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "camera=(), microphone=(), geolocation=()" always;

    location ~* \.map$ { return 404; }

    location / { proxy_pass http://127.0.0.1:3000; }
}
```

`add_header` directives in a `location` block replace those in the `server`
block, so repeat them if you add `add_header` inside a location.

### Content-Security-Policy

CSP is application-specific because it must list the origins your app really
uses. Start in report-only mode and tighten from the reports:

```text
Content-Security-Policy-Report-Only: default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Frameworks that inject inline scripts (Next.js) need nonces or hashes rather
than `'unsafe-inline'`.

## Code level: the app

### Do not ship sourcemaps (`exposed-artifacts.sourcemap.*`)

| Tool | Setting |
|---|---|
| Vite | `build: { sourcemap: false }` in `vite.config` |
| Next.js | `productionBrowserSourceMaps: false` (the default; check you have not enabled it) |
| Create React App | `GENERATE_SOURCEMAP=false` when building |
| webpack | `devtool: false` for production |
| Angular | `"sourceMap": false` in the production configuration |

If you need sourcemaps for error tracking, upload them to the tracker
(Sentry etc.) in CI and delete them from the deploy artifact, or serve them
only to authenticated users.

Also confirm the deploy artifact is the build output only: no `src/`,
`node_modules/`, `.env`, `.git`. See `.dockerignore` / `.gitignore` and your
deploy script.

### Headers from the framework (`headers.*`)

If you do not control the proxy, set them in the app. Next.js:

```js
// next.config.js
module.exports = {
  poweredByHeader: false, // removes X-Powered-By
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};
```

Express: use [`helmet`](https://helmetjs.github.io/) and `app.disable("x-powered-by")`.
Django: `SECURE_HSTS_SECONDS`, `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS`,
`SECURE_REFERRER_POLICY`. FastAPI/Flask: add the headers in middleware.

### Console-logged secrets (`browser.console-secret.*`)

Remove the logging, rotate the leaked credential (assume it is compromised),
and strip `console.*` from production builds (`esbuild` `drop: ["console"]`,
terser `drop_console`).

## Infra level: DNS, CDN, firewall

### No CDN/WAF, or the origin IP is directly reachable

A reverse proxy such as Caddy or nginx cannot replace a CDN: it runs on your
own server, so volumetric traffic still reaches your machine and your IP is
still public. To fix the finding:

1. Put a CDN/WAF in front (Cloudflare, CloudFront, Fastly, ...) and make sure
   the DNS record is proxied through it.
2. Restrict the origin firewall / security group so ports 80 and 443 accept
   only the CDN's IP ranges (for Cloudflare: <https://www.cloudflare.com/ips/>).
3. Rotate anything that exposed the old IP if it matters (the IP may be in
   certificate-transparency logs and DNS history).

A reverse proxy can still add rate limiting and a WAF (for example the Coraza
module for Caddy) as defense in depth.

### Bare IP serves the app (`origin-ip.direct-ip-serves-app.*`)

Make the default vhost refuse unknown hosts (see the nginx `default_server`
block above). In Caddy, define only named site blocks; requests with an unknown
SNI fail the TLS handshake by default.
