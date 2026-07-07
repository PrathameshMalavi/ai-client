# UCP Angular AI Platform Client

A mock AI platform client that demonstrates the **Universal Commerce Protocol (UCP)** by acting exactly like Google Assistant or ChatGPT would when shopping on a UCP-compliant merchant.

> 📖 For a full technical deep-dive into UCP architecture, REST vs A2A, SpringBoot implementation guidance, and end-to-end request flows, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## What This Client Does

This is a **UCP platform client** (not a storefront). It plays the role of the AI assistant / shopping app that talks to merchants on the user's behalf:

| Action | How It Works |
|--------|-------------|
| **Discovery** | `GET merchant_url/.well-known/ucp` → reads merchant's capabilities |
| **Capability Negotiation** | Computes intersection of platform + merchant capabilities |
| **Identity** | Sends `UCP-Agent: profile="http://localhost:4200/profile/agent_profile.json"` on every request |
| **Catalog Search** | `POST /catalog/search` with natural language query |
| **Checkout** | `POST /checkout-sessions` + `PUT /checkout-sessions/{id}` |
| **Payment** | `POST /checkout-sessions/{id}/complete` with mock payment token |
| **A2A** | `POST /` with `message/send` JSON-RPC 2.0 for AI agent merchants |

---

## Quick Start

### 1. Start the Python UCP Server (REST merchant)

```bash
cd /home/pratham/poc/ucp-sample-implementation/rest/python
./start.sh
# Server runs at http://localhost:8182
```

### 2. Start the Angular Client

```bash
cd /home/pratham/poc/ucp-angular-client
npm install
npm start
# Client runs at http://localhost:4200
```

### 3. Open the App

Navigate to `http://localhost:4200`. The app will automatically discover the flower shop's UCP profile.

---

## Using the Chat Interface

### Without a Gemini API Key (Direct Mode)

Type these commands and the client will call the appropriate UCP endpoints directly:

| What you type | What happens |
|--------------|--------------|
| `show me products` | `POST /catalog/search` |
| `I want roses` | `POST /catalog/search?q=roses` |
| `show my cart` | Displays current checkout |
| `pay` | Starts payment flow |
| `complete` | Completes the checkout |

### With a Gemini API Key (AI-Orchestrated Mode)

Enter your key in the header field. The client will use Gemini to understand natural language and plan UCP actions:

- `"I'd like to order 2 red roses for my friend in Mumbai"` → searches catalog, then guides through checkout
- `"What's the cheapest flower arrangement you have?"` → catalog search with price intent

---

## Switching Merchants

Use the **Merchant** dropdown in the header to switch between:

| Merchant | Type | Port | Requirements |
|----------|------|------|-------------|
| Flower Shop | REST | 8182 | Run `./start.sh` in `rest/python/` |
| Cymbal Retail | A2A | 10999 | Run `uv run business_agent` in `a2a/business_agent/` + Gemini API key |

---

## Architecture

### Key Files

```
src/app/
├── services/
│   ├── agent-communication.service.ts  ← Core client logic (1700+ lines)
│   │   ├── discover()                  ← Fetches merchant UCP profile
│   │   ├── sendMessage()               ← Routes to REST or A2A handler
│   │   ├── handleRestRequest()         ← Gemini planning or direct keyword routing
│   │   ├── directRestFallback()        ← No-key keyword routing mode
│   │   ├── sendA2AMessage()            ← A2A JSON-RPC message/send
│   │   ├── upsertRestCheckout()        ← Create/update REST checkout
│   │   └── completeRestCheckout()      ← Process payment via REST
│   ├── gemini.service.ts               ← Gemini API for NL orchestration
│   ├── merchant-registry.service.ts    ← Configured merchants list
│   └── runtime-config.service.ts       ← Gemini key from localStorage
├── models/types.ts                     ← TypeScript interfaces (UCP types)
├── utils/ucp-profile.ts                ← Profile normalization + capability intersection
└── data/mock-payment-methods.ts        ← Mock Visa/Mastercard payment tokens

public/
├── profile/agent_profile.json          ← This client's UCP profile (capabilities)
└── no-poduct-image.png                 ← Fallback product image
```

### How Capability Negotiation Works

```typescript
// After fetching the merchant's profile:
const merchantCapabilities = ["checkout", "fulfillment", "catalog.search"];
const clientCapabilities   = ["checkout", "fulfillment", "catalog.search", "buyer_consent"];
const negotiated           = intersectCapabilities(client, merchant);
// = ["checkout", "fulfillment", "catalog.search"]

// The client only drives features in the negotiated set.
// e.g., buyer_consent form won't show because merchant doesn't support it.
```

### UCP-Agent Header

Every request to the merchant includes:
```
UCP-Agent: profile="http://localhost:4200/profile/agent_profile.json"; version="2026-01-23"
```

The merchant reads this, fetches the client profile, and runs its own capability negotiation server-side.

---

## Testing Against Your Own UCP Server

1. Add your server to `merchant-registry.service.ts`:
   ```typescript
   {
     id: 'my-springboot-server',
     name: 'My SpringBoot UCP Server',
     url: 'http://localhost:8080',
     type: 'rest'
   }
   ```

2. Ensure your server exposes `GET /.well-known/ucp` with a valid UCP profile

3. Run the conformance tests first:
   ```bash
   cd /home/pratham/poc/conformance
   python -m pytest . --server-url=http://localhost:8080 -v
   ```

4. Use this Angular client as a visual integration test harness

---

## What This Client Is NOT

- Not the merchant — it never owns product/checkout state
- Not a real Credential Provider — uses hardcoded mock payment tokens
- Not production-ready — CORS, security, and auth are all dev-only

---

## Reference

| Resource | Location |
|----------|----------|
| UCP Specification | `../ucp-official/` or https://ucp.dev |
| Schema definitions | `../ucp-schema/` |
| Conformance tests | `../conformance/` |
| Sample implementations | `../ucp-sample-implementation/` |
| Architecture deep-dive | `./ARCHITECTURE.md` |
