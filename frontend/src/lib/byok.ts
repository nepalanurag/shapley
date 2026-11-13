// Bring-your-own-key (BYOK) helpers.
//
// A user's own Gemini / OpenAI / Claude key is stored ONLY in this
// browser's localStorage and sent ONLY as part of an analyze request
// for the job they start. It is never stored on Shapley's servers:
// the backend holds it in memory for the duration of that one job
// and never writes it to the job record, the logs, or any response.
import { useCallback, useEffect, useState } from "react";

export type AiProvider = "gemini" | "openai" | "anthropic";

export interface ProviderOption {
  id: AiProvider;
  label: string;
  keyLabel: string;
  placeholder: string;
  getKeyUrl: string;
}

export const PROVIDERS: ProviderOption[] = [
  {
    id: "gemini",
    label: "Gemini",
    keyLabel: "Gemini API key",
    placeholder: "AIza…",
    getKeyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openai",
    label: "OpenAI",
    keyLabel: "OpenAI API key",
    placeholder: "sk-…",
    getKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Claude",
    keyLabel: "Anthropic API key",
    placeholder: "sk-ant-…",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
  },
];

export function providerLabel(id: string | undefined | null): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? "Gemini";
}

const PROVIDER_KEY = "shapley_byok_provider";
const keyStorageKey = (p: AiProvider) => `shapley_byok_key_${p}`;

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function getSavedProvider(): AiProvider {
  const saved = readStored<string>(PROVIDER_KEY, "gemini");
  return PROVIDERS.some((p) => p.id === saved) ? (saved as AiProvider) : "gemini";
}

export function getSavedKey(provider: AiProvider): string {
  return readStored<string>(keyStorageKey(provider), "");
}

export function saveKey(provider: AiProvider, key: string) {
  try {
    if (key) localStorage.setItem(keyStorageKey(provider), JSON.stringify(key));
    else localStorage.removeItem(keyStorageKey(provider));
  } catch {
    // Private mode / full storage: the key just won't persist.
  }
}

export interface ByokState {
  enabled: boolean;
  provider: AiProvider;
  apiKey: string;
  setEnabled: (v: boolean) => void;
  setProvider: (p: AiProvider) => void;
  setApiKey: (k: string) => void;
  clear: () => void;
  /** Fields to send with an analyze request, or {} when BYOK is off. */
  requestFields: () => { provider: AiProvider; apiKey: string } | Record<string, never>;
}

/** Owns the BYOK form state and persists it to localStorage. */
export function useByok(): ByokState {
  const [enabled, setEnabledState] = useState(false);
  const [provider, setProviderState] = useState<AiProvider>("gemini");
  const [apiKey, setApiKeyState] = useState("");

  useEffect(() => {
    const savedProvider = getSavedProvider();
    setProviderState(savedProvider);
    const savedKey = getSavedKey(savedProvider);
    if (savedKey) {
      setApiKeyState(savedKey);
      setEnabledState(true);
    }
  }, []);

  const setEnabled = useCallback((v: boolean) => setEnabledState(v), []);
  const setProvider = useCallback((p: AiProvider) => {
    setProviderState(p);
    try {
      localStorage.setItem(PROVIDER_KEY, JSON.stringify(p));
    } catch {
      // ignore
    }
    setApiKeyState(getSavedKey(p));
  }, []);
  const setApiKey = useCallback(
    (k: string) => {
      setApiKeyState(k);
      saveKey(provider, k);
    },
    [provider]
  );
  const clear = useCallback(() => {
    saveKey(provider, "");
    setApiKeyState("");
    setEnabledState(false);
  }, [provider]);
  const requestFields = useCallback((): { provider: AiProvider; apiKey: string } | Record<string, never> => {
    const key = apiKey.trim();
    if (!enabled || !key) return {};
    return { provider, apiKey: key };
  }, [enabled, provider, apiKey]);

  return { enabled, provider, apiKey, setEnabled, setProvider, setApiKey, clear, requestFields };
}
