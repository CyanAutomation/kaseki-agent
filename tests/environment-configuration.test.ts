import * as fs from 'fs';
import * as path from 'path';

type PublicEnvironmentVariable = {
  name: string;
  description: string;
  default: string;
  acceptedValues: string;
};

describe('Environment configuration documentation parity', () => {
  const skillDir = path.join(
    process.cwd(),
    '.agents/skills/environment-configuration',
  );
  const metadata = JSON.parse(
    fs.readFileSync(path.join(skillDir, 'environment-variables.json'), 'utf8'),
  ) as PublicEnvironmentVariable[];

  it('provides complete metadata for every public variable', () => {
    expect(metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'KASEKI_CAVEMAN' }),
    ]));
    expect(new Set(metadata.map(({ name }) => name)).size).toBe(metadata.length);

    metadata.forEach((variable) => {
      expect(variable.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(variable.description.trim()).not.toBe('');
      expect(variable.default.trim()).not.toBe('');
      expect(variable.acceptedValues.trim()).not.toBe('');
    });
  });

  it('keeps the generated public-variable catalog in parity with canonical metadata', () => {
    const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const catalogPath = path.join(skillDir, 'PUBLIC_ENVIRONMENT_VARIABLES.md');
    expect(fs.existsSync(catalogPath)).toBe(true);
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    const generatedRows = metadata.map((variable) =>
      `| \`${variable.name}\` | \`${variable.default}\` | ${variable.description} | ${variable.acceptedValues} |`,
    );
    const generatedSection = [
      '<!-- BEGIN GENERATED PUBLIC ENVIRONMENT VARIABLES -->',
      '| Variable | Default | Description | Accepted values |',
      '|---|---|---|---|',
      ...generatedRows,
      '<!-- END GENERATED PUBLIC ENVIRONMENT VARIABLES -->',
    ].join('\n');

    expect(catalog).toContain(generatedSection);
    expect(skill).toContain('[generated public-variable catalog](PUBLIC_ENVIRONMENT_VARIABLES.md)');
    expect(skill).not.toMatch(/<!-- BEGIN GENERATED PUBLIC ENVIRONMENT VARIABLES -->/);
  });

  it('keeps environment setup guidance focused and concise', () => {
    const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skill.split('\n').length).toBeLessThanOrEqual(140);
  });

  it('does not present ignored provider fallback names as supported configuration', () => {
    const docs = fs.readFileSync(path.join(process.cwd(), 'docs/ENV_VARS.md'), 'utf8');
    const modelSelection = docs.split('### Model Selection')[1]?.split('### Multi-Phase Model Overrides')[0] ?? '';
    const activeModelRows = modelSelection.split('\n').filter((line) => line.startsWith('|')).join('\n');
    expect(activeModelRows.includes('KASEKI_PROVIDER_FALLBACK')).toBe(false);
    expect(docs.includes('### Retired provider fallback settings')).toBe(true);
    expect(docs.includes('KASEKI_PROVIDER_FALLBACK_MODEL')).toBe(true);
  });

  it('documents that API key scopes are not a supported setting', () => {
    const docs = fs.readFileSync(path.join(process.cwd(), 'docs/ENV_VARS.md'), 'utf8');
    expect(docs.includes('API keys currently have equal access')).toBe(true);
    expect(docs.includes('is not supported and does not restrict a key')).toBe(true);
  });
});
