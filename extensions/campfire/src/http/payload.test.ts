import { describe, expect, it } from "vitest";
import { parseCampfirePayload } from "./payload.js";

describe("parseCampfirePayload", () => {
  const validPayload = {
    user: { id: 42, name: "Alice" },
    room: {
      id: 7,
      name: "General",
      path: "https://campfire.example.com/rooms/7/42-AbCdEf/messages",
    },
    message: {
      id: 99,
      body: {
        html: "<p>Hey @Bot help me</p>",
        plain: "Hey help me",
      },
      path: "https://campfire.example.com/rooms/7/@99",
    },
  };

  it("returns typed payload for valid input", () => {
    const parsed = parseCampfirePayload(validPayload);

    expect(parsed).toEqual(validPayload);
  });

  it("returns null when required fields are missing", () => {
    const parsed = parseCampfirePayload({
      user: { id: 42, name: "Alice" },
      room: { id: 7, name: "General" },
      message: { id: 99, body: { plain: "Hey" } },
    });

    expect(parsed).toBeNull();
  });

  it("accepts payload without optional html field", () => {
    const payload = {
      user: { id: 42, name: "Alice" },
      room: {
        id: 7,
        name: "General",
        path: "https://campfire.example.com/rooms/7/42-AbCdEf/messages",
      },
      message: {
        id: 99,
        body: { plain: "Hey help me" },
        path: "https://campfire.example.com/rooms/7/@99",
      },
    };

    const parsed = parseCampfirePayload(payload);
    expect(parsed).toBeTruthy();
    expect(parsed!.message.body.html).toBeUndefined();
    expect(parsed!.message.body.plain).toBe("Hey help me");
  });

  it("returns null when html is present but not a string", () => {
    const parsed = parseCampfirePayload({
      user: { id: 42, name: "Alice" },
      room: {
        id: 7,
        name: "General",
        path: "https://campfire.example.com/rooms/7/42-AbCdEf/messages",
      },
      message: {
        id: 99,
        body: { plain: "Hey", html: 123 },
        path: "https://campfire.example.com/rooms/7/@99",
      },
    });

    expect(parsed).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseCampfirePayload(null)).toBeNull();
    expect(parseCampfirePayload("not-json")).toBeNull();
    expect(parseCampfirePayload(123)).toBeNull();
  });

  it("returns null for array input", () => {
    expect(parseCampfirePayload([1, 2, 3])).toBeNull();
  });
});
