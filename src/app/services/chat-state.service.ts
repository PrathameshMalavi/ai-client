import { Injectable, signal } from '@angular/core';
import { ChatMessage, Checkout } from '../models/types';

@Injectable({
  providedIn: 'root'
})
export class ChatStateService {
  /** All chat messages shown in the UI (user + assistant + system). */
  public messages = signal<ChatMessage[]>([]);

  /**
   * True while the client is waiting for a merchant or AI response.
   * Drives the typing indicator in the chat UI.
   */
  public isLoading = signal<boolean>(false);

  /** Describes what we're currently waiting for (shown in the typing bubble). */
  public loadingText = signal<string>('Thinking...');

  /**
   * Sets the loading state and updates the loading text.
   */
  public setLoading(active: boolean, text = 'Thinking...') {
    this.isLoading.set(active);
    if (active) {
      this.loadingText.set(text);
    }
  }

  public addMessage(message: ChatMessage) {
    this.messages.update((messages) => [...messages, message]);
  }

  public addAssistantText(content: string) {
    this.addMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: new Date()
    });
  }

  public addSystemText(content: string) {
    this.addMessage({
      id: crypto.randomUUID(),
      role: 'system',
      content,
      timestamp: new Date()
    });
  }

  public addUserText(content: string) {
    this.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date()
    });
  }

  public addOrReplaceCheckoutMessage(content: string, checkout: Checkout) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      checkout
    };

    this.messages.update((messages) => {
      const nextMessages = [...messages];

      for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
        const existingMessage = nextMessages[index];
        if (
          existingMessage.role === 'assistant' &&
          existingMessage.checkout?.id === checkout.id
        ) {
          nextMessages[index] = {
            ...existingMessage,
            content,
            checkout,
            paymentMethods: undefined, // Clear payment options once updated
            timestamp: new Date()
          };
          return nextMessages;
        }
      }

      nextMessages.push(message);
      return nextMessages;
    });
  }

  public clear() {
    this.messages.set([]);
    this.setLoading(false);
  }
}
// Just forcing a touch to ensure Angular dev server hot reloads
