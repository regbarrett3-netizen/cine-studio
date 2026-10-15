// store/billingStore.ts
import { create } from 'zustand';

interface BillingState {
  credits: number;
  isByoKeyActive: boolean;
  userApiKey: string;
  setCredits: (credits: number) => void;
  deductCredits: (amount: number) => boolean;
  setByoKeyState: (active: boolean, key: string) => void;
}

export const useBillingStore = create<BillingState>((set, get) => ({
  credits: 100, // Starting complimentary credits
  isByoKeyActive: false,
  userApiKey: '',
  setCredits: (credits) => set({ credits }),
  deductCredits: (amount) => {
    const state = get();
    if (state.isByoKeyActive && state.userApiKey.length > 0) {
      return true; // Bypass platform credit deduction if using custom key
    }
    if (state.credits >= amount) {
      set({ credits: state.credits - amount });
      return true;
    }
    return false; // Insufficient credits
  },
  setByoKeyState: (active, key) => set({ isByoKeyActive: active, userApiKey: key }),
}));
