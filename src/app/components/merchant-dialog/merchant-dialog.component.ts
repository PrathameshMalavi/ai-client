import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Merchant } from '../../models/types';
import { MerchantRegistryService } from '../../services/merchant-registry.service';

@Component({
  selector: 'app-merchant-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './merchant-dialog.component.html',
  styleUrls: ['./merchant-dialog.component.css']
})
export class MerchantDialogComponent {
  @Output() closeDialog = new EventEmitter<void>();

  registry = inject(MerchantRegistryService);

  isEditing = false;
  editingMerchant: Merchant = this.getEmptyMerchant();

  getEmptyMerchant(): Merchant {
    return {
      id: '',
      name: '',
      url: '',
      type: 'rest'
    };
  }

  onClose() {
    this.closeDialog.emit();
  }

  onAdd() {
    this.isEditing = true;
    this.editingMerchant = {
      ...this.getEmptyMerchant(),
      id: 'merchant-' + Date.now()
    };
  }

  onEdit(merchant: Merchant) {
    this.isEditing = true;
    this.editingMerchant = { ...merchant };
  }

  onDelete(merchant: Merchant) {
    if (confirm(`Are you sure you want to delete ${merchant.name}?`)) {
      this.registry.deleteMerchant(merchant.id);
    }
  }

  onSave() {
    if (!this.editingMerchant.name || !this.editingMerchant.url) {
      alert('Please fill out all fields.');
      return;
    }

    const exists = this.registry.merchants().find(m => m.id === this.editingMerchant.id);
    if (exists) {
      this.registry.updateMerchant(this.editingMerchant);
    } else {
      this.registry.addMerchant(this.editingMerchant);
    }
    this.isEditing = false;
  }

  onCancel() {
    this.isEditing = false;
  }
}
