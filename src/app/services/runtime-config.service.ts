import { Injectable, signal, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { LocalStorageService } from './local-storage.service';

const STORAGE_KEY = 'ucp-angular-client.geminiApiKey';
const PLACEHOLDER_KEY = 'REPLACE_WITH_YOUR_GEMINI_API_KEY';

@Injectable({
  providedIn: 'root'
})
export class RuntimeConfigService {
  private localStorage = inject(LocalStorageService);
  
  readonly geminiApiKey = signal(this.loadInitialApiKey());

  setGeminiApiKey(value: string) {
    const normalizedValue = value.trim();
    this.geminiApiKey.set(normalizedValue);

    if (normalizedValue) {
      this.localStorage.setItem(STORAGE_KEY, normalizedValue);
    } else {
      this.localStorage.removeItem(STORAGE_KEY);
    }
  }

  private loadInitialApiKey() {
    const storedApiKey = this.localStorage.getItem<string>(STORAGE_KEY);
    if (storedApiKey) {
      return storedApiKey;
    }

    return environment.geminiApiKey === PLACEHOLDER_KEY
      ? ''
      : environment.geminiApiKey;
  }
}
