import { Component, ElementRef, ViewChild, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgentCommunicationService } from './services/agent-communication.service';
import { MerchantRegistryService } from './services/merchant-registry.service';
import { RuntimeConfigService } from './services/runtime-config.service';
import { GeminiService } from './services/gemini.service';
import {
  Checkout,
  CheckoutLineItem,
  PaymentMethod,
  Product,
  UcpCapability,
  UcpServiceBinding
} from './models/types';
import { MerchantDialogComponent } from './components/merchant-dialog/merchant-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MerchantDialogComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  registry = inject(MerchantRegistryService);
  agent = inject(AgentCommunicationService);
  runtimeConfig = inject(RuntimeConfigService);

  /** Exposed so the template can access model list and selected model */
  gemini = inject(GeminiService);

  /** Reference to the chat scroll container used for auto-scrolling. */
  @ViewChild('chatScroll') chatScrollRef?: ElementRef<HTMLDivElement>;

  userInput = '';
  isDiscovering = false;
  isMerchantDialogOpen = false;

  constructor() {
    effect(() => {
      const activeMerchant = this.registry.activeMerchant();
      if (activeMerchant) {
        this.discover(activeMerchant);
      }
    });

    // Auto-scroll to the bottom of the chat whenever messages change or loading state changes.
    // Uses setTimeout(0) to let Angular finish rendering the new DOM before scrolling.
    effect(() => {
      this.agent.messages();
      this.agent.isLoading();
      setTimeout(() => this.scrollChatToBottom(), 0);
    });
  }

  async discover(merchant: any) {
    this.isDiscovering = true;
    await this.agent.discover(merchant);
    this.isDiscovering = false;
  }

  onMerchantChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.registry.setActive(value);
  }

  openMerchantDialog() {
    this.isMerchantDialogOpen = true;
  }

  closeMerchantDialog() {
    this.isMerchantDialogOpen = false;
  }

  updateGeminiApiKey(value: string) {
    this.runtimeConfig.setGeminiApiKey(value);
  }

  onModelChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.gemini.setModel(value);
  }

  async sendMessage() {
    if (!this.userInput.trim()) {
      return;
    }

    const text = this.userInput.trim();
    this.userInput = '';
    await this.agent.sendMessage(this.registry.activeMerchant(), text);
  }

  clearChat() {
    this.agent.clearChat();
  }

  async addToCheckout(product: Product) {
    await this.agent.addProductToCheckout(this.registry.activeMerchant(), product);
  }

  async beginPayment(checkout: Checkout) {
    await this.agent.beginPayment(this.registry.activeMerchant(), checkout);
  }

  async payWithMethod(checkoutId: string | undefined, paymentMethod: PaymentMethod) {
    const checkout = this.findCheckout(checkoutId);
    if (!checkout) {
      return;
    }

    await this.agent.payWithMethod(
      this.registry.activeMerchant(),
      checkout,
      paymentMethod
    );
  }

  async selectDestination(checkout: Checkout, methodId: string, destinationId: string) {
    await this.agent.selectFulfillmentDestination(
      this.registry.activeMerchant(),
      checkout,
      methodId,
      destinationId
    );
  }

  async selectOption(
    checkout: Checkout,
    methodId: string,
    groupId: string,
    optionId: string
  ) {
    await this.agent.selectFulfillmentOption(
      this.registry.activeMerchant(),
      checkout,
      methodId,
      groupId,
      optionId
    );
  }

  formatCurrency(amount: number, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount / 100);
  }

  availabilityLabel(product: Product) {
    return product.availability.includes('InStock') ? 'In Stock' : 'Unavailable';
  }

  capabilityLabel(capability: UcpCapability) {
    return capability.name.replace('dev.ucp.shopping.', '');
  }

  serviceLabel(service: UcpServiceBinding) {
    return `${service.name} · ${service.transport}`;
  }

  paymentHandlerLabel(handler: { namespace?: string | null; name: string }) {
    return handler.namespace ?? handler.name;
  }

  checkoutTotal(checkout: Checkout, type = 'total') {
    return (
      checkout.totals.find((total) => total.type === type)?.amount ??
      0
    );
  }

  lineItemTotal(lineItem: CheckoutLineItem) {
    return (
      lineItem.totals.find((total) => total.type === 'total')?.amount ??
      lineItem.item.price * lineItem.quantity
    );
  }

  startPaymentLabel(checkout: Checkout) {
    const needsDestination =
      checkout.fulfillment?.methods?.some(
        (method) => method.type === 'shipping' && !method.selected_destination_id
      ) ?? false;
    const needsOption =
      checkout.fulfillment?.methods?.some((method) =>
        (method.groups ?? []).some((group) => !group.selected_option_id)
      ) ?? false;

    if (needsDestination || needsOption) {
      return 'Continue Checkout';
    }

    return checkout.status === 'ready_for_complete'
      ? 'Complete Payment'
      : 'Start Payment';
  }

  productImage(product: Product) {
    if (product.imageUrl?.startsWith('http') && !product.imageUrl.includes('example.com')) {
      return product.imageUrl;
    }
    // Use the static no-product placeholder from public/ when no image URL is available
    return '/no-poduct-image.png';
  }

  checkoutItemImage(lineItem: CheckoutLineItem) {
    if (lineItem.item.image_url?.startsWith('http') && !lineItem.item.image_url.includes('example.com')) {
      return lineItem.item.image_url;
    }
    return '/no-poduct-image.png';
  }

  paymentMethodLabel(method: PaymentMethod) {
    return `${method.display.brand} •••• ${method.display.last_digits}`;
  }

  optionTotal(option: { totals?: Array<{ amount: number }> | null }) {
    if (!option.totals?.length) {
      return 0;
    }

    return option.totals[option.totals.length - 1]?.amount ?? 0;
  }

  hasCatalogCapability() {
    return this.agent
      .currentProfile()
      ?.capabilities.some((capability) => capability.name.includes('catalog'));
  }

  destinationLabel(destination: {
    street_address?: string | null;
    address_locality?: string | null;
    address_region?: string | null;
    city?: string | null;
    region?: string | null;
    postal_code?: string | null;
    address_country?: string | null;
  }) {
    return [
      destination.street_address,
      destination.city || destination.address_locality,
      destination.region || destination.address_region,
      destination.postal_code,
      destination.address_country
    ]
      .filter(Boolean)
      .join(', ');
  }

  private findCheckout(checkoutId: string | undefined) {
    if (!checkoutId) {
      return this.agent.getActiveCheckout();
    }

    for (const message of [...this.agent.messages()].reverse()) {
      if (message.checkout?.id === checkoutId) {
        return message.checkout;
      }
    }

    return this.agent.getActiveCheckout();
  }

  private placeholderImage(title: string, start: string, end: string) {
    const encodedTitle = title
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420">
        <defs>
          <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="${start}" />
            <stop offset="100%" stop-color="${end}" />
          </linearGradient>
        </defs>
        <rect width="640" height="420" fill="url(#g)" />
        <circle cx="530" cy="80" r="70" fill="rgba(255,255,255,0.18)" />
        <circle cx="120" cy="320" r="90" fill="rgba(255,255,255,0.14)" />
        <text x="48" y="210" fill="white" font-size="34" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${encodedTitle}</text>
      </svg>`
    )}`;
  }

  /**
   * Scrolls the chat container to the very bottom.
   * Called automatically whenever messages or loading state changes.
   */
  private scrollChatToBottom() {
    if (this.chatScrollRef?.nativeElement) {
      const el = this.chatScrollRef.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }
}
