import { Injectable, signal, inject } from '@angular/core';
import { Merchant } from '../models/types';
import { LocalStorageService } from './local-storage.service';

const MERCHANTS_STORAGE_KEY = 'ucp-angular-client.merchants';

const DEFAULT_MERCHANTS: Merchant[] = [
  {
    id: 'flower-shop-rest',
    name: 'Flower Shop (REST API)',
    url: 'http://localhost:8182',
    type: 'rest'
  },
  {
    id: 'cymbal-retail-a2a',
    name: 'Cymbal Retail (A2A Agent)',
    url: 'http://localhost:10999',
    type: 'a2a'
  }
];

@Injectable({
  providedIn: 'root'
})
export class MerchantRegistryService {
  private localStorage = inject(LocalStorageService);
  
  // The global list of merchants available to the AI Client
  public readonly merchants = signal<Merchant[]>(this.loadMerchants());
  public readonly activeMerchant = signal<Merchant>(this.merchants()[0]);

  private loadMerchants(): Merchant[] {
    const stored = this.localStorage.getItem<Merchant[]>(MERCHANTS_STORAGE_KEY);
    if (stored && stored.length > 0) {
      return stored;
    }
    return [...DEFAULT_MERCHANTS];
  }

  private saveMerchants(merchants: Merchant[]) {
    this.localStorage.setItem(MERCHANTS_STORAGE_KEY, merchants);
  }

  setActive(id: string) {
    const found = this.merchants().find(m => m.id === id);
    if (found) {
      this.activeMerchant.set(found);
    }
  }

  addMerchant(merchant: Merchant) {
    const current = this.merchants();
    const updated = [...current, merchant];
    this.merchants.set(updated);
    this.saveMerchants(updated);
  }

  updateMerchant(merchant: Merchant) {
    const current = this.merchants();
    const index = current.findIndex(m => m.id === merchant.id);
    if (index !== -1) {
      const updated = [...current];
      updated[index] = merchant;
      this.merchants.set(updated);
      this.saveMerchants(updated);
      
      // Update active if it's the one being modified
      if (this.activeMerchant().id === merchant.id) {
        this.activeMerchant.set(merchant);
      }
    }
  }

  deleteMerchant(id: string) {
    const current = this.merchants();
    const updated = current.filter(m => m.id !== id);
    this.merchants.set(updated);
    this.saveMerchants(updated);
    
    // If we deleted the active merchant, switch to another one
    if (this.activeMerchant().id === id && updated.length > 0) {
      this.activeMerchant.set(updated[0]);
    } else if (updated.length === 0) {
      // Create a dummy if empty or let it handle it
      this.activeMerchant.set(DEFAULT_MERCHANTS[0]); 
    }
  }
}
