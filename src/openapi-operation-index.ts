type OpenApiOperation = {
  operationId?: unknown;
  summary?: unknown;
  description?: unknown;
  tags?: unknown;
};

type IndexedOperation = {
  method: string;
  path: string;
  operation: OpenApiOperation;
};

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOperations(spec: Record<string, unknown>): IndexedOperation[] {
  const paths = isRecord(spec.paths) ? spec.paths : {};
  const operations: IndexedOperation[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;

    for (const [method, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(value)) continue;
      operations.push({ method: method.toUpperCase(), path, operation: value });
    }
  }

  return operations;
}

/** Render a dependency-free local index of operations from the served OpenAPI document. */
export function renderOpenApiOperationIndex(spec: Record<string, unknown>): string {
  const info = isRecord(spec.info) ? spec.info : {};
  const title = asText(info.title) || 'Kaseki API';
  const description = asText(info.description);
  const operations = getOperations(spec);
  const groups = new Map<string, IndexedOperation[]>();

  for (const entry of operations) {
    const tags = Array.isArray(entry.operation.tags) ? entry.operation.tags : [];
    const group = tags.map(asText).find((tag): tag is string => tag !== undefined) || 'Other';
    const entries = groups.get(group) || [];
    entries.push(entry);
    groups.set(group, entries);
  }

  const declaredTags = Array.isArray(spec.tags)
    ? spec.tags
      .filter(isRecord)
      .map((tag) => asText(tag.name))
      .filter((name): name is string => name !== undefined)
    : [];
  const groupNames = [
    ...declaredTags.filter((name) => groups.has(name)),
    ...Array.from(groups.keys()).filter((name) => !declaredTags.includes(name)).sort(),
  ];

  const sections = groupNames.map((group, index) => {
    const entries = groups.get(group) || [];
    const sectionId = `operation-group-${index}`;
    const items = entries.map(({ method, path, operation }) => {
      const summary = asText(operation.summary) || asText(operation.operationId) || 'API operation';
      const operationId = asText(operation.operationId);
      const operationDescription = asText(operation.description);
      return `<li class="operation">
        <div class="operation-heading"><span class="method method-${method.toLowerCase()}">${method}</span><code>${escapeHtml(path)}</code></div>
        <h3>${escapeHtml(summary)}</h3>
        ${operationDescription ? `<p>${escapeHtml(operationDescription)}</p>` : ''}
        ${operationId ? `<small>${escapeHtml(operationId)}</small>` : ''}
      </li>`;
    }).join('\n');

    return `<section aria-labelledby="${sectionId}">
      <h2 id="${sectionId}">${escapeHtml(group)}</h2>
      <ul>${items}</ul>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} operations</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
    body { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    header { border-bottom: 1px solid #8886; margin-bottom: 2rem; padding-bottom: 1rem; }
    h1 { margin-bottom: .25rem; }
    h2 { margin-top: 2.5rem; border-bottom: 1px solid #8886; padding-bottom: .4rem; }
    ul { list-style: none; margin: 0; padding: 0; }
    .operation { border: 1px solid #8886; border-radius: .5rem; margin: 1rem 0; padding: 1rem; }
    .operation-heading { align-items: center; display: flex; flex-wrap: wrap; gap: .75rem; }
    .operation-heading code { font-size: 1rem; overflow-wrap: anywhere; }
    .method { border-radius: .25rem; color: #fff; font-size: .75rem; font-weight: 700; min-width: 4.5rem; padding: .15rem .4rem; text-align: center; }
    .method-get { background: #087443; } .method-post { background: #1761a0; }
    .method-put, .method-patch { background: #805b00; } .method-delete { background: #a02b2b; }
    .method-options, .method-head, .method-trace { background: #555; }
    .operation h3 { font-size: 1.05rem; margin: .75rem 0 .25rem; }
    .operation p { margin: .25rem 0 .5rem; }
    .operation small { opacity: .75; }
    a { color: inherit; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    <p>${operations.length} operations · <a href="/api/v1/openapi.json">OpenAPI 3.1 JSON</a></p>
  </header>
  <main>${sections || '<p>No API operations are available.</p>'}</main>
</body>
</html>`;
}
