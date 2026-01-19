import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Transacoes from "./pages/Transacoes";
import Recorrentes from "./pages/Recorrentes";
import Relatorios from "./pages/Relatorios";
import Chat from "./pages/Chat";
import Configuracoes from "./pages/Configuracoes";
import Cartoes from "./pages/Cartoes";
import Faturas from "./pages/Faturas";
import Parcelamentos from "./pages/Parcelamentos";
import Cancelar from "./pages/Cancelar";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/cancelar" element={<Cancelar />} />
          
          {/* Protected Routes */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/transacoes" element={<ProtectedRoute><Transacoes /></ProtectedRoute>} />
          <Route path="/recorrentes" element={<ProtectedRoute><Recorrentes /></ProtectedRoute>} />
          <Route path="/cartoes" element={<ProtectedRoute><Cartoes /></ProtectedRoute>} />
          <Route path="/faturas" element={<ProtectedRoute><Faturas /></ProtectedRoute>} />
          <Route path="/parcelamentos" element={<ProtectedRoute><Parcelamentos /></ProtectedRoute>} />
          <Route path="/relatorios" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
          <Route path="/configuracoes" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
          
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
