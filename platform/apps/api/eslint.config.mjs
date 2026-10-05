import base from "@bebest/config/eslint.config.mjs";

// Epic 22 — `@bebest/database/platform` is a connection as `bebest_platform`,
// a role that bypasses Row-Level Security (see that module's header and
// packages/database/scripts/create-platform-role.sql). It may only be held by
// the Platform API, whose every route sits behind `requirePlatformRole`.
// Anywhere else, importing it would be a cross-tenant read path with no
// staff check in front of it.
const PLATFORM_DB_RESTRICTION = {
  paths: [
    {
      name: "@bebest/database/platform",
      message:
        "platformDb bypasses RLS. Import it only under src/routes/platform/** (behind requirePlatformRole).",
    },
  ],
  patterns: [
    {
      group: ["**/packages/database/src/platform", "**/packages/database/src/platform.*"],
      message:
        "platformDb bypasses RLS. Import @bebest/database/platform, and only under src/routes/platform/**.",
    },
  ],
};

export default [
  ...base,
  {
    files: ["**/*.ts"],
    ignores: ["src/routes/platform/**"],
    rules: {
      "no-restricted-imports": ["error", PLATFORM_DB_RESTRICTION],
    },
  },
];
