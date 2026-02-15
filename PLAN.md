# Implementation Plan: MCP Server Improvements (31.5 Iteration 3)

## Overview
Enhance MCP server with improved JSON-Schema to Zod conversion fidelity and add SSE integration test for BYOK extract with environment-default API key.

## Review Feedback to Address

### 1. JSON-Schema→Zod Fidelity (Array + Format)
Currently `jsonSchemaToZodSchema()` in `packages/mcp-server/src/server.ts` (lines 77-118) supports:
- ✅ `enum` (string literals)
- ✅ `string`, `number`, `integer`, `boolean` types
- ✅ `object` with properties and `additionalProperties`
- ❌ `array` types (missing)
- ❌ `format` constraints (missing, e.g., `format: 'uri'`)

**Gap**: Tool schemas like `screenshot` use `{ type: 'string', format: 'uri' }` for URLs, but `jsonSchemaToZodSchema()` ignores `format`, converting it to plain `z.string()` instead of `z.string().url()`.

**Gap**: No support for `array` types with `items` schema (e.g., `{ type: 'array', items: { type: 'string' } }`).

### 2. SSE CallTool Integration for BYOK Env-Default Key Path
`packages/mcp-server/tests/sse-integration.test.ts` has extensive SSE `callTool` coverage:
- ✅ Line 295-344: `callTool` screenshot
- ✅ Line 347-399: `callTool` accessibility
- ✅ Line 401-456: `callTool` extract (default, no BYOK)
- ✅ Line 458-512: `callTool` extract (BYOK via `llm_api_key` argument)
- ✅ Line 514-568: `callTool` extract (BYOK via `llm_api_key` argument, omitted screenshot)
- ❌ **Missing**: `callTool` extract with BYOK via **environment-default** `SCREENFORGE_MCP_EXTRACT_LLM_API_KEY`

**Gap**: No test verifies that when `SCREENFORGE_MCP_EXTRACT_LLM_API_KEY` is set in config and `llm_api_key` is **not** passed in tool arguments, the server correctly falls back to the env-default key.

---

## Files to Modify

### 1. `packages/mcp-server/src/server.ts`
**Changes**:
- Extend `jsonSchemaToZodSchema()` to support `array` types with `items` schema
- Extend `jsonSchemaToZodSchema()` to support `format` constraints (`uri` → `z.string().url()`)
- Add recursive handling for nested array/object schemas

**Approach**:
```typescript
function jsonSchemaToZodSchema(schema: JsonSchemaNode): z.ZodTypeAny {
  // ... existing enum handling ...

  const type = typeof schema.type === 'string' ? schema.type : undefined;

  // NEW: Handle array types
  if (type === 'array') {
    const items = schema.items;
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      const itemSchema = jsonSchemaToZodSchema(items as JsonSchemaNode);
      return z.array(itemSchema);
    }
    return z.array(z.any()); // fallback for unspecified items
  }

  // ENHANCED: Handle string format constraints
  if (type === 'string') {
    const format = typeof schema.format === 'string' ? schema.format : undefined;
    if (format === 'uri') {
      return z.string().url();
    }
    // Future: 'email', 'date-time', 'uuid', etc.
    return z.string();
  }

  // ... rest of existing logic ...
}
```

**Edge Cases**:
- Empty array schema (`{ type: 'array' }` without `items`) → fallback to `z.array(z.any())`
- Nested arrays (`{ type: 'array', items: { type: 'array', items: { type: 'string' } } }`)
- Unsupported formats → ignore and use base type (e.g., `format: 'date-time'` → `z.string()` for now)
- `null` type handling (JSON Schema allows `type: ['string', 'null']`) → defer for future iteration

### 2. `packages/mcp-server/tests/server.test.ts`
**Changes**:
- Add unit test for array schema conversion (e.g., `{ type: 'array', items: { type: 'string' } }`)
- Add unit test for format constraint conversion (e.g., `{ type: 'string', format: 'uri' }`)
- Verify both valid and invalid inputs (e.g., `['foo']` passes, `[123]` fails for string array)

**Test Cases**:
```typescript
it('converts array schemas to z.array()', () => {
  const schema = { type: 'array', items: { type: 'string' } };
  const zodSchema = jsonSchemaToZodSchema(schema);
  expect(zodSchema.safeParse(['foo', 'bar']).success).toBe(true);
  expect(zodSchema.safeParse([123]).success).toBe(false);
  expect(zodSchema.safeParse('not-array').success).toBe(false);
});

it('converts format:uri to z.string().url()', () => {
  const schema = { type: 'string', format: 'uri' };
  const zodSchema = jsonSchemaToZodSchema(schema);
  expect(zodSchema.safeParse('https://example.com').success).toBe(true);
  expect(zodSchema.safeParse('not-a-url').success).toBe(false);
});

it('handles nested array schemas', () => {
  const schema = { type: 'array', items: { type: 'array', items: { type: 'number' } } };
  const zodSchema = jsonSchemaToZodSchema(schema);
  expect(zodSchema.safeParse([[1, 2], [3]]).success).toBe(true);
  expect(zodSchema.safeParse([['foo']]).success).toBe(false);
});
```

### 3. `packages/mcp-server/tests/sse-integration.test.ts`
**Changes**:
- Add new test `'invokes extract via callTool with env-default BYOK key'`
- Configure server with `extractLlmApiKey: 'env-default-key'`
- Call `extract` tool **without** `llm_api_key` argument
- Verify mock API receives `x-llm-api-key: env-default-key` header

**Test Case**:
```typescript
it('invokes extract via callTool with env-default BYOK key', async () => {
  const apiServer = await startMockApiServer();
  openApiServers.push(apiServer);

  const server = await startSseServer(
    {
      apiKey: 'sk_test',
      apiUrl: `http://127.0.0.1:${apiServer.port}`,
      inlineDataLimitBytes: 1024,
      extractLlmApiKey: 'env-default-anthropic-key', // NEW: env-default BYOK
    },
    { port: 0, host: '127.0.0.1', ssePath: '/sse', messagesPath: '/messages' },
  );

  openServers.push(server);

  const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${server.port}/sse`));
  const client = new Client({ name: 'mcp-integration-test-calltool-extract-env-byok', version: '0.0.0' });
  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'extract',
      arguments: {
        url: 'https://example.com',
        prompt: 'Extract key metadata',
        // NOTE: NO llm_api_key argument
      },
    });

    const structured = parseStructuredToolContent(result);
    assertToolCompleted(structured);
    expect(structured.status).toBe('completed');
    expect(structured.extractionId).toBeTruthy();

    const extractCall = apiServer.requests.find((request) => request.path === '/v1/extract');
    expect(extractCall).toBeTruthy();
    expect(extractCall?.headers.authorization).toBe('Bearer sk_test');
    expect(extractCall?.headers['x-llm-api-key']).toBe('env-default-anthropic-key'); // Verify env-default used
  } finally {
    await client.close();
  }
});
```

**Edge Case**: If both `extractLlmApiKey` (env-default) and `llm_api_key` (tool arg) are provided, the tool arg takes precedence (already covered by existing tests at lines 458-512).

---

## Data Flow

### Current Extract Flow (tools.ts:258-287)
```
1. Parse args: url, prompt, schema, model, llm_api_key, screenshot_options
2. Resolve LLM key: llmApiKey = args.llm_api_key ?? options.extractLlmApiKey
3. Branch:
   - If llmApiKey exists → runExtractWithByok(apiUrl, apiKey, llmApiKey, payload)
   - Else → client.extract(payload) [default path, server must have ANTHROPIC_API_KEY]
4. Return result
```

### Enhanced Flow (No Changes Needed)
The current implementation already supports env-default BYOK:
- `tools.ts:263` reads `llm_api_key` from args
- `tools.ts:263` falls back to `options.extractLlmApiKey` (set from `SCREENFORGE_MCP_EXTRACT_LLM_API_KEY` via config)
- `tools.ts:274-276` uses `runExtractWithByok()` if `llmApiKey` is truthy

**No code changes needed** — just missing test coverage.

---

## Testing Strategy

### Unit Tests (packages/mcp-server/tests/server.test.ts)
1. **Array schema conversion**
   - Valid: `['a', 'b']` passes for `{ type: 'array', items: { type: 'string' } }`
   - Invalid: `[123]` fails for same schema
   - Invalid: `'not-array'` fails
   - Nested: `[[1, 2]]` passes for `{ type: 'array', items: { type: 'array', items: { type: 'number' } } }`

2. **Format constraint conversion**
   - `format: 'uri'` → valid URL passes, invalid URL fails
   - Unsupported format → treated as base type (future-proof)

3. **Edge cases**
   - `{ type: 'array' }` (no items) → accepts any array
   - `{ type: 'string', format: 'unknown' }` → accepts any string

### Integration Tests (packages/mcp-server/tests/sse-integration.test.ts)
1. **Env-default BYOK extract**
   - Server configured with `extractLlmApiKey: 'env-key'`
   - Call `extract` without `llm_api_key` argument
   - Verify `x-llm-api-key: env-key` header sent to API
   - Verify successful response

2. **Precedence check (implicit, via existing tests)**
   - Existing test at line 458 already verifies tool arg overrides env-default

---

## Edge Cases & Validation

### JSON-Schema Conversion Edge Cases
1. **Unsupported types**: `null`, `oneOf`, `anyOf`, `allOf` → fallback to `z.any()` (already handled)
2. **Invalid schema**: Missing `type` field → fallback to `z.any()` (already handled)
3. **Circular references**: Not expected in MCP tool schemas, ignore for now
4. **`additionalItems`**: JSON Schema allows `items` as array + `additionalItems`, but MCP tools don't use this → ignore

### BYOK Key Precedence (Already Correct)
1. Tool argument (`llm_api_key`) > Env-default (`extractLlmApiKey`) > Server-side (`ANTHROPIC_API_KEY`)
2. If neither tool arg nor env-default is set, request uses default SDK path (no `x-llm-api-key` header)

### SSE Transport Edge Cases (Already Covered)
- Concurrent sessions → 409 error (line 263-293)
- Reconnect after close → works (sse-integration.test.ts:202-261)
- Missing sessionId → 400 error (line 219-224)

---

## Implementation Order

1. **Enhance `jsonSchemaToZodSchema()` in server.ts** (15 min)
   - Add array type handling
   - Add format constraint handling (`uri` → `.url()`)
   - Keep fallback to `z.any()` for unsupported types

2. **Add unit tests in server.test.ts** (10 min)
   - Test array schemas (simple + nested)
   - Test format constraints (`uri`)
   - Test edge cases (missing items, unsupported format)

3. **Add SSE integration test for env-default BYOK** (10 min)
   - Add test case to sse-integration.test.ts
   - Verify `x-llm-api-key` header propagation

4. **Run full test suite** (5 min)
   - `npm test` in packages/mcp-server
   - Verify no regressions

5. **Manual verification** (5 min)
   - Start MCP server with `SCREENFORGE_MCP_EXTRACT_LLM_API_KEY=test-key`
   - Call `extract` tool via MCP client (Claude Desktop)
   - Verify extract works without passing `llm_api_key` argument

---

## Success Criteria

### JSON-Schema Fidelity
- ✅ Array schemas convert to `z.array()` with correct item validation
- ✅ `format: 'uri'` converts to `z.string().url()`
- ✅ Nested arrays work correctly
- ✅ Unit tests pass for all cases

### SSE BYOK Integration
- ✅ Env-default BYOK key used when tool arg omitted
- ✅ `x-llm-api-key` header sent to API with env-default value
- ✅ Integration test passes
- ✅ No regression in existing extract tests

### Code Quality
- ✅ No new TypeScript errors
- ✅ All tests pass (`npm test`)
- ✅ No performance degradation (schema conversion is O(n) in schema depth)

---

## Rollback Plan
If issues arise:
1. Revert `jsonSchemaToZodSchema()` changes (single function)
2. Remove new test cases
3. No API/config changes needed (BYOK env-default already supported)

---

## Estimated Effort
- **Total**: ~45 minutes
- **Low risk**: All changes are additive (new functionality + tests)
- **No breaking changes**: Existing behavior preserved, new validations are stricter but still accept valid inputs
