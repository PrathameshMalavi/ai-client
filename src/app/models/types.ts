export interface Merchant {
  id: string;
  name: string;
  url: string;
  type: 'rest' | 'a2a';
}

export interface UcpCapability {
  name: string;
  version?: string;
  spec?: string | null;
  schema?: string | null;
  extends?: string | string[] | null;
  config?: Record<string, unknown> | null;
}

export interface UcpServiceBinding {
  name: string;
  transport: string;
  endpoint?: string | null;
  schema?: string | null;
  config?: Record<string, unknown> | null;
}

export interface PaymentHandler {
  namespace?: string | null;
  id: string;
  name: string;
  version?: string;
  spec?: string | null;
  schema?: string | null;
  config_schema?: string | null;
  instrument_schemas?: string[] | null;
  available_instruments?: Array<Record<string, unknown>> | null;
  config?: Record<string, unknown> | null;
}

export interface UcpProfile {
  version: string;
  supportedVersions?: Record<string, string> | null;
  capabilities: UcpCapability[];
  services: UcpServiceBinding[];
  paymentHandlers: PaymentHandler[];
  raw: unknown;
}

export interface Product {
  id: string;
  title: string;
  brand: string;
  description: string;
  price: number;
  currency: string;
  availability: string;
  imageUrl?: string | null;
  quantity?: number;
  raw?: unknown;
}

export interface CheckoutTotal {
  type: string;
  display_text?: string | null;
  amount: number;
}

export interface CheckoutLineItem {
  id: string;
  quantity: number;
  item: {
    id: string;
    title: string;
    price: number;
    image_url?: string | null;
  };
  totals: CheckoutTotal[];
}

export interface CheckoutOrder {
  id: string;
  permalink_url?: string | null;
}

export interface FulfillmentDestination {
  id: string;
  street_address?: string | null;
  extended_address?: string | null;
  address_locality?: string | null;
  address_region?: string | null;
  city?: string | null;
  region?: string | null;
  address_country?: string | null;
  postal_code?: string | null;
}

export interface FulfillmentOption {
  id: string;
  title: string;
  description?: string | null;
  totals?: CheckoutTotal[];
}

export interface FulfillmentGroup {
  id: string;
  line_item_ids: string[];
  options?: FulfillmentOption[] | null;
  selected_option_id?: string | null;
}

export interface FulfillmentMethod {
  id: string;
  type: string;
  line_item_ids: string[];
  destinations?: FulfillmentDestination[] | null;
  selected_destination_id?: string | null;
  groups?: FulfillmentGroup[] | null;
}

export interface Fulfillment {
  methods?: FulfillmentMethod[] | null;
}

export interface Checkout {
  id: string;
  status: string;
  currency: string;
  line_items: CheckoutLineItem[];
  totals: CheckoutTotal[];
  continue_url?: string | null;
  payment?: {
    handlers?: PaymentHandler[];
  } | null;
  order?: CheckoutOrder | null;
  messages?: Array<{ content?: string; severity?: string; code?: string }> | null;
  buyer?: {
    full_name?: string | null;
    email?: string | null;
  } | null;
  fulfillment?: Fulfillment | null;
  raw?: unknown;
}

export interface PaymentMethod {
  id: string;
  type: string;
  handler_id: string;
  token: string;
  display: {
    brand: string;
    last_digits: string;
    expiry_month?: number;
    expiry_year?: number;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  products?: Product[];
  checkout?: Checkout;
  paymentMethods?: PaymentMethod[];
  paymentCheckoutId?: string;
  actionPayload?: unknown;
}
