import fs from 'node:fs/promises';

const REQUIRED_FIELDS = [
  'schema',
  'id',
  'title',
  'description',
  'last_modified',
  'version',
  'icon',
  'download',
  'manifest'
];

const SOURCE_FILES = [
  'sources.json',
  'pending_sources.json'
];

const PACKAGE_FILES = [
  'packages.json',
  'pending_packages.json'
];

const VALIDATION_MARKER = '<!-- edock-app-submission-validation -->';

function fail(message) {
  throw new Error(message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeUrl(value) {
  return isNonEmptyString(value) ? value.trim() : '';
}

function isValidHttpsUrl(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidAppId(value) {
  return isNonEmptyString(value) && /^[a-z0-9]+(\.[a-z0-9_]+)+$/.test(value);
}

function extractManifestUrlFromIssueBody(body) {
  if (!isNonEmptyString(body)) {
    return null;
  }

  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('https://') && trimmed.endsWith('.json')) {
      return trimmed;
    }
  }

  const match = body.match(/https:\/\/[^\s)]+\.json/);
  return match ? match[0] : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'eDock-App-Submission-Validator'
    }
  });

  if (!response.ok) {
    fail(`Failed to fetch manifest: ${url} (${response.status} ${response.statusText})`);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    fail(`Manifest is not valid JSON: ${url}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail(`Manifest root must be a JSON object: ${url}`);
  }

  return data;
}

function validateManifest(manifest, manifestUrl) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest)) {
      fail(`Missing required field "${field}"`);
    }
  }

  if (manifest.schema !== 1) {
    fail('Field "schema" must be 1');
  }

  if (!isValidAppId(manifest.id)) {
    fail('Field "id" is invalid');
  }

  for (const field of ['title', 'description', 'last_modified', 'version', 'icon', 'download', 'manifest']) {
    if (!isNonEmptyString(manifest[field])) {
      fail(`Field "${field}" must be a non-empty string`);
    }
  }

  if (!isValidHttpsUrl(manifest.download)) {
    fail('Field "download" must be a valid HTTPS URL');
  }

  if (!isValidHttpsUrl(manifest.manifest)) {
    fail('Field "manifest" must be a valid HTTPS URL');
  }

  if (normalizeUrl(manifest.manifest) !== normalizeUrl(manifestUrl)) {
    fail('Field "manifest" must exactly match the submitted manifest URL');
  }

  if (manifest.icon.startsWith('m:')) {
    return;
  }

  if (!isValidHttpsUrl(manifest.icon)) {
    fail('Field "icon" must be a valid HTTPS URL or a material icon like "m:palette"');
  }
}

async function readJsonFileIfExists(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    fail(`Could not read ${filePath}: ${error.message}`);
  }
}

function getManifestListFromSourceData(data, filePath) {
  if (!data) {
    return [];
  }

  if (!Array.isArray(data.manifests)) {
    fail(`Field "manifests" in ${filePath} must be an array`);
  }

  return data.manifests.filter(isNonEmptyString).map(normalizeUrl);
}

function getPackageListFromPackageData(data, filePath) {
  if (!data) {
    return [];
  }

  if (!Array.isArray(data.packages)) {
    fail(`Field "packages" in ${filePath} must be an array`);
  }

  return data.packages;
}

async function findExistingManifest(manifestUrl) {
  const submittedUrl = normalizeUrl(manifestUrl);

  for (const filePath of SOURCE_FILES) {
    const data = await readJsonFileIfExists(filePath);
    const manifests = getManifestListFromSourceData(data, filePath);

    if (manifests.includes(submittedUrl)) {
      return filePath;
    }
  }

  return null;
}

async function findExistingAppId(appId) {
  for (const filePath of PACKAGE_FILES) {
    const data = await readJsonFileIfExists(filePath);
    const packages = getPackageListFromPackageData(data, filePath);

    const existingPackage = packages.find(pkg => pkg && pkg.id === appId);

    if (existingPackage) {
      return {
        filePath,
        manifest: isNonEmptyString(existingPackage.manifest) ? existingPackage.manifest : null
      };
    }
  }

  return null;
}

async function githubRequest(url, method, body) {
  const token = process.env.GITHUB_TOKEN;

  if (!isNonEmptyString(token)) {
    fail('Missing GITHUB_TOKEN');
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'eDock-App-Submission-Validator'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    fail(`GitHub API request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function getBotValidationComments(commentsUrl) {
  const comments = await githubRequest(commentsUrl, 'GET');

  if (!Array.isArray(comments)) {
    return [];
  }

  return comments.filter(comment => typeof comment.body === 'string' && comment.body.includes(VALIDATION_MARKER));
}

async function replaceBotComment(commentsUrl, body) {
  const existingComments = await getBotValidationComments(commentsUrl);
  const finalBody = `${VALIDATION_MARKER}\n${body}`;

  if (existingComments.length > 0) {
    await githubRequest(existingComments[0].url, 'PATCH', { body: finalBody });

    for (let i = 1; i < existingComments.length; i += 1) {
      await githubRequest(existingComments[i].url, 'DELETE');
    }

    return;
  }

  await githubRequest(commentsUrl, 'POST', { body: finalBody });
}

async function addLabels(issueUrl, labels) {
  await githubRequest(`${issueUrl}/labels`, 'POST', { labels });
}

async function removeLabel(issueUrl, label) {
  const token = process.env.GITHUB_TOKEN;

  if (!isNonEmptyString(token)) {
    fail('Missing GITHUB_TOKEN');
  }

  const response = await fetch(`${issueUrl}/labels/${encodeURIComponent(label)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'eDock-App-Submission-Validator'
    }
  });

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    const text = await response.text();
    fail(`Failed to remove label "${label}": ${response.status} ${response.statusText} - ${text}`);
  }
}

async function closeIssue(issueUrl) {
  await githubRequest(issueUrl, 'PATCH', {
    state: 'closed',
    state_reason: 'completed'
  });
}

function issueHasLabel(issue, labelName) {
  if (!Array.isArray(issue.labels)) {
    return false;
  }

  return issue.labels.some(label => {
    if (typeof label === 'string') {
      return label === labelName;
    }

    return label && label.name === labelName;
  });
}

async function markInvalid(issue, message) {
  await removeLabel(issue.url, 'submission-valid');
  await removeLabel(issue.url, 'submission-duplicate');
  await addLabels(issue.url, ['submission-invalid']);
  await replaceBotComment(
    issue.comments_url,
    [
      'Validation failed.',
      '',
      message,
      '',
      'Please fix the manifest and edit the issue.'
    ].join('\n')
  );
}

async function markValid(issue, manifest, manifestUrl) {
  await removeLabel(issue.url, 'submission-invalid');
  await removeLabel(issue.url, 'submission-duplicate');
  await addLabels(issue.url, ['submission-valid']);
  await replaceBotComment(
    issue.comments_url,
    [
      'Validation passed.',
      '',
      `App ID: \`${manifest.id}\``,
      `Title: \`${manifest.title}\``,
      `Version: \`${manifest.version}\``,
      `Manifest: ${manifestUrl}`,
      '',
      'This submission is ready for human review before being added to the pre-reviewed source list.'
    ].join('\n')
  );
}

async function markDuplicateAndClose(issue, manifestUrl, existingFile) {
  await removeLabel(issue.url, 'submission-valid');
  await removeLabel(issue.url, 'submission-invalid');
  await addLabels(issue.url, ['submission-duplicate']);
  await replaceBotComment(
    issue.comments_url,
    [
      'Submission already exists.',
      '',
      `Manifest: ${manifestUrl}`,
      `Already found in: \`${existingFile}\``,
      '',
      'This issue will be closed automatically.'
    ].join('\n')
  );
  await closeIssue(issue.url);
}

async function markDuplicateIdAndClose(issue, manifest, existingAppId) {
  await removeLabel(issue.url, 'submission-valid');
  await removeLabel(issue.url, 'submission-invalid');
  await addLabels(issue.url, ['submission-duplicate']);
  await replaceBotComment(
    issue.comments_url,
    [
      'Duplicate app id.',
      '',
      `App ID: \`${manifest.id}\``,
      `Already found in: \`${existingAppId.filePath}\``,
      existingAppId.manifest ? `Existing manifest: ${existingAppId.manifest}` : '',
      '',
      'Every app must have a unique id.',
      'This issue will be closed automatically.'
    ].filter(Boolean).join('\n')
  );
  await closeIssue(issue.url);
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!isNonEmptyString(eventPath)) {
    fail('Missing GITHUB_EVENT_PATH');
  }

  const rawEvent = await fs.readFile(eventPath, 'utf8');
  const event = JSON.parse(rawEvent);
  const issue = event.issue;

  if (!issue) {
    console.log('No issue found in event payload');
    return;
  }

  if (!issueHasLabel(issue, 'app-submission')) {
    console.log('Issue does not have app-submission label');
    return;
  }

  if (event.action === 'closed') {
    console.log('Issue is closed');
    return;
  }

  const manifestUrl = extractManifestUrlFromIssueBody(issue.body || '');

  if (!manifestUrl) {
    await markInvalid(
      issue,
      [
        'Could not find a manifest URL in the issue body.',
        '',
        'Please include a direct `.json` manifest URL in the issue.'
      ].join('\n')
    );
    fail('No manifest URL found in issue body');
  }

  const existingFile = await findExistingManifest(manifestUrl);

  if (existingFile) {
    await markDuplicateAndClose(issue, manifestUrl, existingFile);
    console.log(`Duplicate submission closed: ${manifestUrl} already exists in ${existingFile}`);
    return;
  }

  try {
    const manifest = await fetchJson(manifestUrl);
    validateManifest(manifest, manifestUrl);

    const existingAppId = await findExistingAppId(manifest.id);

    if (existingAppId) {
      await markDuplicateIdAndClose(issue, manifest, existingAppId);
      console.log(`Duplicate submission closed: app id ${manifest.id} already exists in ${existingAppId.filePath}`);
      return;
    }

    await markValid(issue, manifest, manifestUrl);
    console.log(`Validation passed for ${manifest.id}`);
  } catch (error) {
    await markInvalid(issue, error.message);
    throw error;
  }
}

await main();
