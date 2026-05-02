import fs from 'fs';
import os from 'os';
import path from 'path';
import { readInstanceMetadata } from './instance-metadata-reader';

describe('instance-metadata-reader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should read metadata.json and host-start.json', () => {
    const metadata = {
      current_stage: 'validation',
      exit_code: 0,
      duration_seconds: 120,
      model: 'claude-3-opus',
    };

    const hostStart = {
      model: 'claude-3-opus',
      repo_url: 'https://github.com/example/repo',
      git_ref: 'main',
      agentTimeoutSeconds: 1200,
    };

    fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(tempDir, 'host-start.json'), JSON.stringify(hostStart));

    const result = readInstanceMetadata(tempDir);

    expect(result.metadata).toEqual(metadata);
    expect(result.hostStart).toEqual(hostStart);
    expect(result.elapsedSeconds).toBe(120);
  });

  it('should return empty objects when files do not exist', () => {
    const result = readInstanceMetadata(tempDir);

    expect(result.metadata).toEqual({});
    expect(result.hostStart).toEqual({});
    expect(result.elapsedSeconds).toBeNull();
  });

  it('should handle corrupt JSON in metadata.json gracefully', () => {
    fs.writeFileSync(path.join(tempDir, 'metadata.json'), '{invalid json');

    const result = readInstanceMetadata(tempDir);

    expect(result.metadata).toEqual({});
  });

  it('should handle corrupt JSON in host-start.json gracefully', () => {
    fs.writeFileSync(path.join(tempDir, 'host-start.json'), '{invalid json');

    const result = readInstanceMetadata(tempDir);

    expect(result.hostStart).toEqual({});
  });

  it('should read elapsed_seconds from resource.time when metadata.duration_seconds is missing', () => {
    const metadata = { current_stage: 'completed' };
    fs.writeFileSync(
      path.join(tempDir, 'metadata.json'),
      JSON.stringify(metadata)
    );
    fs.writeFileSync(
      path.join(tempDir, 'resource.time'),
      'user_cpu=1.234\nelapsed_seconds=90\nsystem_cpu=0.456'
    );

    const result = readInstanceMetadata(tempDir);

    expect(result.elapsedSeconds).toBe(90);
  });

  it('should prefer metadata.duration_seconds over resource.time', () => {
    const metadata = { current_stage: 'completed', duration_seconds: 120 };
    fs.writeFileSync(
      path.join(tempDir, 'metadata.json'),
      JSON.stringify(metadata)
    );
    fs.writeFileSync(
      path.join(tempDir, 'resource.time'),
      'elapsed_seconds=90'
    );

    const result = readInstanceMetadata(tempDir);

    expect(result.elapsedSeconds).toBe(120);
  });

  it('should handle malformed resource.time gracefully', () => {
    const metadata = { current_stage: 'completed' };
    fs.writeFileSync(
      path.join(tempDir, 'metadata.json'),
      JSON.stringify(metadata)
    );
    fs.writeFileSync(path.join(tempDir, 'resource.time'), 'malformed_content');

    const result = readInstanceMetadata(tempDir);

    expect(result.elapsedSeconds).toBeNull();
  });

  it('should return null for elapsedSeconds when neither source has valid data', () => {
    const metadata = { current_stage: 'pending' };
    fs.writeFileSync(
      path.join(tempDir, 'metadata.json'),
      JSON.stringify(metadata)
    );

    const result = readInstanceMetadata(tempDir);

    expect(result.elapsedSeconds).toBeNull();
  });

  it('should preserve all metadata fields', () => {
    const metadata = {
      current_stage: 'validation',
      exit_code: 1,
      duration_seconds: 120,
      started_at: '2024-01-01T10:00:00Z',
      model: 'gpt-4',
      pi_duration_seconds: 60,
      custom_field: 'custom_value',
    };

    fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata));

    const result = readInstanceMetadata(tempDir);

    expect(result.metadata).toEqual(metadata);
    expect(result.metadata.custom_field).toBe('custom_value');
  });

  it('should propagate ENOENT errors when reading metadata.json', () => {
    const metadataPath = path.join(tempDir, 'metadata.json');
    
    // Create file, then delete it during read simulation
    fs.writeFileSync(metadataPath, '{}');
    
    // Override readFileSync to throw ENOENT
    const originalReadFileSync = fs.readFileSync;
    let readCallCount = 0;
    fs.readFileSync = jest.fn((filePath: any, ...args: any[]) => {
      readCallCount++;
      if (readCallCount === 1 && filePath === metadataPath) {
        const error = new Error('File not found') as any;
        error.code = 'ENOENT';
        throw error;
      }
      return originalReadFileSync(filePath, ...args);
    });

    try {
      expect(() => readInstanceMetadata(tempDir)).toThrow();
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
  });

  it('should propagate ESTALE errors when reading host-start.json', () => {
    const hostStartPath = path.join(tempDir, 'host-start.json');
    fs.writeFileSync(hostStartPath, '{}');

    const originalReadFileSync = fs.readFileSync;
    let readCallCount = 0;
    fs.readFileSync = jest.fn((filePath: any, ...args: any[]) => {
      readCallCount++;
      if (readCallCount === 1 && filePath === hostStartPath) {
        const error = new Error('Stale NFS file handle') as any;
        error.code = 'ESTALE';
        throw error;
      }
      return originalReadFileSync(filePath, ...args);
    });

    try {
      expect(() => readInstanceMetadata(tempDir)).toThrow();
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
  });
});
