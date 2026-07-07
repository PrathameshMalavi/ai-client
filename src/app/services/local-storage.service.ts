import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  isStorageAvailable(): boolean {
    try {
      return typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage !== null;
    } catch (e) {
      return false;
    }
  }

  getItem<T>(key: string): T | null {
    if (!this.isStorageAvailable()) {
      return null;
    }
    
    const data = globalThis.localStorage.getItem(key);
    if (data === null) {
      return null;
    }

    try {
      return JSON.parse(data) as T;
    } catch (e) {
      // If parsing fails, return it as string (e.g. for API keys)
      return data as unknown as T;
    }
  }

  setItem<T>(key: string, value: T): void {
    if (!this.isStorageAvailable()) {
      return;
    }
    
    if (typeof value === 'string') {
      globalThis.localStorage.setItem(key, value);
    } else {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
    }
  }

  removeItem(key: string): void {
    if (!this.isStorageAvailable()) {
      return;
    }
    globalThis.localStorage.removeItem(key);
  }
}
