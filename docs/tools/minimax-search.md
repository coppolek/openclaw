---
summary: "MiniMax Search via the Coding Plan search API"
read_when:
  - You want to use MiniMax for web_search
  - You need a MiniMax API key for web search
  - You want MiniMax CN/global search host guidance
title: "MiniMax Search"
---

# MiniMax Search

OpenClaw supports MiniMax as a `web_search` provider through the MiniMax
Coding Plan search API. It returns structured search results with titles, URLs,
snippets, and related queries.

## Quick start

When `MINIMAX_API_KEY` is set, OpenClaw auto-detects it and offers MiniMax
Search during web search setup. No separate MCP server or additional install
is needed -- the MiniMax search plugin is built into OpenClaw.

<Note>
  MiniMax web search uses the [Coding Plan search API](https://platform.minimax.io/docs/token-plan/mcp-guide#web_search).
  Your MiniMax API key must have **Token Plan** access for search to work.
  If you haven't subscribed yet, visit the
  [Token Plan subscription page](https://platform.minimax.io/subscribe/token-plan).
</Note>

## Setup

<Steps>
  <Step title="Get a MiniMax API key">
    Create or copy a key from
    [MiniMax Platform](https://platform.minimax.io/user-center/basic-information/interface-key).
    Make sure your account has Token Plan access enabled.
  </Step>
  <Step title="Store the key">
    Set `MINIMAX_API_KEY` in the Gateway environment, or configure via:

    ```bash
    openclaw configure --section web
    ```

    OpenClaw will detect the key and present MiniMax Search as an option.

  </Step>
</Steps>

OpenClaw also accepts the dedicated env aliases `MINIMAX_CODE_PLAN_KEY` and
`MINIMAX_CODING_API_KEY`. All three are checked during auto-detection.

## Config

```json5
{
  plugins: {
    entries: {
      minimax: {
        config: {
          webSearch: {
            apiKey: "sk-...", // optional if MINIMAX_API_KEY is set
            region: "global", // or "cn"
          },
        },
      },
    },
  },
  tools: {
    web: {
      search: {
        provider: "minimax",
      },
    },
  },
}
```

**Environment alternative:** set `MINIMAX_API_KEY` (or `MINIMAX_CODE_PLAN_KEY`)
in the Gateway environment. For a gateway install, put it in `~/.openclaw/.env`.

## Region selection

MiniMax Search uses these endpoints:

- Global: `https://api.minimax.io/v1/coding_plan/search`
- CN: `https://api.minimaxi.com/v1/coding_plan/search`

If `plugins.entries.minimax.config.webSearch.region` is unset, OpenClaw resolves
the region in this order:

1. `tools.web.search.minimax.region` / plugin-owned `webSearch.region`
2. `MINIMAX_API_HOST`
3. `models.providers.minimax.baseUrl`
4. `models.providers.minimax-portal.baseUrl`

That means CN onboarding or `MINIMAX_API_HOST=https://api.minimaxi.com/...`
automatically keeps MiniMax Search on the CN host too.

Even when you authenticated MiniMax through the OAuth `minimax-portal` path,
web search still registers as provider id `minimax`; the OAuth provider base URL
is only used as a region hint for CN/global host selection.

## Supported parameters

MiniMax Search supports:

- `query`
- `count` (OpenClaw trims the returned result list to the requested count)

Provider-specific filters are not currently supported.

## Related

- [Web Search overview](/tools/web) -- all providers and auto-detection
- [MiniMax](/providers/minimax) -- model, image, speech, and auth setup
- [MiniMax web search API reference](https://platform.minimax.io/docs/token-plan/mcp-guide#web_search) -- underlying search API details (external)
