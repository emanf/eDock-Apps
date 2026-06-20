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

function fail(message) {
  throw new Error(message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

  if (manifest.manifest !== manifestUrl) {
    fail('Field "manifest" must exactly match the submitted manifest URL');
  }

  if (manifest.icon.startsWith('m:')) {
    return;
  }

  if (!isValidHttpsUrl(manifest.icon)) {
    fail('Field "icon" must be a valid HTTPS URL or a material icon like "m:palette"');
  }
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

async function listLabels(commentsUrl) {
  const response = await githubRequest(commentsUrl.replace('/comments', ''), 'GET');
  return Array.isArray(response.labels) ? response.labels.map(label => label.name) : [];
}

async function replaceBotComment(commentsUrl, body) {
  const comments = await githubRequest(commentsUrl, 'GET');
  const marker = '<!-- edock-app-submission-validation -->';
  const existing = Array.isArray(comments)
    ? comments.find(comment => typeof comment.body === 'string' && comment.body.includes(marker))
    : null;

  const finalBody = `${marker}\n${body}`;

  if (existing) {
    await githubRequest(existing.url, 'PATCH', { body: finalBody });
    return;
  }

  await githubRequest(commentsUrl, 'POST', { body: finalBody });
}

async function addLabels(issueUrl, labels) {
  await githubRequest(`${issueUrl}/labels`, 'POST', { labels });
}

async function removeLabel(issueUrl, label) {
  const token = process.env.GITHUB_TOKEN;

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

  const manifestUrl = extractManifestUrlFromIssueBody(issue.body || '');

  if (!manifestUrl) {
    await removeLabel(issue.url, 'submission-valid');
    await addLabels(issue.url, ['submission-invalid']);
    await replaceBotComment(
      issue.comments_url,
      [
        'Validation failed.',
        '',
        'Could not find a manifest URL in the issue body.',
        '',
        'Please include a direct `.json` manifest URL in the issue.'
      ].join('\n')
    );
    fail('No manifest URL found in issue body');
  }

  try {
    const manifest = await fetchJson(manifestUrl);
    validateManifest(manifest, manifestUrl);

    await removeLabel(issue.url, 'submission-invalid');
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

    console.log(`Validation passed for ${manifest.id}`);
  } catch (error) {
    await removeLabel(issue.url, 'submission-valid');
    await addLabels(issue.url, ['submission-invalid']);
    await replaceBotComment(
      issue.comments_url,
      [
        'Validation failed.',
        '',
        `${error.message}`,
        '',
        'Please fix the manifest and edit the issue.'
      ].join('\n')
    );
    throw error;
  }
}

await main();
