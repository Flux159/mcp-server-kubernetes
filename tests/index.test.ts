import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesManager } from '../src/types.js';

// Mock SDK Server to capture handlers
const capturedHandlers = new Map();
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const Server = vi.fn().mockImplementation(() => ({
    name: 'mock-server',
    version: '1.0.0',
    setRequestHandler: vi.fn((schema, handler) => {
      capturedHandlers.set(schema, handler); // Use the schema object itself as the key
    }),
    connect: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  }));
  return { Server };
});

// Mock KubernetesManager
vi.mock('../src/utils/kubernetes-manager.js', () => {
  const KubernetesManagerMock = vi.fn().mockImplementation(() => ({
    cleanup: vi.fn(() => Promise.resolve()),
    getCoreApi: vi.fn(),
    getAppsApi: vi.fn(),
    getBatchApi: vi.fn(),
    // Add other methods if they are directly called by handlers being tested
  }));
  return { KubernetesManager: KubernetesManagerMock };
});

// --- Mock individual tool handlers and their schemas ---
// Ensure mocked schemas have a 'name' property matching the actual tool name.
const mockListPods = vi.fn();
vi.mock('../src/tools/list_pods.js', () => ({
  listPods: mockListPods,
  listPodsSchema: { name: 'list_pods', description: 'Lists pods' }, // Mock schema
}));

const mockCreateNamespace = vi.fn();
vi.mock('../src/tools/create_namespace.js', () => ({
  createNamespace: mockCreateNamespace,
  createNamespaceSchema: { name: 'create_namespace', description: 'Creates a namespace' },
}));

const mockDeletePod = vi.fn();
vi.mock('../src/tools/delete_pod.js', () => ({
    deletePod: mockDeletePod,
    deletePodSchema: { name: 'delete_pod', description: 'Deletes a pod, destructive.'} // Example destructive tool
}));
// Add mocks for all tool modules imported in src/index.ts to ensure `allTools` can be constructed
// For brevity, only a few are fully mocked here. Assume others are similarly mocked if needed.
// For the test to run, all schemas listed in `allTools` in `src/index.ts` must be mockable.
// We need to ensure that `destructiveTools` in `src/index.ts` can find its schemas by name.

// Import Schemas from SDK, these are actual objects used as keys
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

let callToolHandler;
let listToolsHandler;
let allToolsForTest;
let destructiveToolsForTest;
let k8sManagerInstanceForTest;


describe('Server Tool Handling', () => {
  beforeEach(async () => {
    vi.resetModules(); // Reset modules before each test to re-evaluate src/index.ts with new mocks/env
    capturedHandlers.clear();
    mockListPods.mockClear().mockResolvedValue({ content: [{ type: 'text', text: 'pods listed' }] });
    mockCreateNamespace.mockClear().mockResolvedValue({ content: [{ type: 'text', text: 'namespace created' }] });
    mockDeletePod.mockClear().mockResolvedValue({ content: [{ type: 'text', text: 'pod deleted' }] });

    // Mock process.env for this test run
    vi.doMock('process', () => ({
      ...process,
      env: {
        ...process.env,
        ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS: undefined, // Default: all tools enabled
      },
    }));

    // Dynamically import main module after mocks are set up.
    // This ensures src/index.ts runs with the mocked Server, K8sManager, tools, and process.env
    const mainModule = await import('../src/index.js');
    
    callToolHandler = capturedHandlers.get(CallToolRequestSchema);
    listToolsHandler = capturedHandlers.get(ListToolsRequestSchema);
    
    // These are the lists as constructed by src/index.ts under the current (mocked) environment
    allToolsForTest = mainModule.allTools; 
    destructiveToolsForTest = mainModule.destructiveTools; // Used to verify filtering logic

    k8sManagerInstanceForTest = new KubernetesManager(); // Get an instance from the mocked KubernetesManager
  });

  afterEach(() => {
    vi.doUnmock('process'); // Clean up process mock
  });

  describe('CallToolRequestSchema Handler', () => {
    test('should be captured', () => {
        expect(callToolHandler).toBeDefined();
        expect(typeof callToolHandler).toBe('function');
    });

    test('should call the correct handler for a valid tool (list_pods)', async () => {
      const inputArgs = { namespace: 'test-ns' };
      const expectedResult = { content: [{ type: 'text', text: 'pods listed' }] };
      mockListPods.mockResolvedValue(expectedResult); // Ensure this mock is fresh

      const request = {
        params: { name: 'list_pods', arguments: inputArgs },
        method: 'tools/call',
      };

      const result = await callToolHandler(request);

      expect(mockListPods).toHaveBeenCalledTimes(1);
      expect(mockListPods).toHaveBeenCalledWith(k8sManagerInstanceForTest, inputArgs);
      expect(result).toEqual(expectedResult);
    });

    test('should throw McpError for a non-existent tool', async () => {
      const request = {
        params: { name: 'non_existent_tool', arguments: {} },
        method: 'tools/call',
      };

      await expect(callToolHandler(request)).rejects.toSatisfy((error: McpError) => {
        return error instanceof McpError &&
               error.errorCode === ErrorCode.InvalidRequest && 
               error.message.includes('Unknown tool: non_existent_tool');
      });
    });

    test('should handle McpErrors thrown by tool handlers by re-throwing them', async () => {
        const inputArgs = { name: 'test-ns-mcp-error' };
        const mcpError = new McpError(ErrorCode.ToolError, "Tool-specific MCP error");
        mockCreateNamespace.mockRejectedValue(mcpError);
  
        const request = {
          params: { name: 'create_namespace', arguments: inputArgs },
          method: 'tools/call',
        };
  
        await expect(callToolHandler(request)).rejects.toThrow(mcpError);
    });

    test('should wrap non-McpErrors from tool handlers in McpError.InternalError', async () => {
        const inputArgs = { name: 'test-ns-generic-error' };
        const genericErrorMessage = "Some generic tool failure";
        mockCreateNamespace.mockRejectedValue(new Error(genericErrorMessage));
  
        const request = {
          params: { name: 'create_namespace', arguments: inputArgs },
          method: 'tools/call',
        };
  
        await expect(callToolHandler(request)).rejects.toSatisfy((error: McpError) => {
          return error instanceof McpError &&
                 error.errorCode === ErrorCode.InternalError &&
                 error.message.includes(`Tool execution failed: Error: ${genericErrorMessage}`);
        });
    });
  });

  describe('ListToolsRequestSchema Handler', () => {
    test('should be captured', () => {
        expect(listToolsHandler).toBeDefined();
        expect(typeof listToolsHandler).toBe('function');
    });
    
    test('should return all tools when ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS is not set (default)', async () => {
      // process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS is undefined by default in beforeEach
      const result = await listToolsHandler();
      expect(result.tools).toBeDefined();
      // allToolsForTest is the `allTools` array from src/index.ts, which contains mocked schemas
      expect(result.tools.length).toEqual(allToolsForTest.length);
      expect(result.tools).toEqual(expect.arrayContaining(allToolsForTest.map(s => ({name: s.name, description: s.description}))));
    });

    test('should return only non-destructive tools when ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS is "true"', async () => {
      vi.resetModules(); // Crucial: reset modules to re-evaluate src/index.ts with new env
      capturedHandlers.clear();
      
      vi.doMock('process', () => ({
        ...process,
        env: { ...process.env, ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS: 'true' },
      }));

      const mainModuleFresh = await import('../src/index.js');
      const listToolsHandlerFresh = capturedHandlers.get(ListToolsRequestSchema);
      // These are the tool lists from src/index.ts, re-evaluated with the new process.env
      const allToolsFresh = mainModuleFresh.allTools; 
      const destructiveToolsFresh = mainModuleFresh.destructiveTools;
      
      expect(listToolsHandlerFresh).toBeDefined();
      const result = await listToolsHandlerFresh();
      
      const expectedNonDestructiveTools = allToolsFresh.filter(
        (tool) => !destructiveToolsFresh.some((dt) => dt.name === tool.name)
      );
      
      expect(result.tools).toBeDefined();
      expect(result.tools.length).toEqual(expectedNonDestructiveTools.length);
      expect(result.tools).toEqual(expect.arrayContaining(expectedNonDestructiveTools.map(s => ({name: s.name, description: s.description}))));
      
      for (const destructiveToolSchema of destructiveToolsFresh) {
        expect(result.tools.map(t => t.name)).not.toContain(destructiveToolSchema.name);
      }
      vi.doUnmock('process');
    });
  });
});
