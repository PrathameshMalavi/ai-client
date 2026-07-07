import {
  PaymentHandler,
  UcpCapability,
  UcpProfile,
  UcpServiceBinding
} from '../models/types';

export function normalizeUcpProfile(rawProfile: any): UcpProfile {
  const ucp = rawProfile?.ucp ?? rawProfile ?? {};
  const capabilities = flattenCapabilities(ucp.capabilities);
  const services = flattenServices(ucp.services);
  const paymentHandlers = flattenPaymentHandlers(
    rawProfile?.payment?.handlers ??
      ucp.payment_handlers ??
      rawProfile?.payment_handlers
  );

  return {
    version: ucp.version ?? 'unknown',
    supportedVersions: ucp.supported_versions ?? null,
    capabilities,
    services,
    paymentHandlers,
    raw: rawProfile
  };
}

export function intersectCapabilities(
  platformProfile: UcpProfile | null,
  businessProfile: UcpProfile | null
) {
  if (!platformProfile || !businessProfile) {
    return [];
  }

  const platformByName = groupCapabilitiesByName(platformProfile.capabilities);
  let activeCapabilities = businessProfile.capabilities.filter((businessCapability) => {
    const platformCapabilities = platformByName.get(businessCapability.name) ?? [];
    if (!platformCapabilities.length) {
      return false;
    }

    const mutualVersions = platformCapabilities
      .map((capability) => capability.version)
      .filter((version): version is string => !!version)
      .filter((version) => version === businessCapability.version);

    return mutualVersions.length > 0;
  });

  while (true) {
    const activeNames = new Set(activeCapabilities.map((capability) => capability.name));
    const prunedCapabilities = activeCapabilities.filter((capability) => {
      const parents = capabilityParents(capability);
      return !parents.length || parents.some((parent) => activeNames.has(parent));
    });

    if (prunedCapabilities.length === activeCapabilities.length) {
      return selectHighestVersions(prunedCapabilities);
    }

    activeCapabilities = prunedCapabilities;
  }
}

export function intersectPaymentHandlers(
  platformProfile: UcpProfile | null,
  businessProfile: UcpProfile | null
) {
  if (!platformProfile || !businessProfile) {
    return [];
  }

  return businessProfile.paymentHandlers.filter((businessHandler) =>
    platformProfile.paymentHandlers.some((platformHandler) =>
      paymentHandlerMatches(platformHandler, businessHandler)
    )
  );
}

export function getPlatformProfileUrl() {
  const origin = globalThis.location?.origin ?? 'http://localhost:4200';
  return `${origin}/profile/agent_profile.json`;
}

function flattenCapabilities(input: any): UcpCapability[] {
  const flattened: UcpCapability[] = [];

  if (Array.isArray(input)) {
    input.forEach((capability) =>
      flattened.push(normalizeCapability(capability))
    );
    return flattened;
  }

  if (input && typeof input === 'object') {
    for (const [name, capabilities] of Object.entries(input)) {
      if (Array.isArray(capabilities)) {
        capabilities.forEach((capability) =>
          flattened.push(normalizeCapability({ name, ...capability }))
        );
      }
    }
  }

  return flattened;
}

function flattenServices(input: any): UcpServiceBinding[] {
  const flattened: UcpServiceBinding[] = [];
  if (!input || typeof input !== 'object') {
    return flattened;
  }

  for (const [name, definition] of Object.entries(input)) {
    if (Array.isArray(definition)) {
      definition.forEach((service) => {
        flattened.push({
          name,
          transport: service.transport ?? 'unknown',
          endpoint: service.endpoint ?? null,
          schema: service.schema ?? null,
          config: service.config ?? null
        });
      });
      continue;
    }

    if (definition && typeof definition === 'object') {
      const service = definition as Record<string, any>;
      for (const transport of ['rest', 'a2a', 'mcp', 'embedded']) {
        if (service[transport]) {
          flattened.push({
            name,
            transport,
            endpoint: service[transport].endpoint ?? null,
            schema: service[transport].schema ?? null,
            config: service[transport].config ?? null
          });
        }
      }
    }
  }

  return flattened;
}

function flattenPaymentHandlers(input: any): PaymentHandler[] {
  const flattened: PaymentHandler[] = [];

  if (Array.isArray(input)) {
    input.forEach((handler) =>
      flattened.push(normalizePaymentHandler(handler, null))
    );
    return flattened;
  }

  if (input && typeof input === 'object') {
    for (const [namespace, handlers] of Object.entries(input)) {
      if (!Array.isArray(handlers)) {
        continue;
      }

      handlers.forEach((handler) =>
        flattened.push(normalizePaymentHandler(handler, namespace))
      );
    }
  }

  return flattened;
}

function normalizePaymentHandler(
  handler: any,
  namespace: string | null
): PaymentHandler {
  return {
    namespace,
    id: handler?.id ?? namespace ?? 'unknown-handler',
    name: handler?.name ?? namespace ?? handler?.id ?? 'unknown-handler',
    version: handler?.version,
    spec: handler?.spec ?? null,
    schema: handler?.schema ?? null,
    config_schema: handler?.config_schema ?? null,
    instrument_schemas: handler?.instrument_schemas ?? null,
    available_instruments: handler?.available_instruments ?? null,
    config: handler?.config ?? null
  };
}

function normalizeCapability(capability: any): UcpCapability {
  return {
    name:
      capability?.name ??
      deriveCapabilityName(capability?.spec, capability?.schema) ??
      'unknown-capability',
    version: capability?.version,
    spec: capability?.spec ?? null,
    schema: capability?.schema ?? null,
    extends: capability?.extends ?? null,
    config: capability?.config ?? null
  };
}

function deriveCapabilityName(spec?: string | null, schema?: string | null) {
  const source = spec ?? schema;
  if (!source) {
    return null;
  }

  const cleaned = source.replace(/\/$/, '');
  const segments = cleaned.split('/');
  const last = segments[segments.length - 1]?.replace('.json', '') ?? '';
  const previous = segments[segments.length - 2];

  if (previous === 'catalog') {
    return `dev.ucp.shopping.catalog.${last}`;
  }

  if (
    ['checkout', 'fulfillment', 'discount', 'buyer-consent', 'buyer_consent', 'order'].includes(last)
  ) {
    return `dev.ucp.shopping.${last.replace('-', '_')}`;
  }

  return last;
}

function groupCapabilitiesByName(capabilities: UcpCapability[]) {
  const grouped = new Map<string, UcpCapability[]>();
  for (const capability of capabilities) {
    grouped.set(capability.name, [...(grouped.get(capability.name) ?? []), capability]);
  }
  return grouped;
}

function selectHighestVersions(capabilities: UcpCapability[]) {
  const selected = new Map<string, UcpCapability>();

  for (const capability of capabilities) {
    const current = selected.get(capability.name);
    if (!current) {
      selected.set(capability.name, capability);
      continue;
    }

    const currentVersion = current.version ?? '';
    const candidateVersion = capability.version ?? '';
    if (candidateVersion > currentVersion) {
      selected.set(capability.name, capability);
    }
  }

  return [...selected.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

function capabilityParents(capability: UcpCapability) {
  if (!capability.extends) {
    return [];
  }

  return Array.isArray(capability.extends)
    ? capability.extends
    : [capability.extends];
}

function paymentHandlerMatches(
  platformHandler: PaymentHandler,
  businessHandler: PaymentHandler
) {
  const sameNamespace =
    !!platformHandler.namespace &&
    !!businessHandler.namespace &&
    platformHandler.namespace === businessHandler.namespace;
  const sameName = platformHandler.name === businessHandler.name;

  if (!sameNamespace && !sameName) {
    return false;
  }

  if (platformHandler.version && businessHandler.version) {
    return platformHandler.version === businessHandler.version;
  }

  return true;
}
