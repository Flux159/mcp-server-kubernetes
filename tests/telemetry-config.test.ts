import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTelemetryConfig, initializeTelemetry, getTelemetryConfigSummary } from '../src/config/telemetry-config.js';

describe('Telemetry Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear all telemetry-related env vars
    delete process.env.ENABLE_TELEMETRY;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_TRACES_SAMPLER;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Feature Flag Behavior', () => {
    it('should be disabled by default when no env vars are set', () => {
      const config = getTelemetryConfig();
      expect(config.enabled).toBe(false);
    });

    it('should be disabled when ENABLE_TELEMETRY is not set', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';

      const config = getTelemetryConfig();
      expect(config.enabled).toBe(false);
    });

    it('should be disabled when ENABLE_TELEMETRY=false', () => {
      process.env.ENABLE_TELEMETRY = 'false';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';

      const config = getTelemetryConfig();
      expect(config.enabled).toBe(false);
    });

    it('should be disabled when ENABLE_TELEMETRY=0', () => {
      process.env.ENABLE_TELEMETRY = '0';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';

      const config = getTelemetryConfig();
      expect(config.enabled).toBe(false);
    });

    it('should be disabled when ENABLE_TELEMETRY=true but no endpoint', () => {
      process.env.ENABLE_TELEMETRY = 'true';

      const config = getTelemetryConfig();
      expect(config.enabled).toBe(false);
    });

    it('should be enabled when ENABLE_TELEMETRY=true and endpoint is set', () => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';

      const config = getTelemetryConfig();
      expect(config.enabled).toBe(true);
    });

    it('should be enabled when ENABLE_TELEMETRY=1 and endpoint is set', () => {
      process.env.ENABLE_TELEMETRY = '1';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';

      const config = getTelemetryConfig();
      expect(config.enabled).toBe(true);
    });
  });

  describe('OTLP Endpoint Configuration', () => {
    beforeEach(() => {
      process.env.ENABLE_TELEMETRY = 'true';
    });

    it('should capture OTLP endpoint when set', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://jaeger:4317';

      const config = getTelemetryConfig();
      expect(config.endpoint).toBe('http://jaeger:4317');
    });

    it('should handle HTTPS endpoints', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://tempo.observability:4317';

      const config = getTelemetryConfig();
      expect(config.endpoint).toBe('https://tempo.observability:4317');
    });

    it('should handle different ports', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';

      const config = getTelemetryConfig();
      expect(config.endpoint).toBe('http://localhost:4318');
    });
  });

  describe('Service Name Configuration', () => {
    beforeEach(() => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
    });

    it('should use default service name when not set', () => {
      const config = getTelemetryConfig();
      expect(config.serviceName).toBe('kubernetes');
    });

    it('should use custom service name when OTEL_SERVICE_NAME is set', () => {
      process.env.OTEL_SERVICE_NAME = 'kubernetes-mcp-server';

      const config = getTelemetryConfig();
      expect(config.serviceName).toBe('kubernetes-mcp-server');
    });

    it('should use custom service name with special characters', () => {
      process.env.OTEL_SERVICE_NAME = 'mcp-k8s-prod-us-west-2';

      const config = getTelemetryConfig();
      expect(config.serviceName).toBe('mcp-k8s-prod-us-west-2');
    });
  });

  describe('Sampling Configuration', () => {
    beforeEach(() => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
    });

    it('should return undefined sampler when not configured', () => {
      const config = getTelemetryConfig();
      expect(config.sampler).toBeUndefined();
    });

    it('should parse always_on sampler', () => {
      process.env.OTEL_TRACES_SAMPLER = 'always_on';

      const config = getTelemetryConfig();
      expect(config.sampler).toEqual({
        type: 'always_on'
      });
    });

    it('should parse always_off sampler', () => {
      process.env.OTEL_TRACES_SAMPLER = 'always_off';

      const config = getTelemetryConfig();
      expect(config.sampler).toEqual({
        type: 'always_off'
      });
    });

    it('should parse traceidratio sampler with argument', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.05';

      const config = getTelemetryConfig();
      expect(config.sampler).toEqual({
        type: 'traceidratio',
        arg: 0.05
      });
    });

    it('should parse traceidratio sampler with different ratios', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.1';

      const config = getTelemetryConfig();
      expect(config.sampler?.arg).toBe(0.1);
    });

    it('should parse traceidratio sampler with 100% sampling', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '1.0';

      const config = getTelemetryConfig();
      expect(config.sampler?.arg).toBe(1.0);
    });

    it('should parse traceidratio sampler with 0% sampling', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.0';

      const config = getTelemetryConfig();
      expect(config.sampler?.arg).toBe(0.0);
    });

    it('should ignore invalid sampler argument (negative)', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '-0.5';

      const config = getTelemetryConfig();
      expect(config.sampler?.arg).toBeUndefined();
    });

    it('should ignore invalid sampler argument (>1)', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '1.5';

      const config = getTelemetryConfig();
      expect(config.sampler?.arg).toBeUndefined();
    });

    it('should ignore invalid sampler argument (not a number)', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = 'invalid';

      const config = getTelemetryConfig();
      expect(config.sampler?.arg).toBeUndefined();
    });
  });

  describe('Resource Attributes Configuration', () => {
    beforeEach(() => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
    });

    it('should return empty object when no resource attributes set', () => {
      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({});
    });

    it('should parse single resource attribute', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'environment=production';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({
        environment: 'production'
      });
    });

    it('should parse multiple resource attributes', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'environment=production,team=platform,region=us-west-2';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({
        environment: 'production',
        team: 'platform',
        region: 'us-west-2'
      });
    });

    it('should handle attributes with dots in keys', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'deployment.environment=production,k8s.cluster.name=prod-cluster';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({
        'deployment.environment': 'production',
        'k8s.cluster.name': 'prod-cluster'
      });
    });

    it('should handle attributes with special characters in values', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'cluster=prod-us-west-2,version=v1.0.0';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({
        cluster: 'prod-us-west-2',
        version: 'v1.0.0'
      });
    });

    it('should trim whitespace from keys and values', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = ' environment = production , team = platform ';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({
        environment: 'production',
        team: 'platform'
      });
    });

    it('should ignore malformed attributes', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'environment=production,invalid,team=platform';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({
        environment: 'production',
        team: 'platform'
      });
    });
  });

  describe('getTelemetryConfigSummary', () => {
    it('should return disabled message when telemetry is disabled', () => {
      const summary = getTelemetryConfigSummary();
      expect(summary).toBe('Telemetry: Disabled');
    });

    it('should return enabled summary with basic config', () => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';

      const summary = getTelemetryConfigSummary();
      expect(summary).toContain('Telemetry: Enabled');
      expect(summary).toContain('Endpoint: http://localhost:4317');
      expect(summary).toContain('Service: kubernetes@0.1.0');
    });

    it('should include sampler in summary', () => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.05';

      const summary = getTelemetryConfigSummary();
      expect(summary).toContain('Sampler: traceidratio(0.05)');
    });

    it('should include resource attributes count in summary', () => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'environment=production,team=platform';

      const summary = getTelemetryConfigSummary();
      expect(summary).toContain('Resource Attributes: 2');
    });
  });

  describe('initializeTelemetry', () => {
    it('should return null when telemetry is disabled', () => {
      const sdk = initializeTelemetry();
      expect(sdk).toBeNull();
    });

    it('should return null when ENABLE_TELEMETRY is false', () => {
      process.env.ENABLE_TELEMETRY = 'false';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';

      const sdk = initializeTelemetry();
      expect(sdk).toBeNull();
    });

    it('should return null when endpoint is missing', () => {
      process.env.ENABLE_TELEMETRY = 'true';

      const sdk = initializeTelemetry();
      expect(sdk).toBeNull();
    });

    // Note: Full SDK initialization test would require mocking the OpenTelemetry SDK
    // which is complex. In a real scenario, you'd mock the SDK or use integration tests.
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      process.env.ENABLE_TELEMETRY = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
    });

    it('should handle empty service name gracefully', () => {
      process.env.OTEL_SERVICE_NAME = '';

      const config = getTelemetryConfig();
      expect(config.serviceName).toBe('kubernetes'); // Falls back to default
    });

    it('should handle empty resource attributes string', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = '';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({});
    });

    it('should handle resource attributes with only commas', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = ',,,';

      const config = getTelemetryConfig();
      expect(config.resourceAttributes).toEqual({});
    });
  });
});
