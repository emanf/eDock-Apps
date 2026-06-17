import { readFile, writeFile } from "node:fs/promises";

const SOURCES_FILE = "sources.json";
const OUTPUT_FILE = "packages.json";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeManifest(manifest, manifestUrl) {
  const requiredFields = ["id", "title", "description", "version", "author"];

  for (const field of requiredFields) {
    if (!isNonEmptyString(manifest[field])) {
      throw new Error(`Missing required field "${field}"`);
    }
  }

  return {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    version: manifest.version,
    author: manifest.author,
    homepage: manifest.homepage ?? null,
    icon: manifest.icon ?? null,
    download: manifest.download ?? null,
    manifest: manifestUrl,
    category: manifest.category ?? null,
    keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
    min_edock_version: manifest.min_edock_version ?? null,
    license: manifest.license ?? null
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "eDock-Apps-Generator"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  const sourcesRaw = await readFile(SOURCES_FILE, "utf8");
  const sources = JSON.parse(sourcesRaw);

  if (!Array.isArray(sources.manifests)) {
    throw new Error(`"${SOURCES_FILE}" must contain a manifests array`);
  }

  const packages = [];
  const seenIds = new Set();

  for (const manifestUrl of sources.manifests) {
    if (!isNonEmptyString(manifestUrl)) {
      console.warn(`Skipping invalid manifest URL: ${manifestUrl}`);
      continue;
    }

    try {
      console.log(`Fetching ${manifestUrl}`);
      const manifest = await fetchJson(manifestUrl);
      const pkg = normalizeManifest(manifest, manifestUrl);

      if (seenIds.has(pkg.id)) {
        throw new Error(`Duplicate app id "${pkg.id}"`);
      }

      seenIds.add(pkg.id);
      packages.push(pkg);
    } catch (error) {
      console.error(`Failed to process ${manifestUrl}: ${error.message}`);
    }
  }

  packages.sort((a, b) => a.id.localeCompare(b.id));

  const output = {
    schema: 1,
    generated_at: new Date().toISOString(),
    packages
  };

  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote ${packages.length} packages to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
