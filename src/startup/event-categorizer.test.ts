/**
 * Tests for Event Categorizer
 *
 * Categorizes startup events by type and rank
 */

import { categorizeEvent, getEventCategories } from './event-categorizer';

describe('Event Categorizer', () => {
  describe('categorizeEvent', () => {
    it('should categorize component initialization events', () => {
      const event = categorizeEvent({
        type: 'component_init',
        component: 'ResultCache',
        detail: 'Initialized (12.3ms)',
      });

      expect(event.category).toBe('bootstrap');
      expect(event.rank).toBeGreaterThan(0);
    });

    it('should categorize check events', () => {
      const event = categorizeEvent({
        type: 'preflight_check',
        component: 'git-safe-directory',
        detail: 'Check passed',
      });

      expect(event.category).toBe('preflight');
      expect(event.severity).toBe('info');
    });

    it('should categorize error events', () => {
      const event = categorizeEvent({
        type: 'check_failed',
        component: 'secrets-readable',
        detail: 'Cannot read secrets',
      });

      expect(event.category).toBe('error');
      expect(event.severity).toBe('blocking');
    });

    it('should set appropriate severity levels', () => {
      const infoEvent = categorizeEvent({
        type: 'service_started',
        component: 'API',
        detail: 'Started',
      });
      expect(['info', 'debug']).toContain(infoEvent.severity);

      const warningEvent = categorizeEvent({
        type: 'slow_component',
        component: 'JobScheduler',
        detail: 'Took 1200ms',
      });
      expect(warningEvent.severity).toBe('warning');

      const errorEvent = categorizeEvent({
        type: 'service_failed',
        component: 'API',
        detail: 'Failed to start',
      });
      // service_failed events are critical, so severity is 'blocking'
      expect(errorEvent.severity).toBe('blocking');
    });
  });

  describe('event ranking', () => {
    it('should rank critical events higher', () => {
      const errorEvent = categorizeEvent({
        type: 'service_failed',
        component: 'API',
        detail: 'Failed',
      });

      const infoEvent = categorizeEvent({
        type: 'service_started',
        component: 'Cache',
        detail: 'Started',
      });

      expect(errorEvent.rank).toBeGreaterThan(infoEvent.rank);
    });

    it('should rank by category priority', () => {
      const bootstrapEvent = categorizeEvent({
        type: 'component_init',
        component: 'Cache',
        detail: 'Init',
      });

      const validationEvent = categorizeEvent({
        type: 'validation_result',
        component: 'npm-test',
        detail: 'Passed',
      });

      expect(bootstrapEvent.rank).toBeGreaterThan(validationEvent.rank);
    });
  });

  describe('getEventCategories', () => {
    it('should return all available categories', () => {
      const categories = getEventCategories();

      expect(categories).toContain('bootstrap');
      expect(categories).toContain('preflight');
      expect(categories).toContain('validation');
      expect(Array.isArray(categories)).toBe(true);
    });
  });

  describe('unknown events', () => {
    it('should handle unknown event types', () => {
      const event = categorizeEvent({
        type: 'unknown_event',
        component: 'Unknown',
        detail: 'Something',
      });

      expect(event.category).toBeDefined();
      expect(event.severity).toBe('debug');
      expect(event.rank).toBe(0);
    });
  });
});
