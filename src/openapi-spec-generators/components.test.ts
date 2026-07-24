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
    it('should return exact tag names with purpose-specific descriptions', () => {
      const expectedTagContracts = [
        { name: 'Health & Status', descriptionPattern: /health|readiness/i },
        { name: 'Service Info', descriptionPattern: /metadata|metrics|pre-flight/i },
        { name: 'Run Management', descriptionPattern: /create|list|manage|runs/i },
        { name: 'Run Logs & Progress', descriptionPattern: /progress|logs/i },
        { name: 'Artifacts', descriptionPattern: /artifacts|download/i },
        { name: 'Run Details', descriptionPattern: /analysis|diagnostics/i },
        { name: 'Webhooks', descriptionPattern: /webhook|testing/i },
        { name: 'Gateway Diagnostics', descriptionPattern: /gateway|inference|adapter/i },
        { name: 'GitHub Issues', descriptionPattern: /github|issues|task/i },
      ];

      const tags = buildTags();

      expect(tags.map((tag) => tag.name)).toEqual(expectedTagContracts.map((tag) => tag.name));
      tags.forEach((tag, index) => {
        expect(typeof tag.description).toBe('string');
        expect((tag.description as string).trim().length).toBeGreaterThan(0);
        expect(tag.description).toMatch(expectedTagContracts[index].descriptionPattern);
      });
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

      const contactUrl = new URL(contact.url as string);
      expect(contactUrl.protocol).toBe('https:');
      expect(contactUrl.hostname).toBe('github.com');
      expect(contactUrl.pathname).toBe('/CyanAutomation/kaseki-agent');
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
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should read version from package.json successfully', () => {
      const info = buildInfo();
      expect(info.version).not.toBe('0.0.0');
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have a fallback version when package.json read fails', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const packageJsonReader = jest.fn(() => {
        throw new Error('package.json unavailable');
      });

      const info = buildInfo({ packageJsonReader });

      expect(info.version).toBe('0.0.0');
      expect(packageJsonReader).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Unable to derive API version from package.json candidates; defaulting to 0.0.0',
        expect.objectContaining({
          candidatesTried: expect.arrayContaining([expect.stringContaining('package.json unavailable')]),
        })
      );
    });
  });

  describe('Info Object Structure', () => {
    it('OpenAPI 3.1 Info Object contract: exposes semantic package identity, version, contact, and license metadata', () => {
      // Contract source: generateOpenAPISpec() emits buildInfo() as the root OpenAPI `info` object.
      // OpenAPI 3.1 requires `title` and `version`; this generator also requires real contact/license metadata.
      const info = buildInfo();
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as {
        author: string;
        license: string;
        name: string;
        repository: { url: string };
        version: string;
      };
      const expectedTitle = packageJson.name
        .replace(/^@[^/]+\//, '')
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ') + ' API';
      const contact = info.contact as Record<string, unknown>;
      const license = info.license as Record<string, unknown>;
      const repositoryUrl = packageJson.repository?.url ?? '';
      const nonPlaceholderPattern = /^(?!.*(?:example|placeholder|todo|changeme|unknown|localhost)).+$/i;

      expect(info.title).toBe(expectedTitle);
      expect(info.version).toBe(packageJson.version);

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fallbackInfo = buildInfo({
        packageJsonReader: jest.fn(() => {
          throw new Error('package.json unavailable');
        }),
      });
      expect(fallbackInfo.version).toBe('0.0.0');
      warnSpy.mockRestore();

      expect(contact.name).toBe(packageJson.author);
      expect(contact.name).toEqual(expect.stringMatching(nonPlaceholderPattern));
      expect(contact.url).toBe(repositoryUrl);
      expect(contact.url).toEqual(expect.stringMatching(nonPlaceholderPattern));
      expect(new URL(contact.url as string).protocol).toBe('https:');

      expect(license.name).toBe(packageJson.license);
      expect(license.name).toEqual(expect.stringMatching(nonPlaceholderPattern));
      expect(license.url).toEqual(expect.stringMatching(nonPlaceholderPattern));
      const licenseUrl = new URL(license.url as string);
      expect(licenseUrl.protocol).toBe('https:');
      expect(licenseUrl.hostname).toBe(new URL(repositoryUrl).hostname);
      expect(licenseUrl.pathname).toContain('/LICENSE');
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
