import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import finaxLogo from "@/assets/finax-logo-transparent.png";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/auth", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <img src={finaxLogo} alt="Finax" className="w-16 h-16 rounded-2xl object-contain shadow-lg shadow-indigo-500/30" />
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
