export const IMAGE_DEPENDENCY_RULES = {
  'brace-expansion': {
    1: { fixedVersion: '1.1.21', sourceDirectory: 'brace-expansion-v1' },
    2: { fixedVersion: '2.1.7', sourceDirectory: 'brace-expansion-v2' },
    // Trivy's first fixed release is 5.0.7; there is no compatible 3.x or 4.x source.
    3: { fixedVersion: '5.0.7', noSameMajorFix: true },
    4: { fixedVersion: '5.0.7', noSameMajorFix: true },
    5: { fixedVersion: '5.0.12', sourceDirectory: 'brace-expansion' },
  },
  handlebars: {
    4: { fixedVersion: '4.7.10' },
  },
  undici: {
    6: { fixedVersion: '6.29.1', sourceDirectory: 'undici-v6' },
    7: { fixedVersion: '7.30.1', sourceDirectory: 'undici-v7' },
    8: { fixedVersion: '8.12.3', sourceDirectory: 'undici' },
  },
};

export function dependencyRule(packageName, major) {
  return IMAGE_DEPENDENCY_RULES[packageName]?.[major];
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version ?? '');
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? null,
  };
}

export function compareVersions(left, right) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  for (let index = 0; index < parsedLeft.numbers.length; index += 1) {
    if (parsedLeft.numbers[index] !== parsedRight.numbers[index]) {
      return parsedLeft.numbers[index] < parsedRight.numbers[index] ? -1 : 1;
    }
  }
  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (parsedLeft.prerelease === null) return 1;
  if (parsedRight.prerelease === null) return -1;
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}
