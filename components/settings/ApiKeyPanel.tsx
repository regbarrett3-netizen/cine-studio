// components/settings/ApiKeyPanel.tsx
import React, { useState } from 'react';
import { useBillingStore } from '../../store/billingStore';

export const ApiKeyPanel: React.FC = () => {
  const { isByoKeyActive, userApiKey, setByoKeyState, credits } = useBillingStore();
  const [tempKey, setTempKey] = useState(userApiKey);
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const active = tempKey.trim().length > 0;
    setByoKeyState(active, tempKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-slate-100 max-w-md shadow-xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold tracking-wide">Studio Billing & API Keys</h3>
        <span className="text-xs bg-slate-800 px-3 py-1 rounded-full text-indigo-400 font-mono">
          Credits: {credits}
        </span>
      </div>

      <p className="text-sm text-slate-400 mb-6">
        Use platform credits or bring your own API keys (BYO) for unlimited generations without platform credit deductions.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-2">
            Custom API Key (Luma / LTX / Suno)
          </label>
          <input
            type="password"
            value={tempKey}
            onChange={(e) => setTempKey(e.target.value)}
            placeholder="sk-..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-xs">
            Status: <span className={isByoKeyActive ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
              {isByoKeyActive ? 'BYO Key Active (Bypassing Credits)' : 'Using Platform Credits'}
            </span>
          </div>

          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {saved ? 'Saved!' : 'Save Key'}
          </button>
        </div>
      </form>
    </div>
  );
};
