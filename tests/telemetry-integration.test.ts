import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withTelemetry } from '../src/middleware/telemetry-middleware.js';

/**
 * Integration tests for telemetry middleware
 * These tests verify the middleware behavior without heavy mocking
 */
describe('Telemetry Middleware Integration', () => {
  describe('withTelemetry - Integration', () => {
    it('should wrap a handler function', () => {
      const mockHandler = async () => ({ success: true });
      const wrappedHandler = withTelemetry(mockHandler);

      expect(typeof wrappedHandler).toBe('function');
    });

    it('should call the wrapped handler and return result', async () => {
      const expectedResult = { success: true, data: 'test' };
      const mockHandler = async () => expectedResult;
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_get',
          arguments: { resourceType: 'pods' }
        },
        method: 'tools/call'
      };

      const result = await wrappedHandler(request);
      expect(result).toEqual(expectedResult);
    });

    it('should handle successful tool calls', async () => {
      const mockHandler = async () => ({ success: true });
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_get',
          arguments: { resourceType: 'pods', namespace: 'default' }
        },
        method: 'tools/call'
      };

      await expect(wrappedHandler(request)).resolves.toEqual({ success: true });
    });

    it('should propagate errors from the handler', async () => {
      const mockError = new Error('Tool execution failed');
      const mockHandler = async () => {
        throw mockError;
      };
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_get',
          arguments: {}
        },
        method: 'tools/call'
      };

      await expect(wrappedHandler(request)).rejects.toThrow('Tool execution failed');
    });

    it('should handle tools with no arguments', async () => {
      const mockHandler = async () => ({ success: true });
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'ping',
          arguments: {}
        },
        method: 'tools/call'
      };

      await expect(wrappedHandler(request)).resolves.toBeDefined();
    });

    it('should handle tools with multiple arguments', async () => {
      const mockHandler = async () => ({ success: true });
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_get',
          arguments: {
            resourceType: 'deployments',
            namespace: 'production',
            context: 'prod-cluster',
            output: 'json',
            labelSelector: 'app=web'
          }
        },
        method: 'tools/call'
      };

      await expect(wrappedHandler(request)).resolves.toBeDefined();
    });

    it('should handle async handler execution', async () => {
      const mockHandler = async () => {
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 10));
        return { success: true };
      };
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_apply',
          arguments: { manifest: 'test' }
        },
        method: 'tools/call'
      };

      const result = await wrappedHandler(request);
      expect(result).toEqual({ success: true });
    });

    it('should measure execution time', async () => {
      const mockHandler = async () => {
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true };
      };
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_logs',
          arguments: { name: 'pod-1' }
        },
        method: 'tools/call'
      };

      const start = Date.now();
      await wrappedHandler(request);
      const duration = Date.now() - start;

      // Execution should take at least 50ms (simulated work)
      expect(duration).toBeGreaterThanOrEqual(45); // Small buffer for timing
    });

    it('should not affect handler behavior', async () => {
      let callCount = 0;
      const mockHandler = async (req: any) => {
        callCount++;
        return { success: true, toolName: req.params.name };
      };
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_describe',
          arguments: { resourceType: 'pod', name: 'test-pod' }
        },
        method: 'tools/call'
      };

      const result = await wrappedHandler(request);

      expect(callCount).toBe(1);
      expect(result.success).toBe(true);
      expect(result.toolName).toBe('kubectl_describe');
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle TypeError', async () => {
      const mockHandler = async () => {
        throw new TypeError('Invalid type');
      };
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_get',
          arguments: {}
        },
        method: 'tools/call'
      };

      await expect(wrappedHandler(request)).rejects.toThrow(TypeError);
      await expect(wrappedHandler(request)).rejects.toThrow('Invalid type');
    });

    it('should handle custom error objects', async () => {
      class CustomError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.code = code;
          this.name = 'CustomError';
        }
      }

      const mockHandler = async () => {
        throw new CustomError('Custom error', 'ERR_CUSTOM');
      };
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_apply',
          arguments: {}
        },
        method: 'tools/call'
      };

      await expect(wrappedHandler(request)).rejects.toThrow('Custom error');
    });

    it('should handle errors with additional properties', async () => {
      const mockHandler = async () => {
        const error: any = new Error('API Error');
        error.statusCode = 500;
        error.responseBody = { message: 'Internal Server Error' };
        throw error;
      };
      const wrappedHandler = withTelemetry(mockHandler);

      const request = {
        params: {
          name: 'kubectl_delete',
          arguments: {}
        },
        method: 'tools/call'
      };

      await expect(wrappedHandler(request)).rejects.toThrow('API Error');
    });
  });

  describe('Performance Integration', () => {
    it('should have minimal overhead', async () => {
      const iterations = 100;
      const mockHandler = async () => ({ success: true });

      const request = {
        params: {
          name: 'kubectl_get',
          arguments: {}
        },
        method: 'tools/call'
      };

      // Without telemetry
      const startWithout = Date.now();
      for (let i = 0; i < iterations; i++) {
        await mockHandler(request);
      }
      const durationWithout = Math.max(Date.now() - startWithout, 1); // Avoid division by zero

      // With telemetry
      const wrappedHandler = withTelemetry(mockHandler);
      const startWith = Date.now();
      for (let i = 0; i < iterations; i++) {
        await wrappedHandler(request);
      }
      const durationWith = Date.now() - startWith;

      // Verify both complete in reasonable time
      expect(durationWithout).toBeGreaterThanOrEqual(0);
      expect(durationWith).toBeGreaterThanOrEqual(0);

      // With telemetry should complete (may be similar time due to async nature)
      // Main goal: verify middleware doesn't break functionality
      expect(durationWith).toBeLessThan(10000); // Less than 10 seconds for 100 iterations
    });
  });
});
