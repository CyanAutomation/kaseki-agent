export interface RunEvaluationWarning {
  code?: string;
  message: string;
  stage?: string;
}

export interface RunEvaluationStageValue {
  key: string;
  label?: string;
  value?: string | number | boolean | null;
  score?: number | null;
  reasoning?: string;
}

export interface RunEvaluationInput {
  overall_assessment?: string;
  reviewer_confidence?: string | number | null;
  evaluated_at?: string | number | Date | null;
  stage_value?: RunEvaluationStageValue[];
  warnings?: RunEvaluationWarning[];
  strengths?: string[];
  improvements?: string[];
  recommendations?: string[];
}

export interface ReportItem {
  label: string;
  value: string;
}

export interface ReportSection {
  key: string;
  title: string;
  items: ReportItem[];
}

export interface FormattedRunEvaluationReport {
  generatedAtUtc: string | null;
  sections: ReportSection[];
}

function upperFirst(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function normalizeLabel(value: string): string {
  const normalized = value.trim().replace(/[\s_-]+/g, ' ').toLowerCase();
  if (!normalized) return '';
  return normalized
    .split(' ')
    .map((part) => upperFirst(part))
    .join(' ');
}

export function hasItems<T>(value?: T[] | null): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

export function formatUtcTimestamp(input?: string | number | Date | null): string | null {
  if (input === null || input === undefined || input === '') return null;

  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  return String(value);
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  return normalizeLabel(value);
}

export function formatRunEvaluation(input: RunEvaluationInput): FormattedRunEvaluationReport {
  const sections: ReportSection[] = [];

  sections.push({
    key: 'summary',
    title: 'Summary',
    items: [
      { label: 'Overall assessment', value: asText(normalizeOptionalText(input.overall_assessment)) },
      {
        label: 'Reviewer confidence',
        value: asText(typeof input.reviewer_confidence === 'string' ? normalizeOptionalText(input.reviewer_confidence) : input.reviewer_confidence),
      },
    ],
  });

  if (hasItems(input.stage_value)) {
    sections.push({
      key: 'stage-values',
      title: 'Stage values',
      items: input.stage_value.map((stage) => ({
        label: stage.label ? normalizeLabel(stage.label) : normalizeLabel(stage.key),
        value: [
          stage.value !== undefined ? `Value: ${asText(stage.value)}` : null,
          stage.score !== undefined && stage.score !== null ? `Score: ${stage.score}` : null,
          stage.reasoning ? `Reasoning: ${stage.reasoning}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
      })),
    });
  }

  if (hasItems(input.warnings)) {
    sections.push({
      key: 'warnings',
      title: 'Warnings',
      items: input.warnings.map((warning, idx) => ({
        label: warning.code ?? `Warning ${idx + 1}`,
        value: [warning.stage ? `Stage: ${normalizeLabel(warning.stage)}` : null, warning.message].filter(Boolean).join(' | '),
      })),
    });
  }

  const listSections: Array<{ key: string; title: string; values?: string[] }> = [
    { key: 'strengths', title: 'Strengths', values: input.strengths },
    { key: 'improvements', title: 'Improvements', values: input.improvements },
    { key: 'recommendations', title: 'Recommendations', values: input.recommendations },
  ];

  for (const section of listSections) {
    if (!hasItems(section.values)) continue;
    sections.push({
      key: section.key,
      title: section.title,
      items: section.values.map((value, idx) => ({ label: `${idx + 1}.`, value })),
    });
  }

  return {
    generatedAtUtc: formatUtcTimestamp(input.evaluated_at),
    sections,
  };
}

export function serializeRunEvaluationMarkdown(report: FormattedRunEvaluationReport): string {
  const lines: string[] = [];

  if (report.generatedAtUtc) {
    lines.push(`_Evaluated at: ${report.generatedAtUtc}_`, '');
  }

  for (const section of report.sections) {
    if (!hasItems(section.items)) continue;
    lines.push(`## ${section.title}`);
    for (const item of section.items) {
      lines.push(`- **${item.label}:** ${item.value}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
