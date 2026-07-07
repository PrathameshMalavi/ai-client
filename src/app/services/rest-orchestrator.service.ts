import { Injectable, inject } from '@angular/core';
import { ChatStateService } from './chat-state.service';
import { CheckoutStateService } from './checkout-state.service';
import { UcpNetworkService } from './ucp-network.service';
import { GeminiService } from './gemini.service';
import { Merchant, Checkout, Product } from '../models/types';

@Injectable({
  providedIn: 'root'
})
export class RestOrchestratorService {
  private chat = inject(ChatStateService);
  private checkoutState = inject(CheckoutStateService);
  private network = inject(UcpNetworkService);
  private gemini = inject(GeminiService);

  public latestCatalogProducts: Product[] = [];

  public async handleRestRequest(
    merchant: Merchant,
    text: string,
    capabilities: string[],
    beginPaymentFn: (merchant: Merchant, checkout: Checkout) => Promise<void>,
    upsertRestCheckoutFn: (merchant: Merchant, items: Array<{ id: string; quantity?: number }>) => Promise<void>,
    setFulfillmentDestinationAddressFn: (merchant: Merchant, checkout: Checkout, address: string) => Promise<void>
  ) {
    if (!this.gemini.isConfigured()) {
      await this.directRestFallback(merchant, text, capabilities, beginPaymentFn);
      return;
    }

    const plan = await this.planRestAction(text, capabilities);
    if (!plan) {
      this.chat.addAssistantText('I could not decide the next UCP action from that request.');
      return;
    }

    if (plan.reply) {
      this.chat.addAssistantText(plan.reply);
    }

    for (const action of plan.actions ?? []) {
      const type = action?.type;
      const checkout = this.checkoutState.getActiveCheckout();

      if (type === 'SEARCH_CATALOG') {
        if (!capabilities.includes('dev.ucp.shopping.catalog.search')) {
          this.chat.addAssistantText(
            'This merchant does not advertise UCP catalog search, so I cannot browse products through the REST capability surface.'
          );
          continue;
        }

        const products = await this.searchCatalog(merchant, action.query ?? null, action.mode !== 'create_checkout');

        if (action.mode === 'create_checkout') {
          if (products.length === 1) {
            await upsertRestCheckoutFn(merchant, [{ id: products[0].id, quantity: action.quantity ?? 1 }]);
            continue;
          }

          this.chat.addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: products.length
              ? 'I found multiple merchant products. Pick the exact product card to continue checkout.'
              : 'The merchant catalog search did not return a product I can checkout.',
            timestamp: new Date(),
            products
          });
        }
        continue;
      }

      if (type === 'CREATE_CHECKOUT' || type === 'ADD_TO_CHECKOUT') {
        await upsertRestCheckoutFn(merchant, action.items ?? []);
        continue;
      }

      if (type === 'SHOW_CHECKOUT') {
        if (checkout) {
          this.checkoutState.presentCheckoutGuidance(checkout, 'Here is the current checkout state from the merchant.');
        } else {
          this.chat.addAssistantText('There is no active checkout yet. Add a product first!');
        }
        continue;
      }

      if (type === 'START_PAYMENT') {
        if (checkout) {
          await beginPaymentFn(merchant, checkout);
        } else {
          this.chat.addAssistantText('There is no active checkout yet. I need a checkout before I can drive payment.');
        }
        continue;
      }

      if (type === 'SET_SHIPPING_ADDRESS') {
        if (checkout) {
          if (action.address) {
            this.chat.setLoading(true, 'Updating shipping address...');
            await setFulfillmentDestinationAddressFn(merchant, checkout, action.address);
          } else {
            this.chat.addAssistantText('Please provide a full shipping address.');
          }
        } else {
          this.chat.addAssistantText('There is no active checkout to set an address for.');
        }
        continue;
      }

      if (type === 'CHAT' || type === 'NOOP') {
        continue;
      }
    }
  }

  private async planRestAction(userText: string, capabilityNames: string[]) {
    const visibleProducts = this.latestCatalogProducts.map((p) => ({
      id: p.id,
      title: p.title
    }));
    
    const latestCheckout = this.checkoutState.getActiveCheckout();
    const checkoutSummary = latestCheckout
      ? {
          id: latestCheckout.id,
          status: latestCheckout.status,
          items: latestCheckout.line_items.map((li) => ({
            id: li.item.id,
            title: li.item.title,
            qty: li.quantity
          }))
        }
      : null;

    const prompt = `
You are an AI shopping assistant embedded in a UCP (Universal Commerce Protocol) platform client.
You help shoppers buy products from merchants. You must ALWAYS respond — you are like ChatGPT for shopping.

Merchant UCP capabilities:
${JSON.stringify(capabilityNames)}

Products already shown to the user:
${JSON.stringify(visibleProducts)}

Active checkout:
${JSON.stringify(checkoutSummary)}

## RULES

1. ALWAYS set "reply" to a helpful, friendly, natural assistant message.
   - For greetings, casual chat, or unclear messages → use CHAT action, reply normally.
   - For commerce intents → use the appropriate UCP action AND a helpful reply.

2. For SEARCH_CATALOG:
   - "query" must be SHORT (1-3 keywords MAX). Extract the product type only.
   - "show me all products" / "what do you have" / "show everything" → query: null (returns all)
   - "show me roses" → query: "roses"
   - "I want a red bouquet" → query: "bouquet"
   - "do you have flowers" → query: null (browse all)

3. For CREATE_CHECKOUT or ADD_TO_CHECKOUT → only use known product IDs from the list above.

4. If the user asks to pay / complete / confirm → START_PAYMENT.

5. If the user provides a shipping or delivery address → SET_SHIPPING_ADDRESS.

6. Only use capabilities the merchant advertises.

## OUTPUT FORMAT (JSON only, no markdown)
{
  "reply": "Your friendly assistant message here",
  "actions": [
    { "type": "SEARCH_CATALOG", "query": "roses" | null, "mode": "show" | "create_checkout", "quantity": 1 },
    { "type": "CREATE_CHECKOUT", "items": [{ "id": "product_id", "quantity": 1 }] },
    { "type": "ADD_TO_CHECKOUT", "items": [{ "id": "product_id", "quantity": 1 }] },
    { "type": "SHOW_CHECKOUT" },
    { "type": "SET_SHIPPING_ADDRESS", "address": "Mumbai India" },
    { "type": "START_PAYMENT" },
    { "type": "CHAT" }
  ]
}

Shopper message: ${userText}
`;

    const rawResponse = await this.gemini.generateResponse(prompt, userText);
    try {
      const cleanJson = rawResponse
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      return JSON.parse(cleanJson);
    } catch {
      return {
        reply: rawResponse,
        actions: [{ type: 'CHAT' }]
      };
    }
  }

  public async searchCatalog(merchant: Merchant, query: string | null, emitMessage = true): Promise<Product[]> {
    const products = await this.network.searchCatalog(merchant, query);
    this.latestCatalogProducts = products;

    if (emitMessage) {
      this.chat.addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: products.length
          ? 'Here are the products returned by the merchant catalog.'
          : 'The merchant catalog search completed, but it returned no products.',
        timestamp: new Date(),
        products
      });
    }
    return products;
  }

  private async directRestFallback(
    merchant: Merchant, 
    text: string, 
    capabilities: string[],
    beginPaymentFn: (merchant: Merchant, checkout: Checkout) => Promise<void>
  ) {
    const lower = text.toLowerCase().trim();

    if (/^(hi|hello|hey|howdy|greetings|sup|yo|good morning|good afternoon|good evening)[\s!?.]*$/.test(lower)) {
      this.chat.addAssistantText(
        "Hello! I'm your UCP shopping assistant. I can help you browse products, add items to your cart, and complete your order. Try saying \"show me products\" to get started!"
      );
      return;
    }

    const checkout = this.checkoutState.getActiveCheckout();

    if (/\b(pay|payment|complete|confirm|finish)\b/.test(lower)) {
      if (checkout) {
        await beginPaymentFn(merchant, checkout);
      } else {
        this.chat.addAssistantText(
          'There is no active checkout yet. Search for products first, then add one to start a checkout.'
        );
      }
      return;
    }

    if (/\b(cart|checkout|order|summary)\b/.test(lower) && !/\b(search|find|show me|products|flowers)\b/.test(lower)) {
      if (checkout) {
        this.checkoutState.presentCheckoutGuidance(checkout, 'Here is your current checkout from the merchant.');
      } else {
        this.chat.addAssistantText("No checkout started yet. Search for products and click 'Add to Checkout'.");
      }
      return;
    }

    if (capabilities.includes('dev.ucp.shopping.catalog.search')) {
      const searchQuery = this.extractSearchKeyword(lower);
      const buyIntent = /\b(buy|order|i want|get me|purchase|add)\b/.test(lower);

      await this.searchCatalog(merchant, searchQuery, true);

      if (buyIntent && searchQuery) {
        this.chat.addAssistantText("Click 'Add to Checkout' on a product above to start your order.");
      }
      return;
    }

    this.chat.addAssistantText(
      '⚠️ Natural language understanding is limited without a Gemini API key. ' +
      'Add your key in the header above for full AI orchestration. ' +
      'Without it, you can still navigate by clicking buttons on products and checkout summaries if they are visible.'
    );
  }

  private extractSearchKeyword(lower: string): string | null {
    const showAll = /\b(all|everything|any|what|every|list|catalogue|catalog)\b/.test(lower) ||
      /\b(show me (the )?(all|products|what|everything))\b/.test(lower) ||
      /\b(what (do|products|items|flowers))\b/.test(lower) ||
      lower === 'show me products' ||
      lower === 'show products';

    if (showAll) {
      return null;
    }

    const fillerWords = /\b(show|me|find|search|get|have|you|do|please|can|want|need|looking|for|for a|some|the|a|an|i|buy|order|add|flowers|flower)\b/g;
    const stripped = lower
      .replace(/[?!.,]/g, '')
      .replace(fillerWords, '')
      .trim()
      .replace(/\s+/g, ' ')
      .trim();

    if (!stripped || stripped.length < 2) {
      return null;
    }

    return stripped.split(' ').slice(0, 3).join(' ');
  }
}
