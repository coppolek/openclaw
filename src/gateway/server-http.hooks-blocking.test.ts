import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createHookRequest,
  createHooksHandler,
  createResponse,
} from "./server-http.test-harness.js";

const { readJsonBodyMock } = vi.hoisted(() => ({
  readJsonBodyMock: vi.fn(),
}));

vi.mock("./hooks.js", async () => {
  const actual = await vi.importActual<typeof import("./hooks.js")>("./hooks.js");
  return {
    ...actual,
    readJsonBody: readJsonBodyMock,
  };
});

describe("createHooksRequestHandler blocking mode", () => {
  beforeEach(() => {
    readJsonBodyMock.mockClear();
  });

  test("blocking:true happy path returns text in response", async () => {
    readJsonBodyMock.mockResolvedValue({
      ok: true,
      value: { message: "test message", blocking: true },
    });
    const dispatchAgentHook = vi.fn(async (payload: { runId?: string }) => ({
      runId: payload.runId ?? "run-123",
      outputText: "hello",
    }));
    const handler = createHooksHandler({ dispatchAgentHook });
    const req = createHookRequest({ url: "/hooks/agent" });
    const { res, end } = createResponse();

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(dispatchAgentHook).toHaveBeenCalledTimes(1);
    expect(dispatchAgentHook).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "test message",
        blocking: true,
      }),
    );
    const responseBody = JSON.parse(end.mock.calls[0][0] as string);
    expect(responseBody).toEqual({
      ok: true,
      runId: expect.any(String),
      text: "hello",
    });
  });

  test("blocking:true error path returns 500 with error", async () => {
    readJsonBodyMock.mockResolvedValue({
      ok: true,
      value: { message: "test message", blocking: true },
    });
    const dispatchAgentHook = vi.fn(async (payload: { runId?: string }) => ({
      runId: payload.runId ?? "run-456",
      agentError: "boom",
    }));
    const handler = createHooksHandler({ dispatchAgentHook });
    const req = createHookRequest({ url: "/hooks/agent" });
    const { res, end } = createResponse();

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(dispatchAgentHook).toHaveBeenCalledTimes(1);
    const responseBody = JSON.parse(end.mock.calls[0][0] as string);
    expect(responseBody).toEqual({
      ok: false,
      runId: expect.any(String),
      error: "boom",
    });
  });

  test("blocking run with non-ok status returns 500", async () => {
    // This simulates a non-throwing status:error result from runCronIsolatedAgentTurn.
    // When handleRunResult sees result.status !== 'ok', it returns { runId, agentError }
    // without throwing. The HTTP handler treats any agentError the same way.
    readJsonBodyMock.mockResolvedValue({
      ok: true,
      value: { message: "test message", blocking: true },
    });
    const dispatchAgentHook = vi.fn(async (payload: { runId?: string }) => ({
      runId: payload.runId ?? "run-5",
      agentError: "run failed (error): abort",
    }));
    const handler = createHooksHandler({ dispatchAgentHook });
    const req = createHookRequest({ url: "/hooks/agent" });
    const { res, end } = createResponse();

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(dispatchAgentHook).toHaveBeenCalledTimes(1);
    const responseBody = JSON.parse(end.mock.calls[0][0] as string);
    expect(responseBody).toEqual({
      ok: false,
      runId: expect.any(String),
      error: "run failed (error): abort",
    });
  });

  test("non-blocking returns runId without text field", async () => {
    readJsonBodyMock.mockResolvedValue({
      ok: true,
      value: { message: "test message" },
    });
    const dispatchAgentHook = vi.fn(async (payload: { runId?: string }) => ({
      runId: payload.runId ?? "run-789",
    }));
    const handler = createHooksHandler({ dispatchAgentHook });
    const req = createHookRequest({ url: "/hooks/agent" });
    const { res, end } = createResponse();

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(dispatchAgentHook).toHaveBeenCalledTimes(1);
    const responseBody = JSON.parse(end.mock.calls[0][0] as string);
    expect(responseBody).toEqual({
      ok: true,
      runId: expect.any(String),
    });
    expect(responseBody).not.toHaveProperty("text");
  });

  test("blocking:true bypasses idempotency cache", async () => {
    const dispatchAgentHook = vi.fn(async (payload: { runId?: string }) => ({
      runId: payload.runId ?? "run-" + Math.random(),
      outputText: "response",
    }));
    const handler = createHooksHandler({ dispatchAgentHook });

    // First request with blocking:true and idempotency key
    readJsonBodyMock.mockResolvedValueOnce({
      ok: true,
      value: { message: "test message", blocking: true, idempotencyKey: "same-key" },
    });
    const req1 = createHookRequest({
      url: "/hooks/agent",
      headers: { "idempotency-key": "same-key" },
    });
    const { res: res1 } = createResponse();
    await handler(req1, res1);

    // Second request with same idempotency key should still call dispatchAgentHook
    readJsonBodyMock.mockResolvedValueOnce({
      ok: true,
      value: { message: "test message", blocking: true, idempotencyKey: "same-key" },
    });
    const req2 = createHookRequest({
      url: "/hooks/agent",
      headers: { "idempotency-key": "same-key" },
    });
    const { res: res2 } = createResponse();
    await handler(req2, res2);

    // dispatchAgentHook should be called both times (cache bypassed for blocking)
    expect(dispatchAgentHook).toHaveBeenCalledTimes(2);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
  });

  test("non-blocking uses idempotency cache", async () => {
    const dispatchAgentHook = vi.fn(async (payload: { runId?: string }) => ({
      runId: payload.runId ?? "cached-run-id",
    }));
    const handler = createHooksHandler({ dispatchAgentHook });

    // First request without blocking and idempotency key
    readJsonBodyMock.mockResolvedValueOnce({
      ok: true,
      value: { message: "test message", idempotencyKey: "same-key" },
    });
    const req1 = createHookRequest({
      url: "/hooks/agent",
      headers: { "idempotency-key": "same-key" },
    });
    const { res: res1, end: end1 } = createResponse();
    await handler(req1, res1);

    // Second request with same idempotency key should return cached runId
    readJsonBodyMock.mockResolvedValueOnce({
      ok: true,
      value: { message: "test message", idempotencyKey: "same-key" },
    });
    const req2 = createHookRequest({
      url: "/hooks/agent",
      headers: { "idempotency-key": "same-key" },
    });
    const { res: res2, end: end2 } = createResponse();
    await handler(req2, res2);

    // dispatchAgentHook should only be called once (second request used cache)
    expect(dispatchAgentHook).toHaveBeenCalledTimes(1);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const response1 = JSON.parse(end1.mock.calls[0][0] as string);
    const response2 = JSON.parse(end2.mock.calls[0][0] as string);
    // Both responses should have the same runId (second request hit cache with pre-allocated id)
    expect(response1.runId).toEqual(expect.any(String));
    expect(response2.runId).toBe(response1.runId);
  });
});
