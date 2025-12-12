import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Transacoes from "./pages/Transacoes";
import Recorrentes from "./pages/Recorrentes";
import Relatorios from "./pages/Relatorios";
import Chat from "./pages/Chat";
import Configuracoes from "./pages/Configuracoes";
import Cartoes from "./pages/Cartoes";
import Faturas from "./pages/Faturas";
import Parcelamentos from "./pages/Parcelamentos";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/transacoes" element={<Transacoes />} />
          <Route path="/recorrentes" element={<Recorrentes />} />
          <Route path="/cartoes" element={<Cartoes />} />
          <Route path="/faturas" element={<Faturas />} />
          <Route path="/parcelamentos" element={<Parcelamentos />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
