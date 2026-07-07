import { Injectable, inject } from '@angular/core';
import { Checkout, PaymentMethod, PaymentHandler } from '../models/types';
import { ChatStateService } from './chat-state.service';
import { DEMO_PAYMENT_METHODS } from '../data/mock-payment-methods';

type PendingCheckoutStep =
  | 'fulfillment_destination'
  | 'fulfillment_option'
  | 'payment'
  | null;

@Injectable({
  providedIn: 'root'
})
export class CheckoutStateService {
  private chat = inject(ChatStateService);

  private latestCheckout: Checkout | null = null;
  private pendingCheckoutStep: PendingCheckoutStep = null;

  public getActiveCheckout(): Checkout | null {
    return this.latestCheckout;
  }

  public setCheckout(checkout: Checkout | null) {
    this.latestCheckout = checkout;
  }

  public getPendingStep(): PendingCheckoutStep {
    return this.pendingCheckoutStep;
  }

  public setPendingStep(step: PendingCheckoutStep) {
    this.pendingCheckoutStep = step;
  }

  public mergeLineItems(
    checkout: Checkout,
    itemsToAdd: Array<{ id: string; quantity?: number }>
  ) {
    const merged = checkout.line_items.map((lineItem) => ({
      id: lineItem.id,
      quantity: lineItem.quantity,
      item: { id: lineItem.item.id }
    }));

    for (const item of itemsToAdd) {
      const existing = merged.find((lineItem) => lineItem.item.id === item.id);
      if (existing) {
        existing.quantity += item.quantity ?? 1;
        continue;
      }

      merged.push({
        id: crypto.randomUUID(),
        quantity: item.quantity ?? 1,
        item: { id: item.id }
      });
    }

    return merged;
  }

  public buildCheckoutUpdatePayload(
    checkout: Checkout,
    paymentHandlers: PaymentHandler[],
    overrides: Record<string, unknown> = {}
  ) {
    return {
      id: checkout.id,
      currency: checkout.currency,
      buyer: checkout.buyer ?? {
        full_name: 'John Doe',
        email: 'john.doe@example.com'
      },
      payment: {
        instruments: [],
        selected_instrument_id: null,
        handlers: paymentHandlers
      },
      line_items:
        overrides['line_items'] ??
        checkout.line_items.map((lineItem) => ({
          id: lineItem.id,
          quantity: lineItem.quantity,
          item: { id: lineItem.item.id }
        })),
      ...overrides
    };
  }

  public isFulfillmentReady(checkout: Checkout) {
    const methods = checkout.fulfillment?.methods ?? [];
    if (!methods.length) {
      return false;
    }

    return methods.every((method) => {
      if (!method.selected_destination_id) {
        return false;
      }

      const groups = method.groups ?? [];
      if (!groups.length) {
        return false;
      }

      return groups.every((group) => !!group.selected_option_id);
    });
  }

  public resolvePaymentMethods(
    checkout: Checkout,
    profileHandlers: PaymentHandler[],
    negotiatedHandlers: PaymentHandler[]
  ): PaymentMethod[] {
    const availableHandlers = checkout.payment?.handlers?.length
      ? checkout.payment.handlers
      : profileHandlers;
      
    const supportedHandlers = negotiatedHandlers.length
      ? availableHandlers.filter((handler) =>
          negotiatedHandlers.some((supportedHandler) =>
            this.paymentHandlerKey(supportedHandler) === this.paymentHandlerKey(handler)
          )
        )
      : [];

    if (!supportedHandlers.length) {
      return [];
    }

    const preferredHandler =
      supportedHandlers.find((handler) => handler.id === 'mock_payment_handler') ??
      supportedHandlers[0];

    return DEMO_PAYMENT_METHODS.map((method) => ({
      ...method,
      handler_id: preferredHandler.id
    }));
  }

  public toPaymentInstrument(paymentMethod: PaymentMethod) {
    return {
      id: paymentMethod.id,
      handler_id: paymentMethod.handler_id,
      type: paymentMethod.type,
      display: {
        brand: paymentMethod.display.brand,
        last_digits: paymentMethod.display.last_digits,
        expiry_month: paymentMethod.display.expiry_month,
        expiry_year: paymentMethod.display.expiry_year
      },
      credential: {
        type: 'token',
        token: paymentMethod.token
      },
      billing_address: {
        street_address: '123 Main St',
        address_locality: 'Mountain View',
        address_region: 'CA',
        address_country: 'US',
        postal_code: '94043'
      }
    };
  }

  public presentCheckoutGuidance(checkout: Checkout, intro: string) {
    this.latestCheckout = checkout;
    const content = this.buildCheckoutGuidance(checkout, intro);
    this.chat.addOrReplaceCheckoutMessage(content, checkout);
  }

  private buildCheckoutGuidance(checkout: Checkout, intro: string) {
    if (checkout.status === 'completed') {
      this.pendingCheckoutStep = null;
      return `${intro} The merchant marked this checkout as completed.`;
    }

    if (this.needsFulfillmentDestination(checkout)) {
      this.pendingCheckoutStep = 'fulfillment_destination';
      return `${intro} ${
        this.hasKnownFulfillmentDestinations(checkout)
          ? 'Pick a saved destination below or send a new delivery address in chat.'
          : 'Send a delivery address in chat so I can update fulfillment.'
      }`;
    }

    if (this.needsFulfillmentOption(checkout)) {
      this.pendingCheckoutStep = 'fulfillment_option';
      return `${intro} Choose a shipping option below or reply with the option name.`;
    }

    this.pendingCheckoutStep = 'payment';
    return `${intro} The checkout is ready for payment when you are ready.`;
  }

  public needsFulfillmentDestination(checkout: Checkout) {
    const methods = checkout.fulfillment?.methods ?? [];
    if (!methods.length) {
      return false;
    }

    return methods.some(
      (method) => method.type === 'shipping' && !method.selected_destination_id
    );
  }

  public needsFulfillmentOption(checkout: Checkout) {
    const methods = checkout.fulfillment?.methods ?? [];
    if (!methods.length) {
      return false;
    }

    return methods.some((method) => {
      if (method.type === 'shipping' && !method.selected_destination_id) {
        return false;
      }

      const groups = method.groups ?? [];
      if (!groups.length) {
        return true;
      }

      return groups.some((group) => !group.selected_option_id);
    });
  }

  private hasKnownFulfillmentDestinations(checkout: Checkout) {
    return (
      checkout.fulfillment?.methods?.some(
        (method) => (method.destinations?.length ?? 0) > 0
      ) ?? false
    );
  }

  private paymentHandlerKey(handler: PaymentHandler) {
    return handler.namespace ?? handler.name ?? handler.id;
  }
}
