import { describe, expect, it } from "vitest";
import { isCampfireUrlInWorkspaceScope, isValidCampfireUrl } from "./workspace-url.js";

describe("isValidCampfireUrl", () => {
  it("accepts valid absolute URLs", () => {
    expect(isValidCampfireUrl("https://campfire.example.com/rooms/7/key/messages")).toBe(true);
    expect(isValidCampfireUrl("http://localhost:3000/rooms/1/key/messages")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isValidCampfireUrl("/rooms/7/key/messages")).toBe(false);
  });

  it("rejects non-URL strings", () => {
    expect(isValidCampfireUrl("not-a-url")).toBe(false);
    expect(isValidCampfireUrl("")).toBe(false);
  });
});

describe("isCampfireUrlInWorkspaceScope", () => {
  it("allows target under the same origin", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://campfire.example.com/rooms/7/key/messages",
        "https://campfire.example.com",
      ),
    ).toBe(true);
  });

  it("allows target under a workspace path prefix", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://3.basecamp.com/1234567/buckets/7/chats/88/messages/99",
        "https://3.basecamp.com/1234567",
      ),
    ).toBe(true);
  });

  it("blocks targets under a different workspace path", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://3.basecamp.com/7654321/buckets/7/chats/88/messages/99",
        "https://3.basecamp.com/1234567",
      ),
    ).toBe(false);
  });

  it("blocks targets on a different origin", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://attacker.example.net/rooms/7/key/messages",
        "https://campfire.example.com",
      ),
    ).toBe(false);
  });

  it("blocks same-workspace URLs that are not Campfire message endpoints", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://campfire.example.com/admin",
        "https://campfire.example.com",
      ),
    ).toBe(false);
  });

  it("blocks same-basecamp-workspace URLs outside message endpoints", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://3.basecamp.com/1234567/admin",
        "https://3.basecamp.com/1234567",
      ),
    ).toBe(false);
  });

  it("returns false when either URL is invalid", () => {
    expect(isCampfireUrlInWorkspaceScope("not-a-url", "https://campfire.example.com")).toBe(false);
    expect(isCampfireUrlInWorkspaceScope("https://campfire.example.com/rooms/7", "not-a-url")).toBe(
      false,
    );
  });

  it("handles trailing slashes in base URL", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://campfire.example.com/rooms/7/key/messages",
        "https://campfire.example.com/",
      ),
    ).toBe(true);
  });

  it("blocks path prefix collisions", () => {
    expect(
      isCampfireUrlInWorkspaceScope(
        "https://3.basecamp.com/12345678/buckets/7/chats/88",
        "https://3.basecamp.com/1234567",
      ),
    ).toBe(false);
  });
});
