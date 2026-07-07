import { PaymentMethod } from '../models/types';

export const DEMO_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'instr_1',
    type: 'card',
    handler_id: 'mock_payment_handler',
    token: 'success_token',
    display: {
      brand: 'Visa',
      last_digits: '1234',
      expiry_month: 12,
      expiry_year: 2028
    }
  },
  {
    id: 'instr_2',
    type: 'card',
    handler_id: 'mock_payment_handler',
    token: 'success_token',
    display: {
      brand: 'Mastercard',
      last_digits: '5678',
      expiry_month: 10,
      expiry_year: 2029
    }
  }
];
