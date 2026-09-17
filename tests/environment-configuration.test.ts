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

  it('keeps the generated skill table in parity with canonical metadata', () => {
    const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
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

    expect(skill).toContain(generatedSection);
  });
});
