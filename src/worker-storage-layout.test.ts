import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');

const STORAGE_LAYOUT_CONTRACT = {
  // Contract: high-volume Pi raw event streams must avoid the bounded worker
  // /tmp tmpfs, and npm/Pi mutable state must live on the persistent /cache
  // mount so container restarts do not drop expensive runtime caches.
  codingRawEvents: '${KASEKI_RESULTS_DIR}/pi-events.raw.jsonl',
  persistentCacheMount: '/cache',
  dockerCacheVolumeTarget: '/cache',
  npmCache: '/cache/npm-cache',
  piCodingAgentDir: '/cache/pi-agent',
} as const;

type DockerEnvAndVolumes = {
  env: Map<string, string>;
  volumes: Array<{ source: string; target: string; mode: string }>;
};

const readRepoFile = (path: string): string =>
  readFileSync(join(repoRoot, path), 'utf8');

const parseShellAssignments = (script: string): Map<string, string> => {
  const assignments = new Map<string, string>();
  const assignmentPattern = /^([A-Z][A-Z0-9_]*)=(['"])(.*?)\2$/gm;
  let match: RegExpExecArray | null;

  while ((match = assignmentPattern.exec(script)) !== null) {
    assignments.set(match[1], match[3]);
  }

  return assignments;
};

const parseDockerEnvAndVolumes = (script: string): DockerEnvAndVolumes => {
  const dockerArgsStart = script.indexOf('docker_args=(\n');
  if (dockerArgsStart < 0) {
    throw new Error('docker_args=( not found in script');
  }

  const dockerArgsBody = script
    .slice(dockerArgsStart + 'docker_args=(\n'.length)
    .split('\n)')[0];
  const lines = dockerArgsBody.split('\n');
  const env = new Map<string, string>();
  const volumes: DockerEnvAndVolumes['volumes'] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const token = lines[index].trim();
    const nextToken = lines[index + 1]?.trim() ?? '';
    const envToken = token === '-e' ? nextToken : token.replace(/^-e\s+/, '');
    const volumeToken = token === '-v' ? nextToken : token.replace(/^-v\s+/, '');

    if (token === '-e' || token.startsWith('-e ')) {
      const envMatch = envToken.match(/^([A-Za-z_][A-Za-z0-9_]*)=(['"])(.*?)\2$/);
      if (envMatch) {
        env.set(envMatch[1], envMatch[3]);
      }
    }

    if (token === '-v' || token.startsWith('-v ')) {
      const volumeMatch = volumeToken.match(/^(['"])(.*?):(.*?):(.*?)\1$/);
      if (volumeMatch) {
        volumes.push({
          source: volumeMatch[2],
          target: volumeMatch[3],
          mode: volumeMatch[4],
        });
      }
    }
  }

  return { env, volumes };
};

describe('worker storage layout contract', () => {
  const agentScript = readRepoFile('kaseki-agent.sh');
  const launcherScript = readRepoFile('run-kaseki.sh');

  it('keeps the coding raw event stream on the results mount instead of bounded /tmp', () => {
    const assignments = parseShellAssignments(agentScript);
    const rawEventsPath = assignments.get('RAW_EVENTS');

    expect(rawEventsPath).toBe(STORAGE_LAYOUT_CONTRACT.codingRawEvents);
    expect(rawEventsPath).toContain('${KASEKI_RESULTS_DIR}/');
    expect(rawEventsPath).not.toMatch(/^\/tmp(?:\/|$)/);
  });

  it('places high-volume npm and Pi state on the persistent cache mount', () => {
    const { env, volumes } = parseDockerEnvAndVolumes(launcherScript);
    const cacheVolume = volumes.find(
      (volume) => volume.target === STORAGE_LAYOUT_CONTRACT.dockerCacheVolumeTarget,
    );

    expect(env.get('NPM_CONFIG_CACHE')).toBe(STORAGE_LAYOUT_CONTRACT.npmCache);
    expect(env.get('npm_config_cache')).toBe(STORAGE_LAYOUT_CONTRACT.npmCache);
    expect(env.get('PI_CODING_AGENT_DIR')).toBe(
      STORAGE_LAYOUT_CONTRACT.piCodingAgentDir,
    );
    expect(cacheVolume).toEqual({
      source: '$CACHE',
      target: STORAGE_LAYOUT_CONTRACT.persistentCacheMount,
      mode: 'rw',
    });
  });
});
