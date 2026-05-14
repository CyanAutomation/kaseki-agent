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

      expect(info.title).toBe('Kaseki Agent API');
      expect(info.version).toBe('1.13.0');
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
      expect(servers.length).toBe(2);
    });

    it('should include localhost development server', () => {
      const servers = buildServers();
      const localhost = servers.find((s) => (s.url as string).includes('localhost'));

      expect(localhost).toBeDefined();
      expect(localhost?.description).toContain('development');
    });

    it('should include production server template', () => {
      const servers = buildServers();
      const production = servers.find((s) => (s.url as string).includes('example.com'));

      expect(production).toBeDefined();
      expect(production?.description).toContain('Production');
    });

    it('each server should have url and description', () => {
      const servers = buildServers();

      servers.forEach((server) => {
        expect(server).toHaveProperty('url');
        expect(server).toHaveProperty('description');
        expect(typeof server.url).toBe('string');
        expect(typeof server.description).toBe('string');
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
});
