import { readFile } from "node:fs/promises";

const SOURCES_FILE = "sources.json";

const requiredFields = [
  "id",
  "title",
  "description",
  "version",
  "author",
  "homepage",
  "download"
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidAppId(value) {
  return /^[a-z0-9]+(\.[a-z0-9_-]+)+$/.test(value);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "eDock-Source-Validator"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function validateManifest(manifest, manifestUrl) {
  for (const field of requiredFields) {
    if (!isNonEmptyString(manifest[field])) {
      throw new Error(`Missing required field "${field}"`);
    }
  }

  if (!isValidAppId(manifest.id)) {
    throw new Error(`Invalid app id "${manifest.id}"`);
  }

  if (!isValidUrl(manifest.homepage)) {
    throw new Error(`Invalid homepage URL`);
  }

  if (!isValidUrl(manifest.download)) {
    throw new Error(`Invalid download URL`);
  }

  if (manifest.icon && !manifest.icon.startsWith("m:") && !isValidUrl(manifest.icon)) {
    throw new Error(`Invalid icon value`);
  }

  if (manifest.manifest && manifest.manifest !== manifestUrl) {
    throw new Error(`Manifest field does not match source URL`);
  }
}

async function main() {
  const raw = await readFile(SOURCES_FILE, "utf8");
  const sources = JSON.parse(raw);

  if (sources.schema !== 1) {
    throw new Error(`sources.json schema must be 1`);
  }

  if (!Array.isArray(sources.manifests)) {
    throw new Error(`sources.json must contain a manifests array`);
  }

  const seenManifestUrls = new Set();
  const seenAppIds = new Set();

  for (const manifestUrl of sources.manifests) {
    if (!isNonEmptyString(manifestUrl) || !isValidUrl(manifestUrl)) {
      throw new Error(`Invalid manifest URL: ${manifestUrl}`);
    }

    if (!manifestUrl.startsWith("https://raw.githubusercontent.com/")) {
      throw new Error(`Manifest must be hosted on raw.githubusercontent.com: ${manifestUrl}`);
    }

    if (seenManifestUrls.has(manifestUrl)) {
      throw new Error(`Duplicate manifest URL: ${manifestUrl}`);
    }

    seenManifestUrls.add(manifestUrl);

    console.log(`Validating ${manifestUrl}`);

    const manifest = await fetchJson(manifestUrl);
    validateManifest(manifest, manifestUrl);

    if (seenAppIds.has(manifest.id)) {
      throw new Error(`Duplicate app id: ${manifest.id}`);
    }

    seenAppIds.add(manifest.id);
  }

  console.log(`Validated ${sources.manifests.length} sources successfully`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
