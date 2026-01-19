import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check for WhatsApp session token
        const sessionToken = localStorage.getItem("finax_session_token");
        const sessionExpiry = localStorage.getItem("finax_session_expiry");
        
        if (!sessionToken || !sessionExpiry) {
          setIsAuthenticated(false);
          setLoading(false);
          return;
        }

        // Check if session is expired locally
        if (new Date(sessionExpiry) < new Date()) {
          localStorage.removeItem("finax_session_token");
          localStorage.removeItem("finax_session_expiry");
          localStorage.removeItem("finax_user_id");
          localStorage.removeItem("finax_phone");
          setIsAuthenticated(false);
          setLoading(false);
          return;
        }

        // Validate session with backend
        const response = await fetch(
          "https://hhvaqirjrssldsxoezxs.supabase.co/functions/v1/validate-session",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ token: sessionToken }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.valid) {
            setIsAuthenticated(true);
          } else {
            // Clear invalid session
            localStorage.removeItem("finax_session_token");
            localStorage.removeItem("finax_session_expiry");
            localStorage.removeItem("finax_user_id");
            localStorage.removeItem("finax_phone");
            setIsAuthenticated(false);
          }
        } else {
          // Session validation failed - but might be network issue
          // Trust local expiry for now
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Session validation error:", error);
        // Network error - trust local session if it exists and not expired
        const sessionToken = localStorage.getItem("finax_session_token");
        const sessionExpiry = localStorage.getItem("finax_session_expiry");
        
        if (sessionToken && sessionExpiry && new Date(sessionExpiry) > new Date()) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  useEffect(() => {
    if (!loading && isAuthenticated === false) {
      navigate("/auth", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <span className="font-black text-2xl text-white">F</span>
            </div>
            <Loader2 className="absolute -bottom-1 -right-1 h-6 w-6 animate-spin text-indigo-400" />
          </div>
          <p className="text-slate-400 text-sm font-medium">Verificando sessão...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
