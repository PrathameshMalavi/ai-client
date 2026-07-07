import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ChatMessage, Checkout, Merchant, PaymentMethod, Product, UcpProfile } from '../models/types';
import { getPlatformProfileUrl, normalizeUcpProfile } from '../utils/ucp-profile';
import { ChatStateService } from './chat-state.service';
import { CheckoutStateService } from './checkout-state.service';

type A2APart =
  | { type: 'text'; text: string }
  | { type: 'data'; data: Record<string, unknown> };

@Injectable({
  providedIn: 'root'
})
export class UcpNetworkService {
  private http = inject(HttpClient);
  private chat = inject(ChatStateService);
  private checkoutState = inject(CheckoutStateService);

  private platformProfileLoad: Promise<UcpProfile | null> | null = null;
  private readonly a2aExtensionUrl = 'https://ucp.dev/2026-01-23/specification/overview?v=2026-01-23';

  public a2aContextId: string | null = null;
  public a2aTaskId: string | null = null;
  public platformProfile: UcpProfile | null = null;

  async fetchMerchantProfile(merchant: Merchant): Promise<UcpProfile | null> {
    try {
      const response = await firstValueFrom(this.http.get<unknown>(`${merchant.url}/.well-known/ucp`));
      return normalizeUcpProfile(response);
    } catch (error) {
      console.error('Discovery failed', error);
      return null;
    }
  }

  async ensurePlatformProfileLoaded(): Promise<UcpProfile | null> {
    if (this.platformProfile) {
      return this.platformProfile;
    }

    if (this.platformProfileLoad) {
      return this.platformProfileLoad;
    }

    this.platformProfileLoad = (async () => {
      try {
        const response = await firstValueFrom(
          this.http.get<unknown>(getPlatformProfileUrl())
        );
        this.platformProfile = normalizeUcpProfile(response);
        return this.platformProfile;
      } catch (error) {
        console.error('Platform profile load failed', error);
        return null;
      } finally {
        this.platformProfileLoad = null;
      }
    })();

    return this.platformProfileLoad;
  }

  public buildUcpHeaders() {
    return {
      'UCP-Agent': `profile="${getPlatformProfileUrl()}"; version="${this.platformProfile?.version ?? '2026-01-23'}"`,
      'Request-Signature': 'test',
      'Idempotency-Key': crypto.randomUUID(),
      'Request-Id': crypto.randomUUID()
    };
  }

  async searchCatalog(merchant: Merchant, query: string | null): Promise<Product[]> {
    const response = await firstValueFrom(
      this.http.post<any>(
        `${merchant.url}/catalog/search`,
        { query },
        { headers: this.buildUcpHeaders() }
      )
    );

    return Array.isArray(response?.products)
      ? response.products.map((p: unknown) => this.normalizeProduct(p))
      : [];
  }

  async createRestCheckout(merchant: Merchant, payload: unknown): Promise<Checkout> {
    const response = await firstValueFrom(
      this.http.post<unknown>(`${merchant.url}/checkout-sessions`, payload, {
        headers: this.buildUcpHeaders()
      })
    );
    return this.normalizeCheckout(response);
  }

  async updateRestCheckout(merchant: Merchant, checkoutId: string, payload: unknown): Promise<Checkout | null> {
    try {
      const response = await firstValueFrom(
        this.http.put<unknown>(`${merchant.url}/checkout-sessions/${checkoutId}`, payload, {
          headers: this.buildUcpHeaders()
        })
      );
      return this.normalizeCheckout(response);
    } catch (error: any) {
      const detail = error?.error?.detail ?? error?.message ?? 'Unknown error';
      this.chat.addSystemText(`Checkout update failed: ${detail}`);
      return null;
    }
  }

  async completeRestCheckout(merchant: Merchant, checkoutId: string, payload: unknown): Promise<Checkout> {
    const response = await firstValueFrom(
      this.http.post<unknown>(`${merchant.url}/checkout-sessions/${checkoutId}/complete`, payload, {
        headers: this.buildUcpHeaders()
      })
    );
    return this.normalizeCheckout(response);
  }

  async sendA2AMessage(merchant: Merchant, parts: A2APart[], isUserAction = false) {
    const requestMessage: Record<string, unknown> = {
      role: 'user',
      parts,
      messageId: crypto.randomUUID(),
      kind: 'message'
    };

    if (this.a2aContextId) {
      requestMessage['contextId'] = this.a2aContextId;
    }

    if (this.a2aTaskId) {
      requestMessage['taskId'] = this.a2aTaskId;
    }

    try {
      const response = await fetch(merchant.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-A2A-Extensions': this.a2aExtensionUrl,
          'UCP-Agent': `profile="${getPlatformProfileUrl()}"; version="${this.platformProfile?.version ?? '2026-01-23'}"`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'message/send',
          params: {
            message: requestMessage,
            configuration: { historyLength: 0 }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`A2A request failed with status ${response.status}`);
      }

      const data = await response.json();
      this.a2aContextId = data.result?.contextId ?? this.a2aContextId;

      if (
        data.result?.id &&
        ['working', 'submitted', 'input-required'].includes(data.result?.status?.state)
      ) {
        this.a2aTaskId = data.result.id;
      } else {
        this.a2aTaskId = null;
      }

      const message = this.parseA2AResponse(data.result);
      if (message) {
        if (message.checkout) {
          this.checkoutState.setCheckout(message.checkout);
        }
        this.chat.addMessage(message);
        return;
      }

      if (isUserAction) {
        this.chat.addAssistantText(
          'Action sent to the merchant agent, but the response did not contain renderable UCP data.'
        );
        return;
      }

      this.chat.addAssistantText(
        "I received a response from the merchant agent, but I couldn't render it."
      );
    } catch (error: any) {
      this.chat.addSystemText(`Error connecting to A2A agent: ${error.message}`);
    }
  }

  private parseA2AResponse(result: any): ChatMessage | null {
    const parts = result?.parts ?? result?.status?.message?.parts ?? [];
    if (!Array.isArray(parts) || !parts.length) {
      return null;
    }

    let content = '';
    let products: Product[] | undefined;
    let checkout: Checkout | undefined;

    for (const part of parts) {
      if (part?.text) {
        content += `${content ? '\n' : ''}${part.text}`;
      }

      const productResults = part?.data?.['a2a.product_results'];
      if (productResults?.results) {
        products = productResults.results.map((product: unknown) =>
          this.normalizeProduct(product)
        );
        if (productResults?.content) {
          content += `${content ? '\n' : ''}${productResults.content}`;
        }
      }

      const checkoutData = part?.data?.['a2a.ucp.checkout'];
      if (checkoutData) {
        checkout = this.normalizeCheckout(checkoutData);
      }
    }

    if (!content && !products?.length && !checkout) {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      products,
      checkout
    };
  }

  private normalizeProduct(rawProduct: any): Product {
    const rawPrice =
      rawProduct?.offers?.price ??
      rawProduct?.price?.amount ??
      rawProduct?.price_range?.min?.amount ??
      0;

    const normalizedPrice =
      typeof rawPrice === 'number' && rawPrice > 999 ? rawPrice : Number(rawPrice) * 100;

    return {
      id:
        rawProduct?.productID ??
        rawProduct?.id ??
        rawProduct?.variants?.[0]?.id ??
        'unknown-product',
      title: rawProduct?.name ?? rawProduct?.title ?? 'Unknown product',
      brand:
        rawProduct?.brand?.name ??
        rawProduct?.brand ??
        rawProduct?.vendor ??
        'Unknown brand',
      description:
        rawProduct?.description?.plain ??
        rawProduct?.description ??
        '',
      price: Number.isFinite(normalizedPrice) ? normalizedPrice : 0,
      currency:
        rawProduct?.offers?.priceCurrency ??
        rawProduct?.price?.currency_code ??
        'USD',
      availability:
        rawProduct?.offers?.availability ??
        rawProduct?.availability ??
        'InStock',
      imageUrl:
        rawProduct?.image_url ??
        rawProduct?.image?.[0] ??
        rawProduct?.media?.[0]?.url ??
        rawProduct?.featured_media?.url ??
        null,
      raw: rawProduct
    };
  }

  private normalizeCheckout(rawCheckout: any): Checkout {
    const lineItems = Array.isArray(rawCheckout?.line_items)
      ? rawCheckout.line_items.map((lineItem: any) => ({
          id: lineItem.id,
          quantity: lineItem.quantity,
          item: {
            id: lineItem?.item?.id,
            title: lineItem?.item?.title || lineItem?.item?.id,
            price: Number(lineItem?.item?.price ?? 0),
            image_url: lineItem?.item?.image_url ?? null
          },
          totals: Array.isArray(lineItem?.totals) ? lineItem.totals : []
        }))
      : [];

    return {
      id: rawCheckout?.id,
      status: rawCheckout?.status ?? 'unknown',
      currency: rawCheckout?.currency ?? 'USD',
      line_items: lineItems,
      totals: Array.isArray(rawCheckout?.totals) ? rawCheckout.totals : [],
      continue_url: rawCheckout?.continue_url ?? null,
      payment: rawCheckout?.payment
        ? { handlers: rawCheckout.payment.handlers ?? [] }
        : null,
      order: rawCheckout?.order ?? null,
      buyer: rawCheckout?.buyer ?? null,
      fulfillment: rawCheckout?.fulfillment ?? null,
      messages: rawCheckout?.messages ?? null,
      raw: rawCheckout
    };
  }
}
