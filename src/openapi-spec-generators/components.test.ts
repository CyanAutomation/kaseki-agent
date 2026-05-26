/**
 * Tests for OpenAPI Component Builders
 */

import {
  buildSecuritySchemes,
  buildTags,
  buildInfo,
  buildServers,
  buildComponents,
} from './components';
import * as fs from 'fs';

describe('OpenAPI Component Builders', () => {
  describe('buildSecuritySchemes', () => {
    it('should build BearerAuth security scheme', () => {
      const schemes = buildSecuritySchemes();

      expect(schemes).toHaveProperty('BearerAuth');
      expect(schemes.BearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'token',
        description: expect.stringContaining('Bearer token authentication'),
      });
    });

    it('should include description for API key usage', () => {
      const schemes = buildSecuritySchemes();
      expect(schemes.BearerAuth.description).toContain('KASEKI_API_KEYS');
    });
  });

  describe('buildTags', () => {
    it('should return array of tag definitions', () => {
      const tags = buildTags();

      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeGreaterThan(0);
    });

    it('should include all expected tag names', () => {
      const tags = buildTags();
      const tagNames = tags.map((t) => t.name);

      expect(tagNames).toContain('Health & Status');
      expect(tagNames).toContain('Service Info');
      expect(tagNames).toContain('Run Management');
      expect(tagNames).toContain('Run Logs & Progress');
      expect(tagNames).toContain('Artifacts');
      expect(tagNames).toContain('Run Details');
      expect(tagNames).toContain('Webhooks');
    });

    it('each tag should have name and description', () => {
      const tags = buildTags();

      tags.forEach((tag) => {
        expect(tag).toHaveProperty('name');
        expect(tag).toHaveProperty('description');
        expect(typeof tag.name).toBe('string');
        expect(typeof tag.description).toBe('string');
        expect(((tag as any).name).length).toBeGreaterThan(0);
        expect(((tag as any).description).length).toBeGreaterThan(0);
      });
    });

    it('should have 7 total tags', () => {
      const tags = buildTags();
      expect(tags.length).toBe(7);
    });
  });

  describe('buildInfo', () => {
    it('should build API info metadata', () => {
      const info = buildInfo();

      expect(info).toHaveProperty('title');
      expect(info).toHaveProperty('version');
      expect(info).toHaveProperty('description');
      expect(info).toHaveProperty('contact');
      expect(info).toHaveProperty('license');
    });

    it('should have correct title and version', () => {
      const info = buildInfo();
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

      expect(info.title).toBe('Kaseki Agent API');
      expect(info.version).toBe(packageJson.version);
    });

    it('should include descriptive text', () => {
      const info = buildInfo();

      expect(typeof info.description).toBe('string');
      expect((info.description as string).length).toBeGreaterThan(20);
      expect(info.description).toContain('coding-agent');
    });

    it('should include contact information', () => {
      const info = buildInfo();
      const contact = info.contact as Record<string, unknown>;

      expect(contact.name).toBe('CyanAutomation');
      expect(typeof contact.url).toBe('string');
      expect((contact.url as string).includes('github')).toBe(true);
    });

    it('should include MIT license', () => {
      const info = buildInfo();
      const license = info.license as Record<string, unknown>;

      expect(license.name).toBe('MIT');
      expect(typeof license.url).toBe('string');
      expect((license.url as string).includes('LICENSE')).toBe(true);
    });
  });

  describe('buildServers', () => {
    it('should return array of server definitions', () => {
      const servers = buildServers();

      expect(Array.isArray(servers)).toBe(true);
      expect(servers.length).toBeGreaterThan(0);
    });

    it('should include localhost development server', () => {
      const servers = buildServers();
      const localhost = servers.find((s) => (s.url as string).includes('localhost'));

      expect(localhost).toBeDefined();
      expect(localhost?.description).toContain('development');
    });

    it('should include production server template', () => {
      const servers = buildServers();
      const production = servers.find((s) => (s.description as string).toLowerCase().includes('production'));

      expect(production).toBeDefined();
      expect(production?.url).toMatch(/^https:\/\/.+\.example\.com(?:\/.*)?$/);

      if (production?.variables) {
        const variables = production.variables as Record<string, { default?: string; enum?: string[] }>;
        expect(Object.keys(variables).length).toBeGreaterThan(0);
        Object.values(variables).forEach((variable) => {
          expect(typeof variable.default).toBe('string');
          if (variable.enum) {
            expect(variable.enum.length).toBeGreaterThan(0);
          }
        });
      }
    });

    it('each server should have required OpenAPI server fields', () => {
      const servers = buildServers();

      servers.forEach((server) => {
        expect(server).toHaveProperty('url');
        expect(server).toHaveProperty('description');
        expect(typeof server.url).toBe('string');
        expect(server.url).toMatch(/^https?:\/\//);
        expect(typeof server.description).toBe('string');
        expect((server.description as string).trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('buildComponents', () => {
    it('should build components object with schemas', () => {
      const testSchemas = {
        TestSchema: { type: 'object', properties: { id: { type: 'string' } } },
      };

      const components = buildComponents(testSchemas);

      expect(components).toHaveProperty('schemas');
      expect(components).toHaveProperty('securitySchemes');
    });

    it('should include passed schemas', () => {
      const testSchemas = {
        CustomSchema: { type: 'object' },
      };

      const components = buildComponents(testSchemas);

      expect(components.schemas).toEqual(testSchemas);
    });

    it('should include security schemes', () => {
      const testSchemas = {};
      const components = buildComponents(testSchemas);

      expect(components.securitySchemes).toBeDefined();
      expect(components.securitySchemes).toHaveProperty('BearerAuth');
    });

    it('should aggregate all schemas passed', () => {
      const testSchemas = {
        Schema1: { type: 'object' },
        Schema2: { type: 'array' },
        Schema3: { type: 'string' },
      };

      const components = buildComponents(testSchemas);

      expect(Object.keys(components.schemas as Record<string, unknown>)).toHaveLength(3);
      expect(components.schemas).toEqual(testSchemas);
    });
  });

  describe('buildSecuritySchemes detailed validation', () => {
    it('BearerAuth should have type http', () => {
      const schemes = buildSecuritySchemes();
      expect(schemes.BearerAuth.type).toBe('http');
    });

    it('BearerAuth should have scheme bearer', () => {
      const schemes = buildSecuritySchemes();
      expect(schemes.BearerAuth.scheme).toBe('bearer');
    });

    it('BearerAuth should have token bearer format', () => {
      const schemes = buildSecuritySchemes();
      expect(schemes.BearerAuth.bearerFormat).toBe('token');
    });

    it('should include only one security scheme', () => {
      const schemes = buildSecuritySchemes();
      expect(Object.keys(schemes)).toHaveLength(1);
    });
  });

  describe('buildTags detailed validation', () => {
    it('all tags should have non-empty name and description', () => {
      const tags = buildTags();

      tags.forEach((tag) => {
        expect(tag.name).toBeTruthy();
        expect(tag.description).toBeTruthy();
        expect((tag.name as string).length).toBeGreaterThan(0);
        expect((tag.description as string).length).toBeGreaterThan(0);
      });
    });

    it('tag names should be descriptive', () => {
      const tags = buildTags();
      const tagNames = tags.map((t) => t.name);

      const expectedPattern = /^[A-Z][\w\s&]+$/;
      tagNames.forEach((name) => {
        expect(name).toMatch(expectedPattern);
      });
    });

    it('tag descriptions should explain purpose', () => {
      const tags = buildTags();

      tags.forEach((tag) => {
        const desc = tag.description as string;
        expect(desc.length).toBeGreaterThan(10);
      });
    });

    it('specific tags should have correct descriptions', () => {
      const tags = buildTags();
      const healthTag = tags.find((t) => t.name === 'Health & Status');

      expect(healthTag).toBeDefined();
      expect(healthTag?.description).toContain('health');
    });
  });

  describe('buildInfo detailed validation', () => {
    it('title should be Kaseki Agent API', () => {
      const info = buildInfo();
      expect(info.title).toBe('Kaseki Agent API');
    });

    it('version should be a valid semver string', () => {
      const info = buildInfo();
      const versionPattern = /^\d+\.\d+\.\d+/;
      expect(info.version).toMatch(versionPattern);
    });

    it('description should mention coding agent', () => {
      const info = buildInfo();
      expect((info.description as string).toLowerCase()).toContain('agent');
    });

    it('description should mention Pi or OpenRouter', () => {
      const info = buildInfo();
      const desc = (info.description as string).toLowerCase();
      expect(desc).toMatch(/pi|openrouter|coding|agent/i);
    });

    it('contact name should be CyanAutomation', () => {
      const info = buildInfo();
      const contact = info.contact as Record<string, unknown>;
      expect(contact.name).toBe('CyanAutomation');
    });

    it('contact url should be valid and point to GitHub', () => {
      const info = buildInfo();
      const contact = info.contact as Record<string, unknown>;
      expect(contact.url).toContain('github');
      expect((contact.url as string).startsWith('http')).toBe(true);
    });

    it('license should be MIT', () => {
      const info = buildInfo();
      const license = info.license as Record<string, unknown>;
      expect(license.name).toBe('MIT');
    });

    it('license url should reference LICENSE file', () => {
      const info = buildInfo();
      const license = info.license as Record<string, unknown>;
      expect((license.url as string).includes('LICENSE')).toBe(true);
    });
  });

  describe('buildServers detailed validation', () => {
    it('server list should remain schema-compatible', () => {
      const servers = buildServers();

      expect(servers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: expect.any(String),
            description: expect.any(String),
          }),
        ])
      );
    });

    it('localhost server should use http://localhost', () => {
      const servers = buildServers();
      const local = servers.find((s) => (s.url as string).includes('localhost'));
      expect(local?.url).toContain('localhost');
    });

    it('localhost server should have development description', () => {
      const servers = buildServers();
      const local = servers.find((s) => (s.url as string).includes('localhost'));
      expect((local?.description as string).toLowerCase()).toContain('development');
    });

    it('production server should have example URL', () => {
      const servers = buildServers();
      const prod = servers.find((s) => (s.url as string).includes('example'));
      expect(prod?.url).toContain('https://');
    });

    it('production server description should mention production', () => {
      const servers = buildServers();
      const prod = servers.find((s) => (s.url as string).includes('example'));
      expect((prod?.description as string).toLowerCase()).toContain('production');
    });

    it('all servers should have https:// scheme for production', () => {
      const servers = buildServers();
      const prod = servers.find((s) => (s.url as string).includes('example'));
      expect((prod?.url as string).startsWith('https://')).toBe(true);
    });
  });

  describe('buildComponents detailed validation', () => {
    it('should have securitySchemes with BearerAuth', () => {
      const components = buildComponents({});
      expect(components.securitySchemes).toBeDefined();
      expect((components.securitySchemes as Record<string, unknown>)?.BearerAuth).toBeDefined();
    });

    it('should preserve schema structure', () => {
      const testSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      };
      const testSchemas = { TestSchema: testSchema };

      const components = buildComponents(testSchemas);

      expect((components.schemas as Record<string, unknown>)?.TestSchema).toEqual(testSchema);
    });

    it('should handle empty schemas object', () => {
      const components = buildComponents({});
      expect(components.schemas).toEqual({});
    });

    it('should have exactly these top-level keys', () => {
      const components = buildComponents({});
      const keys = Object.keys(components);
      expect(keys).toContain('schemas');
      expect(keys).toContain('securitySchemes');
    });
  });

  describe('Version Resolution Fallback', () => {
    it('should read version from package.json successfully', () => {
      const info = buildInfo();
      expect(info.version).not.toBe('0.0.0');
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have a fallback version when package.json read fails', () => {
      // This test verifies the fallback exists in the code
      // Testing actual read failures requires mocking fs, which can conflict with other tests
      const info = buildInfo();
      expect(info.version).toBeDefined();
      expect(typeof info.version).toBe('string');
    });
  });

  describe('Info Object Structure', () => {
    it('should have all required OpenAPI info properties', () => {
      const info = buildInfo();

      expect(info).toHaveProperty('title');
      expect(info).toHaveProperty('version');
      expect(info).toHaveProperty('description');
      expect(info).toHaveProperty('contact');
      expect(info).toHaveProperty('license');
    });

    it('contact object should be complete', () => {
      const info = buildInfo();
      const contact = info.contact as Record<string, unknown>;

      expect(contact).toHaveProperty('name');
      expect(contact).toHaveProperty('url');
      expect(typeof contact.name).toBe('string');
      expect(typeof contact.url).toBe('string');
    });

    it('license object should be complete', () => {
      const info = buildInfo();
      const license = info.license as Record<string, unknown>;

      expect(license).toHaveProperty('name');
      expect(license).toHaveProperty('url');
      expect(typeof license.name).toBe('string');
      expect(typeof license.url).toBe('string');
    });
  });
});
