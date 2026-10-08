export interface ProbePath {
  path: string;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  /** Substrings that, if found in the body, confirm this isn't a soft-404/custom error page masquerading as 200. */
  sanityMarkers?: string[];
  stack: "node" | "python" | "generic";
}

export const PROBE_PATHS: ProbePath[] = [
  // --- Node / React / Next.js ---
  { path: "/node_modules/", severity: "high", title: "node_modules directory exposed", stack: "node" },
  { path: "/node_modules/.package-lock.json", severity: "high", title: "node_modules lockfile exposed", stack: "node" },
  { path: "/package.json", severity: "medium", title: "package.json exposed", sanityMarkers: ["\"dependencies\"", "\"name\""], stack: "node" },
  { path: "/package-lock.json", severity: "medium", title: "package-lock.json exposed", sanityMarkers: ["\"lockfileVersion\""], stack: "node" },
  { path: "/.next/", severity: "low", title: "Next.js build directory listing exposed", stack: "node" },
  { path: "/_next/static/", severity: "info", title: "Next.js static asset root reachable (expected, informational)", stack: "node" },
  { path: "/src/", severity: "medium", title: "/src/ source directory exposed", stack: "node" },
  { path: "/webpack.config.js", severity: "medium", title: "webpack.config.js exposed", stack: "node" },
  { path: "/tsconfig.json", severity: "low", title: "tsconfig.json exposed", sanityMarkers: ["compilerOptions"], stack: "node" },
  { path: "/.env", severity: "high", title: ".env file exposed", stack: "node" },
  { path: "/.env.local", severity: "high", title: ".env.local file exposed", stack: "node" },
  { path: "/.env.production", severity: "high", title: ".env.production file exposed", stack: "node" },

  // --- Python (Django / Flask / FastAPI) ---
  { path: "/requirements.txt", severity: "medium", title: "requirements.txt exposed", stack: "python" },
  { path: "/Pipfile", severity: "medium", title: "Pipfile exposed", stack: "python" },
  { path: "/pyproject.toml", severity: "low", title: "pyproject.toml exposed", stack: "python" },
  { path: "/__pycache__/", severity: "high", title: "__pycache__ directory exposed", stack: "python" },
  { path: "/manage.py", severity: "high", title: "Django manage.py exposed", stack: "python" },
  { path: "/app.py", severity: "high", title: "Flask app.py exposed", stack: "python" },
  { path: "/wsgi.py", severity: "high", title: "wsgi.py exposed", stack: "python" },
  { path: "/asgi.py", severity: "high", title: "asgi.py exposed", stack: "python" },
  { path: "/static/admin/css/base.css", severity: "info", title: "Django admin static assets reachable (confirms Django + admin panel present)", stack: "python" },
  { path: "/admin/login/", severity: "info", title: "Django admin login page reachable", stack: "python" },

  // --- Generic / infra ---
  { path: "/.git/HEAD", severity: "high", title: ".git repository exposed", sanityMarkers: ["ref:"], stack: "generic" },
  { path: "/.git/config", severity: "high", title: ".git/config exposed", sanityMarkers: ["[core]"], stack: "generic" },
  { path: "/.svn/entries", severity: "high", title: ".svn repository exposed", stack: "generic" },
  { path: "/.DS_Store", severity: "low", title: ".DS_Store exposed", stack: "generic" },
  { path: "/docker-compose.yml", severity: "high", title: "docker-compose.yml exposed", stack: "generic" },
  { path: "/Dockerfile", severity: "medium", title: "Dockerfile exposed", stack: "generic" },
  { path: "/.vscode/settings.json", severity: "low", title: ".vscode/settings.json exposed", stack: "generic" },
  { path: "/.idea/workspace.xml", severity: "low", title: ".idea/workspace.xml exposed", stack: "generic" },
  { path: "/backup.zip", severity: "medium", title: "backup.zip exposed at root", stack: "generic" },
  { path: "/backup.tar.gz", severity: "medium", title: "backup.tar.gz exposed at root", stack: "generic" },
  { path: "/site.bak", severity: "medium", title: "site.bak exposed at root", stack: "generic" },
  { path: "/.htpasswd", severity: "high", title: ".htpasswd exposed", stack: "generic" },
  { path: "/.aws/credentials", severity: "high", title: ".aws/credentials exposed", stack: "generic" },
];

/** Extensions tried when swapping a referenced built `.js` bundle's extension, to see if the un-built source is also served. */
export const SOURCE_EXTENSION_GUESSES = [".tsx", ".jsx", ".ts"];
