import { readFile, writeFile } from "node:fs/promises";

const REGISTRIES = [
  {
    sourcesFile: "sources.json",
    outputFile: "packages.json"
  },
  {
    sourcesFile: "pending_sources.json",
    outputFile: "pending_packages.json"
  }
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringOrNull(value) {
  return isNonEmptyString(value) ? value : null;
}

function normalizeString(value, field) {
  if (!isNonEmptyString(value)) {
    throw new Error(`Missing required field "${field}"`);
  }

  return value;
}

function normalizeKeywords(value) {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function normalizeManifest(manifest, manifestUrl) {
  const requiredFields = [
    "schema",
    "id",
    "title",
    "description",
    "version",
    "last_modified",
    "author",
    "icon",
    "homepage",
    "repository",
    "download",
    "manifest",
    "min_edock_version"
  ];

  for (const field of requiredFields) {
    normalizeString(manifest[field], field);
  }

  if (manifest.schema !== 1) {
    throw new Error('Field "schema" must be 1');
  }

  return {
    schema: manifest.schema,
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    version: manifest.version,
    last_modified: manifest.last_modified,
    author: manifest.author,
    author_email: normalizeStringOrNull(manifest.author_email),
    author_website: normalizeStringOrNull(manifest.author_website),
    icon: manifest.icon,
    homepage: manifest.homepage,
    repository: manifest.repository,
    category: normalizeStringOrNull(manifest.category),
    keywords: normalizeKeywords(manifest.keywords),
    download: manifest.download,
    manifest: manifestUrl,
    changelog: normalizeStringOrNull(manifest.changelog),
    min_edock_version: manifest.min_edock_version,
    license: typeof manifest.license === "string" ? manifest.license : null
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

async function generateRegistry(sourcesFile, outputFile) {
  const sourcesRaw = await readFile(sourcesFile, "utf8");
  const sources = JSON.parse(sourcesRaw);

  if (!Array.isArray(sources.manifests)) {
    throw new Error(`"${sourcesFile}" must contain a manifests array`);
  }

  const packages = [];
  const seenIds = new Set();

  for (const manifestUrl of sources.manifests) {
    if (!isNonEmptyString(manifestUrl)) {
      console.warn(`Skipping invalid manifest URL in ${sourcesFile}: ${manifestUrl}`);
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

  await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote ${packages.length} packages to ${outputFile}`);
}

async function main() {
  for (const registry of REGISTRIES) {
    await generateRegistry(registry.sourcesFile, registry.outputFile);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
