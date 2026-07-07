# UCP Architecture Deep Dive

## Table of Contents

1. [What Each Repository Is](#1-what-each-repository-is)
2. [UCP Core Concepts](#2-ucp-core-concepts)
3. [How UCP REST Works — End-to-End](#3-how-ucp-rest-works--end-to-end)
4. [How UCP A2A Works — End-to-End](#4-how-ucp-a2a-works--end-to-end)
5. [This Angular Client Explained](#5-this-angular-client-explained)
6. [Building a SpringBoot UCP Server](#6-building-a-springboot-ucp-server)
7. [REST vs A2A — Which to Use?](#7-rest-vs-a2a--which-to-use)
8. [Conformance & Schema Repos](#8-conformance--schema-repos)

---

## 1. What Each Repository Is

### `ucp-official` — The Specification (not runnable code)

This is the **UCP rulebook** — like an RFC or OpenAPI specification.

```
ucp-official/
├── source/
│   ├── schemas/        ← JSON Schema definitions (Checkout, LineItem, Payment, etc.)
│   ├── services/       ← Service spec files (shopping service, etc.)
│   └── handlers/       ← Payment handler specs
├── docs/               ← Markdown docs that render at https://ucp.dev
├── main.py             ← Script to BUILD the doc website (not a server)
└── mkdocs.yml          ← MkDocs config for the doc site
```

**What it contains:**
- The canonical data shapes for `Checkout`, `LineItem`, `PaymentInstrument`, `OrderConfirmation`
- The protocol rules: what headers to send, what endpoints to expose, what state transitions are valid
- Human-readable documentation explaining each concept

**You don't run this repo.** You read it to understand the rules, then implement them.

---

### `ucp-sample-implementation` — Working Code Examples

Two complete, runnable implementations of UCP:

```
ucp-sample-implementation/
├── rest/
│   └── python/                  ← A Python/FastAPI server (a flower shop)
│       ├── server/              ← The UCP merchant server (runs on port 8182)
│       │   ├── server.py        ← Entry point
│       │   ├── routes/          ← HTTP handlers (checkout, discovery, catalog, orders)
│       │   ├── services/        ← Business logic layer
│       │   └── db.py            ← SQLite persistence
│       └── client/
│           └── flower_shop/
│               └── simple_happy_path_client.py  ← Mock AI client script
└── a2a/
    ├── business_agent/          ← Cymbal Retail (AI-powered merchant, runs on port 10999)
    │   └── src/business_agent/
    │       ├── agent.py         ← Gemini LLM + 8 UCP shopping tools
    │       ├── store.py         ← In-memory product/checkout/order store
    │       └── data/
    │           ├── products.json    ← Product catalog
    │           └── ucp.json         ← Merchant's UCP profile
    └── chat-client/             ← React web UI (mock AI client, runs on port 3000)
        ├── App.tsx              ← Sends A2A JSON-RPC messages, renders UCP data
        └── mocks/
            └── credentialProviderProxy.ts  ← Fake payment cards (VISA 8888, AMEX 1111)
```

---

### `conformance` — Official Integration Tests

The official test suite that validates a UCP server implementation.

```
conformance/
├── checkout_lifecycle_test.py   ← Tests: incomplete → ready_for_complete → completed
├── fulfillment_test.py          ← Tests: shipping destinations and option selection
├── order_test.py                ← Tests: order creation and confirmation
├── business_logic_test.py       ← Tests: pricing, discounts, quantities
├── protocol_test.py             ← Tests: headers, idempotency, error codes
├── validation_test.py           ← Tests: field validation and schema conformance
├── webhook_test.py              ← Tests: webhook delivery and retries
└── integration_test_utils.py   ← Shared HTTP client + assertion helpers
```

**Run these against your SpringBoot server to verify it's UCP-compliant:**
```bash
cd conformance
python -m pytest checkout_lifecycle_test.py --server-url=http://localhost:8080
```

---

### `ucp-schema` — JSON Schema Definitions (standalone)

The JSON Schema files that define UCP data types. Written in Rust/JSON, used to validate request/response bodies.

```
ucp-schema/
├── src/              ← Rust library that parses and validates UCP schemas
├── fixtures/         ← Example valid/invalid JSON for each schema type
└── tests/            ← Schema validation tests
```

Use this to validate your SpringBoot server's request/response bodies against the official schema.

---

### `ucp-angular-client` (this repo) — Mock AI Platform Client

A TypeScript/Angular web application that acts as a **UCP platform client** — the same role Google Assistant or ChatGPT would play in the real world.

```
ucp-angular-client/
├── src/app/
│   ├── services/
│   │   ├── agent-communication.service.ts  ← Core UCP client logic (REST + A2A)
│   │   ├── merchant-registry.service.ts    ← Known merchants list
│   │   ├── gemini.service.ts               ← Gemini API for NL orchestration
│   │   └── runtime-config.service.ts       ← Gemini API key management
│   ├── models/types.ts                     ← TypeScript interfaces for UCP types
│   ├── utils/ucp-profile.ts                ← Profile parsing + capability intersection
│   └── data/mock-payment-methods.ts        ← Mock VISA/Mastercard payment tokens
└── public/
    ├── profile/agent_profile.json          ← This client's UCP capabilities profile
    └── no-poduct-image.png                 ← Fallback product image
```

---

## 2. UCP Core Concepts

### The Players

| Role | Description | In Our Setup |
|------|-------------|--------------|
| **Platform / AI Client** | The user-facing app that talks to merchants | This Angular app |
| **Merchant / Business** | Sells products, manages checkout | Python flower shop (REST) or Cymbal Retail (A2A) |
| **Payment Service Provider (PSP)** | Processes actual money | Mocked with fake tokens |
| **Credential Provider** | Holds user's saved cards | Mocked with DEMO_PAYMENT_METHODS |

### The UCP Profile (Capability Declaration)

Every participant publishes a **UCP Profile** — a JSON document declaring what they support.

**Merchant profile** — served at `GET /.well-known/ucp`:
```json
{
  "ucp": {
    "version": "2026-01-23",
    "capabilities": {
      "dev.ucp.shopping.checkout": [{ "version": "2026-01-23", ... }],
      "dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23", ... }],
      "dev.ucp.shopping.catalog.search": [{ "version": "2026-01-23", ... }]
    },
    "payment_handlers": {
      "dev.mock.payment_handler": [{ "id": "mock_payment_handler", ... }]
    }
  }
}
```

**Client profile** — served at `GET /profile/agent_profile.json` (by this Angular app):
```json
{
  "ucp": {
    "version": "2026-01-23",
    "capabilities": {
      "dev.ucp.shopping.checkout": [{ "version": "2026-01-23" }],
      "dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23" }],
      "dev.ucp.shopping.catalog.search": [{ "version": "2026-01-23" }]
    },
    "payment_handlers": {
      "dev.mock.payment_handler": [{ "id": "mock_payment_handler" }]
    }
  }
}
```

### Capability Negotiation

On every session, the client computes the **intersection** of what both sides support:

```
Merchant supports: [checkout, fulfillment, catalog.search, discount]
Client supports:   [checkout, fulfillment, catalog.search, buyer_consent]
─────────────────────────────────────────────────────────────────────
Negotiated:        [checkout, fulfillment, catalog.search]
```

The client only uses features in the negotiated set. See `ucp-profile.ts: intersectCapabilities()`.

### The UCP-Agent Header

**Every** HTTP request the client sends to the merchant MUST include:
```
UCP-Agent: profile="https://client.example.com/profile/agent_profile.json"; version="2026-01-23"
```

This tells the merchant which client is talking to it and where to fetch its capabilities.

### Checkout State Machine

```
[nothing]
    │ POST /checkout-sessions
    ▼
[incomplete]         ← can update: add items, set buyer, set fulfillment
    │ all required fields filled
    ▼
[ready_for_complete] ← price is locked, payment token required
    │ POST /checkout-sessions/{id}/complete
    ▼
[completed]          ← order placed, immutable
```

---

## 3. How UCP REST Works — End-to-End

### The Full Request Journey

Here is what happens at each hop when a user types "show me roses":

```
User types: "show me roses"
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Angular Client (this app, localhost:4200)                       │
│                                                                  │
│  1. sendMessage(merchant, "show me roses")                       │
│     → adds user message to chat                                  │
│                                                                  │
│  2. handleRestRequest(merchant, text)                            │
│     → if Gemini key: planRestAction(text)                        │
│       Sends to Gemini API:                                       │
│         "Given merchant capabilities [...], what UCP action?"    │
│       Gemini returns: { actions: [{ type: "SEARCH_CATALOG",      │
│                                    query: "roses" }] }           │
│     → if no Gemini key: directRestFallback(text)                 │
│       Keyword match → SEARCH_CATALOG                             │
│                                                                  │
│  3. searchCatalog(merchant, "roses")                             │
│     → POST http://localhost:8182/catalog/search                  │
│       Headers: {                                                  │
│         "UCP-Agent": "profile=http://localhost:4200/profile/...",│
│         "Idempotency-Key": "<uuid>",                             │
│         "Request-Id": "<uuid>"                                    │
│       }                                                          │
│       Body: { "query": "roses" }                                 │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ HTTP POST
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python Flower Shop Server (localhost:8182)                      │
│                                                                  │
│  routes/catalog.py:                                              │
│    1. Validates UCP-Agent header (reads client profile URL)      │
│    2. Passes query to services/catalog_service.py               │
│    3. Searches SQLite database for products matching "roses"     │
│    4. Returns UCP-formatted product list:                        │
│       {                                                          │
│         "products": [                                            │
│           { "@type": "Product", "name": "Rose Bouquet",         │
│             "offers": { "price": 2499, "priceCurrency": "USD" } }│
│         ]                                                        │
│       }                                                          │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ HTTP 200 JSON
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  Angular Client (response handling)                              │
│                                                                  │
│  normalizeProduct(rawProduct)                                    │
│    → maps UCP product schema → internal Product interface        │
│  addMessage({ role: 'assistant', products: [...] })              │
│    → Angular renders product cards in the chat                   │
└─────────────────────────────────────────────────────────────────┘
```

### The Checkout Request Journey

After the user clicks "Add to Checkout":

```
User clicks "Add to Checkout" on Rose Bouquet (id: "bouquet_roses")
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Angular Client                                                  │
│                                                                  │
│  upsertRestCheckout(merchant, [{ id: "bouquet_roses" }])         │
│                                                                  │
│  If no existing checkout:                                        │
│  → POST http://localhost:8182/checkout-sessions                  │
│    Headers: { "UCP-Agent": "...", "Idempotency-Key": "..." }     │
│    Body: {                                                        │
│      "currency": "USD",                                          │
│      "buyer": { "full_name": "John Doe", "email": "..." },       │
│      "payment": { "handlers": [...merchant payment handlers] },  │
│      "line_items": [{ "item": { "id": "bouquet_roses" },         │
│                       "quantity": 1 }]                           │
│    }                                                             │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python Server                                                   │
│                                                                  │
│  routes/ucp_implementation.py:                                   │
│    1. Validates request body against UCP schema                  │
│    2. Resolves product "bouquet_roses" from database             │
│    3. Calculates line item totals (price × qty)                  │
│    4. Creates checkout record in SQLite                          │
│    5. Returns Checkout object:                                   │
│       {                                                          │
│         "id": "checkout_abc123",                                 │
│         "status": "incomplete",         ← needs fulfillment      │
│         "currency": "USD",                                       │
│         "line_items": [{                                         │
│           "id": "li_1",                                          │
│           "item": { "id": "bouquet_roses", "title": "Rose..." }, │
│           "quantity": 1,                                         │
│           "totals": [{ "type": "total", "amount": 2499 }]        │
│         }],                                                      │
│         "totals": [{ "type": "total", "amount": 2499 }],         │
│         "fulfillment": {                                         │
│           "methods": [{                                          │
│             "id": "method_1",                                    │
│             "type": "shipping",                                  │
│             "destinations": [...]  ← saved addresses             │
│           }]                                                     │
│         }                                                        │
│       }                                                          │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ HTTP 201 JSON
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  Angular Client                                                  │
│                                                                  │
│  normalizeCheckout(response)                                     │
│    → maps UCP Checkout → internal Checkout interface             │
│  presentCheckoutGuidance(checkout, "I created a checkout...")    │
│    → adds checkout card to chat                                  │
│    → buildCheckoutGuidance() sets pendingCheckoutStep            │
│      ("fulfillment_destination" if shipping address needed)      │
└─────────────────────────────────────────────────────────────────┘
```

### The Payment Request Journey

After fulfillment is set and user clicks "Complete Payment":

```
┌─────────────────────────────────────────────────────────────────┐
│  Angular Client                                                  │
│                                                                  │
│  completeRestCheckout(merchant, checkout, paymentMethod)         │
│                                                                  │
│  → POST http://localhost:8182/checkout-sessions/{id}/complete    │
│    Headers: { "UCP-Agent": "...", "Idempotency-Key": "..." }     │
│    Body: {                                                        │
│      "payment": {                                                │
│        "instruments": [{                                         │
│          "id": "instr_1",                                        │
│          "handler_id": "mock_payment_handler",                   │
│          "type": "card",                                         │
│          "display": { "brand": "Visa", "last_digits": "1234" }, │
│          "credential": {                                         │
│            "type": "token",                                      │
│            "token": "success_token"   ← mock token (no real $)   │
│          },                                                      │
│          "billing_address": { "street_address": "123 Main St" } │
│        }]                                                        │
│      },                                                          │
│      "risk_signals": { "ip": "127.0.0.1", "browser": "..." }    │
│    }                                                             │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python Server                                                   │
│                                                                  │
│  1. Looks up the payment handler "mock_payment_handler"          │
│  2. Calls the mock payment processor with the token              │
│     ("success_token" always succeeds)                            │
│  3. Creates an Order record in SQLite                            │
│  4. Updates Checkout status → "completed"                        │
│  5. Returns completed Checkout with order:                       │
│     {                                                            │
│       "status": "completed",                                     │
│       "order": {                                                 │
│         "id": "order_xyz789",                                    │
│         "permalink_url": "https://shop.example.com/orders/..."   │
│       }                                                          │
│     }                                                            │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  Angular Client                                                  │
│                                                                  │
│  addOrReplaceCheckoutMessage("Payment completed. Order ...")     │
│    → updates checkout card to show "Order Confirmed"             │
│    → shows "View Order" link if permalink_url is present         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. How UCP A2A Works — End-to-End

The A2A flow adds the **Agent-to-Agent** protocol layer on top of UCP data types.

### Discovery

```
Client                           Business Agent (port 10999)
  │                                      │
  │── GET /.well-known/agent-card.json ──▶│
  │                                      │ Returns: AgentCard JSON
  │◀─ { name, description, url, ext } ──│
  │                                      │
  │── GET /.well-known/ucp ─────────────▶│
  │◀─ { ucp: { capabilities, handlers }} │ UCP profile
```

### Message Flow (A2A JSON-RPC)

```
User types: "show me cookies"
       │
       ▼
Angular Client:
  sendA2AMessage(merchant, [{ type: 'text', text: 'show me cookies' }])
  
  → POST http://localhost:10999/
    Headers: {
      "Content-Type": "application/json",
      "X-A2A-Extensions": "https://ucp.dev/2026-01-23/...",
      "UCP-Agent": "profile=http://localhost:4200/profile/agent_profile.json"
    }
    Body (A2A JSON-RPC 2.0):
    {
      "jsonrpc": "2.0",
      "id": "<uuid>",
      "method": "message/send",
      "params": {
        "message": {
          "role": "user",
          "messageId": "<uuid>",
          "kind": "message",
          "parts": [{ "type": "text", "text": "show me cookies" }]
        }
      }
    }
       │
       ▼
Business Agent (Cymbal Retail):
  A2A Server (Starlette) receives JSON-RPC
       │
       ▼
  Agent Executor (A2A ↔ ADK bridge):
    - Decodes A2A message to ADK content
    - Extracts UCP-Agent header → loads client's UCP profile
    - Runs capability negotiation
       │
       ▼
  ADK Agent (Gemini 3.0 Flash + 8 tools):
    - Understands: "show me cookies"
    - Calls tool: search_products("cookies")
       │
       ▼
  RetailStore (in-memory):
    - Searches products.json for cookies
    - Returns list of matching Product objects
       │
       ▼
  ADK Agent formats response:
    - Creates A2A response with UCP data parts:
      {
        "parts": [
          { "text": "Here are the cookies I found:" },
          { "data": {
              "a2a.product_results": {
                "results": [...products...],
                "content": "Found 3 cookies available"
              }
          }}
        ]
      }
       │
       ▼
Angular Client:
  parseA2AResponse(data.result)
    - Extracts text parts → content
    - Extracts "a2a.product_results" → products
    - Renders product cards in chat
```

---

## 5. This Angular Client Explained

### What it Is

This Angular app simulates what a real AI platform client (Google Assistant, ChatGPT) would do when integrated with UCP merchants. It demonstrates all three phases:

1. **Discovery** — fetches the merchant's UCP profile, computes the capability intersection
2. **Commerce** — searches catalog, creates checkout, handles fulfillment
3. **Payment** — presents mock payment cards, sends payment token to merchant

### REST vs A2A Mode

The same `AgentCommunicationService` handles both. Mode is determined by `merchant.type`:

- `'rest'` → direct HTTP calls to UCP REST endpoints + optional Gemini AI planning
- `'a2a'` → JSON-RPC 2.0 `message/send` calls to the A2A agent + UCP response parsing

### Without a Gemini API Key (Direct REST Mode)

When no API key is configured, the client uses keyword-based routing:
- `"show products"` / `"search"` / `"find"` → `POST /catalog/search`
- `"pay"` / `"complete"` / `"payment"` → starts payment flow
- `"cart"` / `"checkout"` / `"order"` → shows current checkout state

This proves UCP is not AI-dependent — it's just an HTTP commerce standard.

### With a Gemini API Key (AI-Orchestrated REST Mode)

The `GeminiService` acts as an NL router: it receives the user's message + context (merchant capabilities, visible products, current checkout) and returns a structured action plan like:
```json
{ "actions": [{ "type": "SEARCH_CATALOG", "query": "roses", "mode": "show" }] }
```

The Angular client then executes those actions against the merchant's UCP endpoints.

---

## 6. Building a SpringBoot UCP Server

### Is It Just a Pass-Through Proxy?

**No — it's a full business implementation.** A UCP server is not a proxy. It IS the business logic layer. Here's what it does:

```
┌──────────────────────────────────────────────────────────────────┐
│                SpringBoot UCP Server                              │
│                                                                   │
│  UCP Layer (exposes standard UCP REST endpoints):                 │
│    GET  /.well-known/ucp           → serve UCP profile JSON       │
│    POST /catalog/search            → delegate to product service  │
│    POST /checkout-sessions         → create checkout in DB        │
│    PUT  /checkout-sessions/{id}    → update checkout state        │
│    POST /checkout-sessions/{id}/complete → process payment        │
│    GET  /orders/{id}               → fetch order details          │
│                                                                   │
│  Business Logic Layer:                                            │
│    - Validates UCP-Agent header, fetches client profile           │
│    - Runs capability negotiation (only process what's agreed)     │
│    - Resolves products from YOUR backend                          │
│    - Calculates prices, discounts, taxes                          │
│    - Calls YOUR payment provider with the token                   │
│    - Creates/updates orders in YOUR database                      │
│                                                                   │
│  Your Existing Backend APIs:                                      │
│    → Product Catalog Service (REST, GraphQL, etc.)                │
│    → Payment Gateway (Stripe, Braintree, Adyen, etc.)             │
│    → Order Management System (OMS)                                │
│    → Inventory Service                                            │
└──────────────────────────────────────────────────────────────────┘
```

### Example SpringBoot Structure

```java
// DiscoveryController.java
@RestController
public class DiscoveryController {
    
    @GetMapping("/.well-known/ucp")
    public UcpProfile getProfile() {
        // Return your server's capabilities declaration
        return UcpProfile.builder()
            .version("2026-01-23")
            .capability("dev.ucp.shopping.checkout", "2026-01-23")
            .capability("dev.ucp.shopping.fulfillment", "2026-01-23")
            .capability("dev.ucp.shopping.catalog.search", "2026-01-23")
            .paymentHandler("mock_payment_handler", "dev.mock.payment_handler")
            .build();
    }
}

// CheckoutController.java
@RestController
@RequestMapping("/checkout-sessions")
public class CheckoutController {
    
    @PostMapping
    public ResponseEntity<Checkout> createCheckout(
        @RequestHeader("UCP-Agent") String ucpAgentHeader,
        @RequestBody CreateCheckoutRequest request
    ) {
        // 1. Parse UCP-Agent header to get client profile URL
        String clientProfileUrl = UcpAgentHeader.parseProfileUrl(ucpAgentHeader);
        
        // 2. Fetch client profile and compute capability intersection
        UcpProfile clientProfile = profileService.fetch(clientProfileUrl);
        Set<String> negotiated = capabilityNegotiator.intersect(
            serverCapabilities, clientProfile.getCapabilities()
        );
        
        // 3. Resolve products from YOUR product catalog service
        List<LineItem> lineItems = productService.resolveItems(request.getLineItems());
        
        // 4. Create checkout record in YOUR database
        Checkout checkout = checkoutRepository.create(
            lineItems, request.getBuyer(), request.getCurrency()
        );
        
        return ResponseEntity.status(201).body(checkout);
    }
    
    @PostMapping("/{id}/complete")
    public ResponseEntity<Checkout> completeCheckout(
        @PathVariable String id,
        @RequestBody CompleteCheckoutRequest request
    ) {
        // 1. Fetch checkout from database
        Checkout checkout = checkoutRepository.findById(id);
        
        // 2. Extract payment instrument from request
        PaymentInstrument instrument = request.getPayment().getInstruments().get(0);
        
        // 3. Call YOUR payment provider with the credential token
        // The token was generated by the client's Credential Provider (e.g. Google Pay)
        PaymentResult result = stripeService.processToken(
            instrument.getCredential().getToken(),
            checkout.getTotalAmount()
        );
        
        // 4. Create order in YOUR OMS
        Order order = orderService.create(checkout, result);
        
        // 5. Update checkout status → "completed"
        checkout.setStatus("completed");
        checkout.setOrder(order);
        checkoutRepository.save(checkout);
        
        return ResponseEntity.ok(checkout);
    }
}
```

### Key SpringBoot Implementation Steps

1. **Add UCP-Agent header interceptor** — validate every request has the header
2. **Create `/.well-known/ucp` endpoint** — return your capability profile as JSON
3. **Implement `/catalog/search`** — query your product catalog, return Schema.org `Product` objects
4. **Implement `/checkout-sessions` CRUD** — map to your order management
5. **Implement `/checkout-sessions/{id}/complete`** — integrate with your PSP
6. **Handle idempotency** — use the `Idempotency-Key` header to deduplicate retries
7. **Run conformance tests** — `cd conformance && python -m pytest --server-url=http://localhost:8080`

---

## 7. REST vs A2A — Which to Use?

| Dimension | REST | A2A |
|-----------|------|-----|
| **What it is** | Standard HTTP/JSON APIs | JSON-RPC 2.0 + AI agent protocol |
| **Discovery** | `GET /.well-known/ucp` → UCP Profile | `GET /.well-known/agent-card.json` + `GET /.well-known/ucp` |
| **Client sends** | HTTP requests to specific endpoints | `POST /` with `message/send` JSON-RPC |
| **AI on merchant** | Not needed | Google ADK + Gemini LLM |
| **Best for** | Classic integrations, microservices | Conversational shopping, agent ecosystems |
| **Complexity** | Low — just REST | High — requires ADK + Gemini API key |
| **Your POC** | ✅ Use this (Python server is running) | Optional — needs Gemini key |

**For the SpringBoot POC:** Start with REST. It's simpler, fully testable with conformance tests, and demonstrates UCP without requiring AI infrastructure.

---

## 8. Conformance & Schema Repos

### Running the Conformance Tests

```bash
# Start your UCP server first (e.g. at port 8182)
cd ucp-sample-implementation/rest/python && ./start.sh

# In another terminal:
cd conformance
pip install -r requirements.txt  # or: uv sync

# Run all tests against the sample server
python -m pytest . -v

# Run against your SpringBoot server
python -m pytest . -v --server-url=http://localhost:8080
```

### What the Tests Validate

- **Checkout lifecycle** — correct status transitions (incomplete → ready → completed)
- **Idempotency** — duplicate requests with same Idempotency-Key return same response
- **Fulfillment** — shipping methods, destinations, option selection
- **Business logic** — pricing calculations, discounts, quantities
- **Protocol** — correct headers, error codes, response shapes
- **Validation** — invalid inputs return proper 4xx errors with `{ detail, code }` bodies

---

*This document is maintained in `ucp-angular-client/ARCHITECTURE.md`.  
Last updated: July 2026.*
