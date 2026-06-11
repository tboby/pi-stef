#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const pkgFile = process.argv[2];
if (!pkgFile) {
  console.error("Usage: ci-convert-deps.mjs <package.json path>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgFile, "utf-8"));

for (const field of ["dependencies", "devDependencies"]) {
  if (!pkg[field]) continue;
  for (const [name, val] of Object.entries(pkg[field])) {
    if (typeof val === "string" && val.startsWith("file:")) {
      pkg[field][name] = "workspace:*";
    }
  }
}

writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Converted file: deps in ${pkgFile}`);
