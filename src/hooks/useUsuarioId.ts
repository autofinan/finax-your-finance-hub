// ============================================================================
// 🔗 HOOK: useUsuarioId - Pega ID do usuário logado via OTP WhatsApp
// ============================================================================
// O AuthContext já retorna o user com id da tabela usuarios.
// Este hook apenas expõe isso de forma consistente para os outros hooks.
// ============================================================================

import { useEffect, useState } from "react";

type UsuarioStorage = {
  usuarioId?: string;
};

export function useUsuarioId() {
  const [usuarioId, setUsuarioId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = localStorage.getItem("usuario");
      if (!raw) {
        setUsuarioId(null);
        return;
      }

      const parsed: UsuarioStorage = JSON.parse(raw);
      setUsuarioId(parsed.usuarioId ?? null);
    } catch (error) {
      console.error("Erro ao ler usuario do localStorage:", error);
      setUsuarioId(null);
    }
  }, []);

  return usuarioId;
}
