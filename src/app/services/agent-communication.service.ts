import { Injectable, inject, signal } from '@angular/core';
import { ChatStateService } from './chat-state.service';
import { CheckoutStateService } from './checkout-state.service';
import { UcpNetworkService } from './ucp-network.service';
import { RestOrchestratorService } from './rest-orchestrator.service';
import { GeminiService } from './gemini.service';
import {
  Checkout,
  FulfillmentMethod,
  Merchant,
  PaymentHandler,
  PaymentMethod,
  Product,
  UcpCapability,
  UcpProfile
} from '../models/types';
import { intersectCapabilities, intersectPaymentHandlers, getPlatformProfileUrl } from '../utils/ucp-profile';

type ParsedDestination = {
  id: string;
  street_address: string;
  city?: string;
  region?: string;
  postal_code?: string;
  address_country?: string;
};

@Injectable({
  providedIn: 'root'
})
export class AgentCommunicationService {
  private chat = inject(ChatStateService);
  private checkoutState = inject(CheckoutStateService);
  private network = inject(UcpNetworkService);
  private orchestrator = inject(RestOrchestratorService);
  private gemini = inject(GeminiService);

  // Facade over ChatState
  public messages = this.chat.messages;
  public isLoading = this.chat.isLoading;
  public loadingText = this.chat.loadingText;

  public clearChat() {
    this.chat.clear();
  }

  // Local Discovery State
  public currentProfile = signal<UcpProfile | null>(null);
  public platformProfile = signal<UcpProfile | null>(null);
  public negotiatedCapabilities = signal<UcpCapability[]>([]);
  public negotiatedPaymentHandlers = signal<PaymentHandler[]>([]);
  private currentMerchant: Merchant | null = null;

  async discover(merchant: Merchant): Promise<UcpProfile | null> {
    this.currentMerchant = merchant;
    this.chat.clear();
    this.checkoutState.setCheckout(null);
    this.network.a2aContextId = null;
    this.network.a2aTaskId = null;

    const [platform, business] = await Promise.all([
      this.network.ensurePlatformProfileLoaded(),
      this.network.fetchMerchantProfile(merchant)
    ]);

    this.platformProfile.set(platform);
    this.currentProfile.set(business);

    this.negotiatedCapabilities.set(intersectCapabilities(platform, business));
    this.negotiatedPaymentHandlers.set(intersectPaymentHandlers(platform, business));

    return business;
  }

  async sendMessage(merchant: Merchant, text: string) {
    this.currentMerchant = merchant;
    this.chat.addUserText(text);

    this.chat.setLoading(true, merchant.type === 'a2a' ? 'Sending to merchant agent...' : 'Thinking...');
    try {
      if (merchant.type === 'a2a') {
        await this.network.sendA2AMessage(merchant, [{ type: 'text', text }]);
        return;
      }
      
      const capabilities = this.negotiatedCapabilities().map(c => c.name);
      await this.orchestrator.handleRestRequest(
        merchant, 
        text, 
        capabilities,
        this.beginPayment.bind(this),
        this.upsertRestCheckout.bind(this),
        this.setFulfillmentDestinationAddress.bind(this)
      );
    } finally {
      this.chat.setLoading(false);
    }
  }

  async addProductToCheckout(merchant: Merchant, product: Product) {
    this.currentMerchant = merchant;
    this.chat.setLoading(true, 'Adding to checkout...');
    try {
      if (merchant.type === 'a2a') {
        await this.network.sendA2AMessage(
          merchant,
          [{ type: 'data', data: { action: 'add_to_checkout', product_id: product.id, quantity: 1 } }],
          true
        );
        return;
      }

      await this.upsertRestCheckout(merchant, [product.id]);
    } finally {
      this.chat.setLoading(false);
    }
  }

  async beginPayment(merchant: Merchant, checkout: Checkout) {
    this.currentMerchant = merchant;
    this.checkoutState.setCheckout(checkout);
    this.chat.setLoading(true, 'Preparing payment...');
    
    try {
      if (merchant.type === 'a2a' && checkout.status !== 'ready_for_complete') {
        await this.network.sendA2AMessage(merchant, [{ type: 'data', data: { action: 'start_payment' } }], true);
        return;
      }

      if (merchant.type === 'rest' && this.hasCapability('dev.ucp.shopping.fulfillment')) {
        const fulfillmentReady = this.checkoutState.isFulfillmentReady(checkout);
        if (!fulfillmentReady) {
          const preparedCheckout = await this.ensureFulfillmentInitialized(merchant, checkout);
          if (preparedCheckout && !this.checkoutState.isFulfillmentReady(preparedCheckout)) {
            this.checkoutState.presentCheckoutGuidance(preparedCheckout, 'This checkout needs fulfillment before payment.');
            return;
          }
          if (preparedCheckout) {
            checkout = preparedCheckout;
          }
        }
      }

      const methods = this.checkoutState.resolvePaymentMethods(
        checkout, 
        this.currentProfile()?.paymentHandlers ?? [], 
        this.negotiatedPaymentHandlers()
      );
      
      if (!methods.length) {
        this.chat.addSystemText('No client-side payment handler is available for this checkout yet.');
        return;
      }

      this.checkoutState.setPendingStep('payment');
      this.chat.addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Choose a payment method to complete this checkout.',
        timestamp: new Date(),
        paymentMethods: methods,
        paymentCheckoutId: checkout.id
      });
    } finally {
      this.chat.setLoading(false);
    }
  }

  async payWithMethod(merchant: Merchant, checkout: Checkout, paymentMethod: PaymentMethod) {
    this.currentMerchant = merchant;
    this.checkoutState.setCheckout(checkout);

    this.chat.addUserText(`Pay with ${paymentMethod.display.brand} ending in ${paymentMethod.display.last_digits}`);

    if (merchant.type === 'a2a') {
      await this.network.sendA2AMessage(
        merchant,
        [
          { type: 'data', data: { action: 'complete_checkout' } },
          {
            type: 'data',
            data: {
              'a2a.ucp.checkout.payment_data': this.checkoutState.toPaymentInstrument(paymentMethod),
              'a2a.ucp.checkout.risk_signals': { client: 'ucp-angular-client', flow: 'mock-payment' }
            }
          }
        ],
        true
      );
      return;
    }

    this.chat.setLoading(true, 'Processing payment...');
    try {
      await this.completeRestCheckout(merchant, checkout, paymentMethod);
    } finally {
      this.chat.setLoading(false);
    }
  }

  getActiveCheckout(): Checkout | null {
    return this.checkoutState.getActiveCheckout();
  }

  getPlatformProfileUrl(): string {
    return getPlatformProfileUrl();
  }

  async selectFulfillmentDestination(
    merchant: Merchant,
    checkout: Checkout,
    methodId: string,
    destinationId: string
  ) {
    this.currentMerchant = merchant;

    const method = checkout.fulfillment?.methods?.find((entry) => entry.id === methodId);
    if (!method) return;

    const payload = this.checkoutState.buildCheckoutUpdatePayload(checkout, this.currentProfile()?.paymentHandlers ?? [], {
      fulfillment: {
        methods: [{ id: method.id, type: method.type, line_item_ids: method.line_item_ids, selected_destination_id: destinationId }]
      }
    });

    const updatedCheckout = await this.network.updateRestCheckout(merchant, checkout.id, payload);
    if (updatedCheckout) {
      const checkoutWithOptionSelection = (await this.autoSelectSingleFulfillmentOption(merchant, updatedCheckout)) ?? updatedCheckout;
      this.checkoutState.presentCheckoutGuidance(checkoutWithOptionSelection, 'I updated the checkout with the selected fulfillment destination.');
    }
  }

  async selectFulfillmentOption(
    merchant: Merchant,
    checkout: Checkout,
    methodId: string,
    groupId: string,
    optionId: string
  ) {
    this.currentMerchant = merchant;

    const method = checkout.fulfillment?.methods?.find((entry) => entry.id === methodId);
    const group = method?.groups?.find((entry) => entry.id === groupId);
    if (!method || !group) return;

    const payload = this.checkoutState.buildCheckoutUpdatePayload(checkout, this.currentProfile()?.paymentHandlers ?? [], {
      fulfillment: {
        methods: [
          {
            id: method.id,
            type: method.type,
            line_item_ids: method.line_item_ids,
            selected_destination_id: method.selected_destination_id,
            groups: [{ id: group.id, line_item_ids: group.line_item_ids, selected_option_id: optionId }]
          }
        ]
      }
    });

    const updatedCheckout = await this.network.updateRestCheckout(merchant, checkout.id, payload);
    if (updatedCheckout) {
      this.checkoutState.presentCheckoutGuidance(updatedCheckout, 'I updated the checkout with the selected fulfillment option.');
    }
  }

  private async autoSelectSingleFulfillmentOption(merchant: Merchant, checkout: Checkout) {
    const methods = checkout.fulfillment?.methods ?? [];
    const methodsNeedingSelection = methods.filter((method) =>
      (method.groups ?? []).some((group) => !group.selected_option_id)
    );

    if (!methodsNeedingSelection.length) return null;

    if (methodsNeedingSelection.some((method) => (method.groups ?? []).some((group) => !group.selected_option_id && (group.options?.length ?? 0) !== 1))) {
      return null;
    }

    const payload = this.checkoutState.buildCheckoutUpdatePayload(checkout, this.currentProfile()?.paymentHandlers ?? [], {
      fulfillment: {
        methods: methods.map((method) => ({
          id: method.id,
          type: method.type,
          line_item_ids: method.line_item_ids,
          selected_destination_id: method.selected_destination_id,
          groups: (method.groups ?? []).map((group) => ({
            id: group.id,
            line_item_ids: group.line_item_ids,
            selected_option_id: group.selected_option_id ?? group.options?.[0]?.id ?? null
          }))
        }))
      }
    });

    const updatedCheckout = await this.network.updateRestCheckout(merchant, checkout.id, payload);
    if (updatedCheckout) {
      this.checkoutState.setCheckout(updatedCheckout);
    }
    return updatedCheckout;
  }

  private hasCapability(name: string) {
    return this.negotiatedCapabilities().some((c) => c.name === name);
  }

  //
  // REST internal mutation handlers 
  //

  private async upsertRestCheckout(merchant: Merchant, items: Array<{ id: string; quantity?: number }> | string[]) {
    const normalizedItems = items.map((item) =>
      typeof item === 'string' ? { id: item, quantity: 1 } : { id: item.id, quantity: item.quantity ?? 1 }
    );

    const latest = this.checkoutState.getActiveCheckout();

    if (latest) {
      const mergedLineItems = this.checkoutState.mergeLineItems(latest, normalizedItems);
      const payload = this.checkoutState.buildCheckoutUpdatePayload(latest, this.currentProfile()?.paymentHandlers ?? [], {
        line_items: mergedLineItems
      });

      const updated = await this.network.updateRestCheckout(merchant, latest.id, payload);
      if (updated) {
        await this.presentCheckoutAfterMutation(merchant, updated, 'I updated the checkout using the merchant item selection.');
      }
      return;
    }

    const payload = {
      currency: 'USD',
      buyer: { full_name: 'John Doe', email: 'john.doe@example.com' },
      payment: { instruments: [], selected_instrument_id: null, handlers: this.currentProfile()?.paymentHandlers ?? [] },
      line_items: normalizedItems.map((item) => ({ item: { id: item.id }, quantity: item.quantity ?? 1 }))
    };

    try {
      const checkout = await this.network.createRestCheckout(merchant, payload);
      await this.presentCheckoutAfterMutation(merchant, checkout, 'I created a checkout from merchant item identifiers.');
    } catch (e: any) {
      const detail = e?.error?.detail ?? e?.message ?? 'Unknown error';
      this.chat.addSystemText(`Failed to create checkout: ${detail}`);
    }
  }

  private async completeRestCheckout(merchant: Merchant, checkout: Checkout, paymentMethod: PaymentMethod) {
    const payload = {
      payment: { instruments: [this.checkoutState.toPaymentInstrument(paymentMethod)] },
      risk_signals: { ip: '127.0.0.1', browser: 'ucp-angular-client' }
    };

    try {
      const updatedCheckout = await this.network.completeRestCheckout(merchant, checkout.id, payload);
      this.checkoutState.setCheckout(updatedCheckout);
      this.checkoutState.setPendingStep(null);
      this.chat.addOrReplaceCheckoutMessage(
        `Payment completed. Order ${updatedCheckout.order?.id ?? updatedCheckout.id} is now available below.`,
        updatedCheckout
      );
    } catch (e: any) {
      const detail = e?.error?.detail ?? e?.message ?? 'Unknown error';
      if (typeof detail === 'string' && detail.includes('Fulfillment address and option must be selected')) {
        const prepared = await this.ensureFulfillmentInitialized(merchant, checkout);
        if (prepared) {
          this.checkoutState.presentCheckoutGuidance(prepared, 'The merchant requires fulfillment before completion.');
          return;
        }
      }
      this.chat.addSystemText(`Payment failed: ${detail}`);
    }
  }

  private async presentCheckoutAfterMutation(merchant: Merchant, checkout: Checkout, intro: string) {
    let checkoutForUi = checkout;
    this.checkoutState.setCheckout(checkout);

    if (merchant.type === 'rest' && this.hasCapability('dev.ucp.shopping.fulfillment') && !checkout.fulfillment?.methods?.length) {
      const initialized = await this.ensureFulfillmentInitialized(merchant, checkout);
      if (initialized) checkoutForUi = initialized;
    }

    this.checkoutState.presentCheckoutGuidance(checkoutForUi, intro);
  }

  private async ensureFulfillmentInitialized(merchant: Merchant, checkout: Checkout) {
    if (checkout.fulfillment?.methods?.length) return checkout;

    const method: Partial<FulfillmentMethod> = {
      id: 'method_1',
      type: 'shipping',
      line_item_ids: checkout.line_items.map((lineItem) => lineItem.id)
    };

    const payload = this.checkoutState.buildCheckoutUpdatePayload(checkout, this.currentProfile()?.paymentHandlers ?? [], {
      fulfillment: { methods: [method] }
    });

    const updated = await this.network.updateRestCheckout(merchant, checkout.id, payload);
    if (updated) this.checkoutState.setCheckout(updated);
    return updated;
  }

  async setFulfillmentDestinationAddress(merchant: Merchant, checkout: Checkout, addressStr: string) {
    this.currentMerchant = merchant;
    const parsed = await this.gemini.parseAddressWithGemini(addressStr);
    if (!parsed) {
      this.chat.addAssistantText('I could not understand that address. Please try providing a standard format.');
      return;
    }

    let method = checkout.fulfillment?.methods?.[0];
    if (!method) {
      const init = await this.ensureFulfillmentInitialized(merchant, checkout);
      if (init) {
        method = init.fulfillment?.methods?.[0];
        checkout = init;
      }
    }
    if (!method) return;

    const payload = this.checkoutState.buildCheckoutUpdatePayload(checkout, this.currentProfile()?.paymentHandlers ?? [], {
      fulfillment: {
        methods: [{
          id: method.id,
          type: method.type,
          line_item_ids: method.line_item_ids,
          destinations: [{ root: parsed }]
        }]
      }
    });

    const updatedCheckout = await this.network.updateRestCheckout(merchant, checkout.id, payload);
    if (updatedCheckout) {
      const checkoutWithOptionSelection = (await this.autoSelectSingleFulfillmentOption(merchant, updatedCheckout)) ?? updatedCheckout;
      this.checkoutState.presentCheckoutGuidance(checkoutWithOptionSelection, 'I updated your shipping destination and recalculated options.');
    }
  }
}
