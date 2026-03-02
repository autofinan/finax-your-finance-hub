import { useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import finaxLogo from "@/assets/finax-logo-transparent.png";
import { CheckoutModal } from "@/components/checkout/CheckoutModal";

// ═══════════════════════════════════════════════════════════════
// FINAX LANDING PAGE — Single File, Fintech Premium Brasileira
// Paleta: Cyan/Blue (#06B6D4 → #3B82F6) — dark, fluida, persuasiva
// ═══════════════════════════════════════════════════════════════

const WA_LINK = `https://wa.me/556581034588?text=${encodeURIComponent("Quero começar meu trial grátis no Finax")}`;
const SITE_URL = "https://finaxai.vercel.app";

const B = {
  bg: "#070B12", bg2: "#0C1220", surface: "#111827", card: "#151E2E",
  border: "#1E2D45", borderHi: "#2A3F60",
  cyan: "#06B6D4", cyanDim: "#0891B2", blue: "#3B82F6", blueDim: "#2563EB",
  green: "#10B981", amber: "#F59E0B",
  text: "#F0F6FF", textSub: "#94A3B8", textDim: "#4B5A6E",
  wa: "#25D366",
};
const GRAD = `linear-gradient(135deg, ${B.cyan}, ${B.blue})`;

// ── Chat conversations ─────────────────────────────────────────
const conversations = [
  { id: 0, tag: "Registro rápido", color: B.cyan, user: "Almoco 45 credito nubank", bot: "✅ *Registrado!*\n\n💸 R$ 45,00 — Almoço\n📂 Alimentação · 💳 Nubank\n\nNubank disponível: *R$ 1.955,00*", time: "12:31" },
  { id: 1, tag: "Pix na hora", color: B.blue, user: "uber 18,50 pix", bot: "🚗 *Registrado!*\n\n💸 R$ 18,50 — Uber\n📂 Transporte · 📱 Pix\n📅 Hoje, 09:47", time: "09:47" },
  { id: 2, tag: "Resumo mensal", color: "#A78BFA", user: "como tá meu mês?", bot: "📊 *Fevereiro 2026*\n\n💰 Saldo: *+R$ 2.260*\n💸 Saídas: R$ 3.240\n💵 Entradas: R$ 5.500\n\n🏆 Maior gasto: Alimentação R$ 890", time: "18:22" },
  { id: 3, tag: "Por categoria", color: B.amber, user: "gastos com alimentação", bot: "🍽️ *Alimentação — Fev*\n\nTotal: *R$ 890,00*\n• iFood 38% · Restaurantes 36%\n\n⚠️ 18% acima do mês passado", time: "14:05" },
  { id: 4, tag: "Recorrente", color: B.green, user: "netflix 55 todo mes", bot: "🔄 *Recorrente salvo!*\n\n📝 Netflix · R$ 55/mês\n📅 Todo dia 19\n\n✅ Já registrei hoje e agendei os próximos!", time: "20:14" },
];

// ═══════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════
function useTypewriter(text: string, active: boolean, speed = 18) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active) { setOut(""); setDone(false); return; }
    setOut(""); setDone(false);
    let i = 0;
    const tick = () => {
      i++;
      setOut(text.slice(0, i));
      if (i >= text.length) { setDone(true); return; }
      setTimeout(tick, speed + Math.random() * 14 - 7);
    };
    const t = setTimeout(tick, 80);
    return () => clearTimeout(t);
  }, [text, active, speed]);
  return { out, done };
}

function useReveal(threshold = 0.15): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

function Counter({ val, suf = "" }: { val: string; suf?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !done.current) {
        done.current = true;
        const num = parseFloat(val);
        let cur = 0; const steps = 50;
        const t = setInterval(() => {
          cur = Math.min(cur + num / steps, num);
          setN(cur);
          if (cur >= num) clearInterval(t);
        }, 1600 / steps);
      }
    }, { threshold: .5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [val]);
  const d = String(val).includes(".") ? n.toFixed(1) : Math.round(n).toLocaleString("pt-BR");
  return <span ref={ref}>{d}{suf}</span>;
}

// ═══════════════════════════════════════════════════════════════
// CHAT MOCKUP
// ═══════════════════════════════════════════════════════════════
function ChatMockup({ compact = false }) {
  const [idx, setIdx] = useState(0);
  const conv = conversations[idx];
  const [phase, setPhase] = useState("idle");
  const [msgs, setMsgs] = useState<Array<{from: string; text: string}>>([]);
  const [checks, setChecks] = useState("✓");
  const [showBot, setShowBot] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { out: inputOut, done: inputDone } = useTypewriter(conv.user, phase === "typing", 19);
  const { out: botOut, done: botDone } = useTypewriter(conv.bot, phase === "botTyping", 8);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, inputOut, botOut, phase]);

  useEffect(() => {
    setMsgs([]); setChecks("✓"); setShowBot(false); setPhase("idle");
    const t = setTimeout(() => setPhase("typing"), 700);
    return () => clearTimeout(t);
  }, [idx]);

  useEffect(() => {
    if (phase !== "typing" || !inputDone) return;
    const t = setTimeout(() => { setMsgs([{ from: "u", text: conv.user }]); setPhase("sent"); }, 300);
    return () => clearTimeout(t);
  }, [phase, inputDone, conv]);

  useEffect(() => {
    if (phase !== "sent") return;
    const t1 = setTimeout(() => setChecks("✓✓"), 650);
    const t2 = setTimeout(() => setPhase("waiting"), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const t = setTimeout(() => { setShowBot(true); setPhase("botTyping"); }, 800);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "botTyping" || !botDone) return;
    const t1 = setTimeout(() => { setMsgs(p => [...p, { from: "b", text: conv.bot }]); setShowBot(false); setPhase("done"); }, 200);
    const t2 = setTimeout(() => setIdx(i => (i + 1) % conversations.length), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase, botDone, conv]);

  const h = compact ? 190 : 230;

  return (
    <div style={{ width: compact ? 270 : 300, borderRadius: 22, overflow: "hidden", background: "#0b141a", boxShadow: `0 32px 80px rgba(0,0,0,.7), 0 0 0 1px ${B.border}, 0 0 60px ${conv.color}12`, fontFamily: "-apple-system, 'SF Pro Text', sans-serif", transition: "box-shadow 0.5s" }}>
      {/* Header */}
      <div style={{ background: "#1f2c34", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <img src={finaxLogo} alt="Finax" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#e9edef", fontWeight: 600, fontSize: 14 }}>Finax</div>
          <div style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: phase === "waiting" ? B.amber : B.wa, display: "inline-block", animation: "pulse 2s infinite" }} />
            <span style={{ color: phase === "waiting" ? B.amber : B.wa }}>{phase === "waiting" ? "digitando..." : "online"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {conversations.map((_, i) => (
            <div key={i} style={{ width: i === idx ? 16 : 5, height: 5, borderRadius: 3, background: i === idx ? conv.color : "#2a3942", transition: "all .4s" }} />
          ))}
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} style={{ height: h, overflowY: "auto", padding: "10px 10px 6px", background: "#0b141a", display: "flex", flexDirection: "column", gap: 7, scrollbarWidth: "none" }}>
        <div style={{ textAlign: "center", marginBottom: 2 }}>
          <span style={{ background: "#1f2c34", color: "#607d8b", fontSize: 10, padding: "3px 10px", borderRadius: 10 }}>{conv.tag}</span>
        </div>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.from === "u" ? "flex-end" : "flex-start", animation: "slideUp .25s ease" }}>
            <div style={{ maxWidth: "86%", padding: "7px 11px", background: m.from === "u" ? "#005c4b" : "#202c33", color: "#e9edef", fontSize: 12.5, lineHeight: 1.55, borderRadius: m.from === "u" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", whiteSpace: "pre-line" }}>
              {m.text}
              <div style={{ fontSize: 10, color: "#8696a0", textAlign: "right", marginTop: 2 }}>
                {conv.time}{m.from === "u" && <span style={{ marginLeft: 4, color: "#53bdeb" }}>{checks}</span>}
              </div>
            </div>
          </div>
        ))}
        {phase === "waiting" && (
          <div style={{ display: "flex", animation: "slideUp .2s ease" }}>
            <div style={{ background: "#202c33", padding: "9px 13px", borderRadius: "12px 12px 12px 2px", display: "flex", gap: 4 }}>
              {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#8696a0", display: "inline-block", animation: `typingDot 1s ${i*.22}s infinite` }} />)}
            </div>
          </div>
        )}
        {showBot && phase === "botTyping" && (
          <div style={{ display: "flex", animation: "slideUp .2s ease" }}>
            <div style={{ maxWidth: "86%", padding: "7px 11px", background: "#202c33", color: "#e9edef", fontSize: 12.5, lineHeight: 1.55, borderRadius: "12px 12px 12px 2px", whiteSpace: "pre-line" }}>
              {botOut}<span style={{ opacity: .5, animation: "pulse 1s infinite" }}>▍</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ background: "#1f2c34", padding: "7px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, background: "#2a3942", borderRadius: 20, padding: "8px 13px", fontSize: 12.5, color: phase === "typing" ? "#e9edef" : "#607d8b", display: "flex", alignItems: "center", minHeight: 34 }}>
          {phase === "typing" ? <>{inputOut}<span style={{ animation: "pulse 1s infinite", opacity: .7 }}>▍</span></> : "Mensagem"}
        </div>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: phase === "typing" ? B.cyan : B.wa, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, transition: "background .3s", flexShrink: 0 }}>
          {phase === "typing" ? "➤" : "🎤"}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FEATURE CARD
// ═══════════════════════════════════════════════════════════════
function FeatureCard({ icon, title, desc, ex, color }: { icon: string; title: string; desc: string; ex: string; color: string }) {
  const [hov, setHov] = useState(false);
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
      background: hov ? B.card : B.surface, border: `1px solid ${hov ? color + "50" : B.border}`, borderRadius: 16, padding: 24,
      transition: "all .25s ease", transform: hov ? "translateY(-5px)" : "none",
      boxShadow: hov ? `0 16px 48px rgba(0,0,0,.25), 0 0 0 1px ${color}15` : "none", cursor: "default",
    }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 7 }}>{title}</div>
      <div style={{ color: B.textSub, fontSize: 13.5, lineHeight: 1.65, marginBottom: 12 }}>{desc}</div>
      <div style={{ background: color + "12", border: `1px solid ${color}25`, borderRadius: 8, padding: "7px 11px", fontSize: 12, color, fontFamily: "monospace" }}>{ex}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN LANDING
// ═══════════════════════════════════════════════════════════════
export default function Landing() {
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [heroRef, heroVisible] = useReveal(0.1);
  const navigate = useNavigate();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<'basico' | 'pro'>('pro');

  const go = () => window.open(WA_LINK, "_blank");
  const goAuth = (plan?: string) => navigate(plan ? `/auth?plan=${plan}` : "/auth");
  const goCheckout = (plan: 'basico' | 'pro') => { setCheckoutPlan(plan); setCheckoutOpen(true); };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  // Section refs
  const [baRef, baVis] = useReveal();
  const [howRef, howVis] = useReveal();
  const [featRef, featVis] = useReveal();
  const [compRef, compVis] = useReveal();
  const [priceRef, priceVis] = useReveal();
  const [testiRef, testiVis] = useReveal();
  const [faqRef, faqVis] = useReveal();
  const [ctaRef, ctaVis] = useReveal();

  const steps = [
    { n: "01", icon: "💬", title: "Manda a mensagem", desc: "Texto, áudio de voz ou foto do cupom. Exatamente como você já usa o WhatsApp todo dia.", ex: '"Café 12 pix"', color: B.cyan },
    { n: "02", icon: "🧠", title: "A Finax entende tudo", desc: "A IA identifica valor, categoria, cartão e forma de pagamento. Aprende seus padrões com o tempo.", ex: "Categoria · Pagamento · Cartão detectados", color: B.blue },
    { n: "03", icon: "📊", title: "Você vê os resultados", desc: "Peça relatórios, alertas de orçamento e insights — tudo direto no WhatsApp, na hora que quiser.", ex: '"Quanto gastei essa semana?"', color: B.green },
  ];

  const features = [
    { icon: "📱", title: "Registro em 2s", desc: "Texto, áudio ou foto do cupom fiscal. A Finax lê tudo.", ex: '"mercado 180 debito"', color: B.cyan },
    { icon: "🧠", title: "Aprende seus padrões", desc: "Lembra que café é pix e uber é débito. Quanto mais usa, menos digita.", ex: "Memória automática ativada", color: B.blue },
    { icon: "💳", title: "Limite de cartão", desc: "Saldo disponível em tempo real em cada cartão. Zero surpresa.", ex: "Nubank disponível: R$ 1.955", color: "#A78BFA" },
    { icon: "🔄", title: "Recorrentes", desc: "Fala uma vez. Netflix, academia, aluguel — a Finax agenda tudo sozinha.", ex: '"netflix 55 todo mês" → ok', color: B.amber },
    { icon: "✈️", title: "Modo viagem", desc: "Ativa um contexto e todos os gastos do período ficam agrupados.", ex: "Viagem SP · R$ 1.240 total", color: B.green },
    { icon: "⚠️", title: "Alertas proativos", desc: "Avisa antes de estourar — 50%, 80% e 100% do orçamento.", ex: "⚠️ 80% do limite de lazer", color: "#EF4444" },
    { icon: "📊", title: "Relatórios no chat", desc: "Peça por mensagem a qualquer momento. Por categoria, período ou cartão.", ex: '"gastos com alimentação"', color: B.cyan },
    { icon: "📷", title: "OCR de cupom", desc: "Foto da nota fiscal? A Finax lê e registra automaticamente.", ex: "Leitura automática de NF", color: B.blue },
    { icon: "🎯", title: "Metas de economia", desc: "Defina metas e acompanhe o progresso semana a semana.", ex: "Meta viagem: 67% atingida 🎉", color: B.green },
  ];

  const compareRows: [string, boolean, boolean][] = [
    ["Registro por texto, áudio e foto", true, true],
    ["Aprende seus padrões automaticamente", true, false],
    ["Limite de cartão em tempo real", true, false],
    ["Modo viagem / contexto temporal", true, false],
    ["Parcelamentos rastreados", true, false],
    ["Alerta antes de estourar o orçamento", true, true],
    ["OCR de cupom fiscal", true, false],
    ["Não precisa instalar nenhum app", true, false],
    ["Trial grátis sem cartão de crédito", true, false],
  ];

  const testimonials = [
    { name: "Marina S.", role: "Empreendedora, 29 anos", letter: "M", color: B.cyan, text: "Descobri que gastava R$ 600/mês com delivery sem perceber. Na primeira semana usando a Finax, vi isso claramente. Cortei pela metade.", badge: "Economizou R$ 300/mês" },
    { name: "João P.", role: "Designer, 26 anos", letter: "J", color: B.blue, text: "Finalmente um app que não preciso lembrar de abrir. Só mando mensagem e tá lá. Uso há 3 meses e nunca perdi um gasto.", badge: "Zero gastos perdidos" },
    { name: "Ana L.", role: "Professora, 34 anos", letter: "A", color: "#A78BFA", text: "Os alertas me salvaram de estourar o cartão duas vezes em um mês. Agora tenho R$ 800 de reserva de emergência pela primeira vez na vida.", badge: "Primeira reserva de emergência" },
  ];

  const faqItems = [
    { q: "Preciso instalar algum aplicativo?", a: "Não. O Finax funciona 100% pelo WhatsApp. Você já tem o app — só adiciona nosso número e começa a conversar. Zero instalação." },
    { q: "E se eu não tiver disciplina para usar todo dia?", a: "Essa é exatamente a razão pela qual o Finax funciona — você não precisa de disciplina. Só manda uma mensagem quando gasta. Se não lembrar, o Finax te lembra." },
    { q: "Como funciona o trial de 14 dias?", a: "Você começa pelo WhatsApp, usa todas as funcionalidades do plano Pro por 14 dias sem precisar de cartão de crédito. Só paga se decidir continuar." },
    { q: "Qual é a precisão real da IA?", a: "Mais de 95% dos registros não precisam de nenhuma correção. Para os outros 5%, a Finax confirma antes de salvar." },
    { q: "Posso usar com a minha família?", a: "Sim, no plano Pro. Cada membro registra pelo próprio WhatsApp e todos têm visão do orçamento compartilhado." },
    { q: "Meus dados financeiros estão seguros?", a: "Sim. Criptografia em trânsito e em repouso, e jamais compartilhamos seus dados com terceiros." },
  ];

  return (
    <div id="top" style={{ background: B.bg, color: B.text, fontFamily: "'Sora', 'Plus Jakarta Sans', system-ui, sans-serif", overflowX: "hidden" }}>
      {/* ═══ GLOBAL STYLES ═══ */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:${B.bg}}
        ::-webkit-scrollbar-thumb{background:${B.borderHi};border-radius:2px}
        ::selection{background:${B.cyan}30}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
        @keyframes typingDot{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
        @keyframes glow{0%,100%{opacity:.4}50%{opacity:.8}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        .reveal{opacity:0;transform:translateY(24px);transition:opacity .7s ease, transform .7s ease}
        .reveal.visible{opacity:1;transform:none}
        .stagger-1{transition-delay:.1s!important}.stagger-2{transition-delay:.2s!important}.stagger-3{transition-delay:.3s!important}
        .btn-primary{display:inline-flex;align-items:center;gap:10px;background:${GRAD};color:#fff;border:none;border-radius:14px;padding:17px 32px;font-size:17px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 8px 32px ${B.cyan}35;transition:all .25s ease}
        .btn-primary:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 16px 48px ${B.cyan}50}
        .btn-primary:active{transform:scale(.98)}
        .btn-wa{display:inline-flex;align-items:center;gap:10px;background:${B.wa};color:#fff;border:none;border-radius:14px;padding:17px 32px;font-size:17px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 8px 32px ${B.wa}35;transition:all .25s ease}
        .btn-wa:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 16px 48px ${B.wa}50}
        .btn-ghost{display:inline-flex;align-items:center;gap:8px;background:transparent;color:${B.text};border:1.5px solid ${B.border};border-radius:14px;padding:16px 28px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .25s ease}
        .btn-ghost:hover{border-color:${B.cyan};color:${B.cyan};transform:translateY(-1px)}
        .card{background:${B.card};border:1px solid ${B.border};border-radius:20px;padding:28px;transition:all .25s ease}
        .card:hover{border-color:${B.borderHi};transform:translateY(-4px);box-shadow:0 20px 60px rgba(0,0,0,.3)}
        .tag{display:inline-flex;align-items:center;gap:7px;border-radius:100px;padding:6px 16px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
        .gradient-text{background:${GRAD};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .nav-item{background:none;border:none;cursor:pointer;color:${B.textSub};font-size:14px;font-weight:500;font-family:inherit;transition:color .2s;padding:6px 2px}
        .nav-item:hover{color:${B.text}}
        @media(max-width:900px){
          .hero-grid{grid-template-columns:1fr!important}
          .hero-text{text-align:center}
          .hero-ctas{justify-content:center!important}
          .hero-trust{justify-content:center!important}
          .hero-mock{margin-top:40px;justify-content:center!important}
          .hero-h1{font-size:38px!important;letter-spacing:-1.5px!important}
          .steps-grid{grid-template-columns:1fr!important}
          .feat-grid{grid-template-columns:1fr 1fr!important}
          .plans-grid{grid-template-columns:1fr!important}
          .testi-grid{grid-template-columns:1fr!important}
          .stats-grid{grid-template-columns:1fr 1fr!important;gap:20px!important}
          .section-h{font-size:30px!important;letter-spacing:-1px!important}
          .compare-grid{grid-template-columns:1fr 70px 70px!important}
          .nav-links{display:none!important}
          .footer-row{flex-direction:column!important;text-align:center}
          .ba-grid{grid-template-columns:1fr!important}
          .ba-arrow{display:none!important}
          .nav-ctas .btn-primary{padding:8px 14px!important;font-size:12px!important}
        }
        @media(max-width:540px){
          .feat-grid{grid-template-columns:1fr!important}
          .hero-h1{font-size:30px!important}
          .nav-ctas .nav-enter{display:none!important}
        }
      `}</style>

      {/* ═══ NAVBAR ═══ */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, backdropFilter: "blur(20px)", background: `${B.bg}D8`, borderBottom: `1px solid ${B.border}`, height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => scrollTo("top")}>
          <img src={finaxLogo} alt="Finax" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontWeight: 900, fontSize: 20, letterSpacing: -.5 }} className="gradient-text">Finax</span>
        </div>
        <div className="nav-links" style={{ display: "flex", gap: 28, alignItems: "center" }}>
          {[["como-funciona","Como funciona"],["recursos","Recursos"],["planos","Planos"],["faq","FAQ"]].map(([id, label]) => (
            <button key={id} className="nav-item" onClick={() => scrollTo(id)}>{label}</button>
          ))}
        </div>
        <div className="nav-ctas" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="nav-enter btn-ghost" onClick={() => goAuth()} style={{ padding: "8px 18px", fontSize: 13, borderRadius: 10 }}>Entrar</button>
          <button className="btn-primary" style={{ padding: "10px 22px", fontSize: 14, borderRadius: 10 }} onClick={go}>Começar grátis →</button>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section style={{ minHeight: "100vh", display: "flex", alignItems: "center", padding: "100px 32px 60px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}>
          <div style={{ position: "absolute", top: "-10%", left: "-5%", width: 700, height: 700, borderRadius: "50%", background: `radial-gradient(circle, ${B.cyan}18 0%, transparent 65%)`, animation: "glow 5s ease-in-out infinite" }} />
          <div style={{ position: "absolute", bottom: "-5%", right: "-8%", width: 600, height: 600, borderRadius: "50%", background: `radial-gradient(circle, ${B.blue}14 0%, transparent 65%)`, animation: "glow 7s ease-in-out infinite", animationDelay: "2s" }} />
          <div style={{ position: "absolute", inset: 0, backgroundImage: `linear-gradient(${B.cyan}08 1px, transparent 1px), linear-gradient(90deg, ${B.cyan}08 1px, transparent 1px)`, backgroundSize: "60px 60px", maskImage: "radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)" }} />
        </div>
        <div className="hero-grid" ref={heroRef as any} style={{ maxWidth: 1160, margin: "0 auto", width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center", position: "relative", zIndex: 1, animation: "fadeUp .8s ease forwards" }}>
          <div className="hero-text">
            <div className="tag" style={{ background: `${B.cyan}15`, border: `1px solid ${B.cyan}35`, color: B.cyan, marginBottom: 28 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: B.cyan, animation: "pulse 2s infinite", display: "inline-block" }} />
              14 dias grátis · Sem cartão de crédito
            </div>
            <h1 className="hero-h1" style={{ fontSize: 58, fontWeight: 900, lineHeight: 1.08, letterSpacing: -2.5, marginBottom: 22 }}>
              <span>No fim do mês,</span><br />
              <span>você sabe que</span><br />
              <span>gastou. Mas</span><br />
              <span className="gradient-text">não sabe onde.</span>
            </h1>
            <p style={{ color: B.textSub, fontSize: 18, lineHeight: 1.75, marginBottom: 36, maxWidth: 460 }}>
              A Finax resolve isso. Manda uma mensagem no WhatsApp — texto, áudio ou foto — e sua vida financeira se organiza <strong style={{ color: B.text }}>em segundos</strong>, sem instalar nada.
            </p>
            <div className="hero-ctas" style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
              <button className="btn-wa" onClick={go}><span style={{ fontSize: 20 }}>💬</span> Testar 14 dias grátis</button>
              <button className="btn-ghost" onClick={() => scrollTo("como-funciona")}>Ver como funciona</button>
            </div>
            <div className="hero-trust" style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
              {["✓ Sem cartão","✓ Sem app para instalar","✓ Cancele quando quiser"].map(t => (
                <span key={t} style={{ fontSize: 13, color: B.textSub }}>{t}</span>
              ))}
            </div>
            <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: B.surface, border: `1px solid ${B.border}`, borderRadius: 14, maxWidth: 400 }}>
              <div style={{ display: "flex" }}>
                {["#06B6D4","#3B82F6","#10B981","#F59E0B"].map((c,i) => (
                  <div key={i} style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg,${c},${c}80)`, border: `2px solid ${B.bg}`, marginLeft: i ? -8 : 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff" }}>{["M","J","A","C"][i]}</div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>+47 pessoas no beta</div>
                <div style={{ fontSize: 12, color: B.textSub }}>já controlando as finanças</div>
              </div>
            </div>
          </div>
          <div className="hero-mock" style={{ display: "flex", justifyContent: "center", animation: "float 4.5s ease-in-out infinite" }}>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", inset: -2, borderRadius: 26, background: GRAD, opacity: .15, filter: "blur(20px)" }} />
              <ChatMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ STATS BAR ═══ */}
      <div style={{ borderTop: `1px solid ${B.border}`, borderBottom: `1px solid ${B.border}`, padding: "44px 32px", background: B.bg2 }}>
        <div className="stats-grid" style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32 }}>
          {[
            { val: "14", suf: " dias", label: "de trial grátis" },
            { val: "95", suf: "%", label: "registros sem correção" },
            { val: "2", suf: "s", label: "para registrar um gasto" },
            { val: "3", suf: " formatos", label: "texto · áudio · foto" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: -1, lineHeight: 1, marginBottom: 6 }} className="gradient-text">
                <Counter val={s.val} suf={s.suf} />
              </div>
              <div style={{ fontSize: 13, color: B.textSub }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ ANTES vs DEPOIS ═══ */}
      <section style={{ padding: "90px 32px" }}>
        <div ref={baRef as any} className={`reveal ${baVis ? "visible" : ""}`} style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div className="tag" style={{ background: `${B.blue}15`, border: `1px solid ${B.blue}30`, color: B.blue, marginBottom: 20 }}>A realidade de quem não controla</div>
            <h2 className="section-h" style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1.5 }}>Você se reconhece <span className="gradient-text">aqui?</span></h2>
          </div>
          <div className="ba-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 24, alignItems: "center" }}>
            <div style={{ background: "#1A0F0F", border: "1px solid #3D1515", borderRadius: 20, padding: 28 }}>
              <div style={{ color: "#EF4444", fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 18 }}>❌ Sem o Finax</div>
              {["Fim do mês, zero no saldo e não sabe por quê","Abre o app de finanças, fecha em 30 segundos","Planilha que funcionou por 3 dias","Assinaturas que você nem lembra que tem","Cartão estourado sempre na pior hora"].map(t => (
                <div key={t} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
                  <span style={{ color: "#EF4444", flexShrink: 0, marginTop: 1 }}>✕</span>
                  <span style={{ color: "#94A3B8", fontSize: 14, lineHeight: 1.5 }}>{t}</span>
                </div>
              ))}
            </div>
            <div className="ba-arrow" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: `0 0 24px ${B.cyan}40` }}>→</div>
            </div>
            <div style={{ background: `${B.cyan}08`, border: `1px solid ${B.cyan}25`, borderRadius: 20, padding: 28 }}>
              <div className="gradient-text" style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 18 }}>✅ Com o Finax</div>
              {["Sabe exatamente para onde vai cada centavo","Uma mensagem no WhatsApp e está registrado","Funciona porque você já usa o WhatsApp","Alerta antes de estourar o limite","Cartão controlado com limite em tempo real"].map(t => (
                <div key={t} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
                  <span style={{ color: B.cyan, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <span style={{ color: B.text, fontSize: 14, lineHeight: 1.5 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ COMO FUNCIONA ═══ */}
      <section id="como-funciona" style={{ padding: "90px 32px", background: B.bg2 }}>
        <div ref={howRef as any} className={`reveal ${howVis ? "visible" : ""}`} style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div className="tag" style={{ background: `${B.cyan}15`, border: `1px solid ${B.cyan}30`, color: B.cyan, marginBottom: 20 }}>⚡ Simples assim</div>
            <h2 className="section-h" style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1.5, marginBottom: 12 }}>3 passos. <span className="gradient-text">Zero complicação.</span></h2>
            <p style={{ color: B.textSub, fontSize: 17, maxWidth: 460, margin: "0 auto" }}>Se você sabe usar o WhatsApp, você já sabe usar o Finax.</p>
          </div>
          <div className="steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
            {steps.map((s, i) => (
              <div key={s.n} className={`card stagger-${i+1} reveal ${howVis ? "visible" : ""}`} style={{ position: "relative" }}>
                <div style={{ position: "absolute", top: -14, left: 24, background: s.color, color: "#000", fontSize: 11, fontWeight: 900, padding: "4px 13px", borderRadius: 100, letterSpacing: 1 }}>{s.n}</div>
                <div style={{ fontSize: 36, marginBottom: 16, marginTop: 10 }}>{s.icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>{s.title}</h3>
                <p style={{ color: B.textSub, fontSize: 14, lineHeight: 1.7, marginBottom: 14 }}>{s.desc}</p>
                <div style={{ background: s.color + "12", border: `1px solid ${s.color}28`, borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: s.color, fontFamily: "monospace" }}>{s.ex}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 48 }}>
            <p style={{ color: B.textSub, fontSize: 15, marginBottom: 16 }}>Quer ver isso no seu WhatsApp agora?</p>
            <button className="btn-wa" onClick={go} style={{ fontSize: 15, padding: "14px 28px" }}>
              <span>💬</span> Testar em 30 segundos
            </button>
          </div>
        </div>
      </section>

      {/* ═══ RECURSOS ═══ */}
      <section id="recursos" style={{ padding: "90px 32px" }}>
        <div ref={featRef as any} className={`reveal ${featVis ? "visible" : ""}`} style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div className="tag" style={{ background: `${B.blue}15`, border: `1px solid ${B.blue}30`, color: B.blue, marginBottom: 20 }}>Recursos</div>
            <h2 className="section-h" style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1.5, marginBottom: 12 }}>Tudo que você precisa.<br/><span className="gradient-text">Nada que você não usa.</span></h2>
          </div>
          <div className="feat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {features.map(f => <FeatureCard key={f.title} {...f} />)}
          </div>
        </div>
      </section>

      {/* ═══ COMPARAÇÃO ═══ */}
      <section style={{ padding: "90px 32px", background: B.bg2 }}>
        <div ref={compRef as any} className={`reveal ${compVis ? "visible" : ""}`} style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div className="tag" style={{ background: `${B.cyan}15`, border: `1px solid ${B.cyan}30`, color: B.cyan, marginBottom: 20 }}>Comparação</div>
            <h2 className="section-h" style={{ fontSize: 38, fontWeight: 900, letterSpacing: -1.5, marginBottom: 10 }}>Finax vs <span style={{ color: B.textDim }}>os outros</span></h2>
            <p style={{ color: B.textSub, fontSize: 15 }}>Não é mais um assistente financeiro. É o único que realmente te conhece.</p>
          </div>
          <div style={{ border: `1px solid ${B.border}`, borderRadius: 20, overflow: "hidden" }}>
            <div className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", padding: "14px 24px", background: B.card, borderBottom: `1px solid ${B.border}` }}>
              <span style={{ color: B.textDim, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Funcionalidade</span>
              <span style={{ textAlign: "center", fontSize: 13, fontWeight: 800 }} className="gradient-text">FINAX</span>
              <span style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: B.textSub }}>OUTROS</span>
            </div>
            {compareRows.map(([f, a, b], i) => (
              <div key={f as string} className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", padding: "13px 24px", borderBottom: i < compareRows.length - 1 ? `1px solid ${B.border}` : "none", background: i % 2 === 0 ? "transparent" : `${B.cyan}03`, alignItems: "center" }}>
                <span style={{ color: B.text, fontSize: 13.5 }}>{f}</span>
                <span style={{ textAlign: "center", fontSize: 16 }}>{a ? "✅" : "❌"}</span>
                <span style={{ textAlign: "center", fontSize: 16 }}>{b ? "✅" : "❌"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PREÇOS ═══ */}
      <section id="planos" style={{ padding: "90px 32px" }}>
        <div ref={priceRef as any} className={`reveal ${priceVis ? "visible" : ""}`} style={{ maxWidth: 980, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div className="tag" style={{ background: `${B.green}15`, border: `1px solid ${B.green}30`, color: B.green, marginBottom: 20 }}>Planos</div>
            <h2 className="section-h" style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1.5, marginBottom: 10 }}>Menos que uma pizza. <span className="gradient-text">Por mês.</span></h2>
            <p style={{ color: B.textSub, fontSize: 16 }}>Economize muito mais do que paga. Ou <strong style={{ color: B.text }}>devolvemos tudo em 7 dias.</strong></p>
          </div>
          <div className="plans-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* BÁSICO */}
            <div className="card" style={{ borderRadius: 24, padding: 36 }}>
              <div style={{ color: B.textSub, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Básico</div>
              <div style={{ marginBottom: 4 }}><span style={{ fontSize: 46, fontWeight: 900 }}>R$ 19</span><span style={{ color: B.textSub }}>,90/mês</span></div>
              <div style={{ color: B.textSub, fontSize: 13, marginBottom: 8 }}>Organização + consciência</div>
              <div style={{ color: B.textSub, fontSize: 12, marginBottom: 24, fontStyle: "italic" }}>~R$ 0,66 por dia. Menos que um café.</div>
              <div style={{ height: 1, background: B.border, marginBottom: 22 }} />
              {["Registro ilimitado (texto, áudio, foto)","Categorização automática com IA","Relatórios semanais e mensais","Alertas de orçamento","Até 2 cartões de crédito","Até 5 metas de economia","Gastos recorrentes","Histórico completo"].map(f => (
                <div key={f} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                  <span style={{ color: B.cyan, flexShrink: 0 }}>✓</span>
                  <span style={{ color: B.textSub, fontSize: 13.5 }}>{f}</span>
                </div>
              ))}
              <button onClick={go} className="btn-wa" style={{ width: "100%", justifyContent: "center", marginTop: 24, padding: "13px", fontSize: 14 }}>
                <span>💬</span> Testar grátis pelo WhatsApp
              </button>
              <button onClick={() => goCheckout("basico")} className="btn-ghost" style={{ width: "100%", justifyContent: "center", marginTop: 10, padding: "11px", fontSize: 13 }}>Assinar direto → R$ 19,90/mês</button>
            </div>
            {/* PRO */}
            <div style={{ background: `linear-gradient(160deg, ${B.card}, #08111f)`, border: `2px solid ${B.cyan}45`, borderRadius: 24, padding: 36, position: "relative", boxShadow: `0 0 60px ${B.cyan}10, 0 20px 60px rgba(0,0,0,.3)` }}>
              <div style={{ position: "absolute", top: -15, left: "50%", transform: "translateX(-50%)", background: GRAD, color: "#000", fontSize: 11, fontWeight: 900, padding: "5px 18px", borderRadius: 100, whiteSpace: "nowrap", boxShadow: `0 4px 16px ${B.cyan}40` }}>⭐ MAIS POPULAR</div>
              <div className="gradient-text" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Pro</div>
              <div style={{ marginBottom: 4 }}><span style={{ fontSize: 46, fontWeight: 900 }}>R$ 29</span><span style={{ color: B.textSub }}>,90/mês</span></div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `${B.green}15`, border: `1px solid ${B.green}30`, borderRadius: 8, padding: "5px 12px", marginBottom: 8 }}>
                <span style={{ color: B.green, fontSize: 12, fontWeight: 700 }}>✓ 14 dias grátis · sem cartão</span>
              </div>
              <div style={{ color: B.textSub, fontSize: 12, marginBottom: 22, fontStyle: "italic" }}>~R$ 1,00 por dia. Um investimento, não um gasto.</div>
              <div style={{ height: 1, background: `${B.cyan}25`, marginBottom: 22 }} />
              {["Tudo do plano Básico","Cartões ilimitados com limite em tempo real","Simulador de quitação de dívidas","Insights preditivos com IA","Parcelamentos rastreados","Modo viagem / contextos temporais","Metas de economia ilimitadas","OCR de cupom fiscal","Suporte prioritário 2h"].map(f => (
                <div key={f} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                  <span style={{ color: B.cyan, flexShrink: 0 }}>✓</span>
                  <span style={{ color: B.text, fontSize: 13.5 }}>{f}</span>
                </div>
              ))}
              <button className="btn-primary" onClick={go} style={{ width: "100%", justifyContent: "center", marginTop: 24, padding: "15px" }}>
                <span style={{ fontSize: 18 }}>💬</span> Começar Trial Pro Grátis
              </button>
              <button onClick={() => goCheckout("pro")} className="btn-ghost" style={{ width: "100%", justifyContent: "center", marginTop: 10, padding: "11px", fontSize: 13 }}>Assinar direto → R$ 29,90/mês</button>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 28, display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap" }}>
            {["🔒 Garantia de 7 dias","💳 Sem cartão de crédito","🔄 Cancele quando quiser"].map(t => (
              <span key={t} style={{ color: B.textSub, fontSize: 13 }}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ DEPOIMENTOS ═══ */}
      <section style={{ padding: "90px 32px", background: B.bg2 }}>
        <div ref={testiRef as any} className={`reveal ${testiVis ? "visible" : ""}`} style={{ maxWidth: 1060, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 52 }}>
            <div className="tag" style={{ background: `${B.amber}15`, border: `1px solid ${B.amber}30`, color: B.amber, marginBottom: 20 }}>⭐ Depoimentos</div>
            <h2 className="section-h" style={{ fontSize: 38, fontWeight: 900, letterSpacing: -1.5, marginBottom: 10 }}>Quem usa, <span className="gradient-text">recomenda</span></h2>
          </div>
          <div className="testi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {testimonials.map((t, i) => (
              <div key={t.name} className={`card stagger-${i+1} reveal ${testiVis ? "visible" : ""}`} style={{ position: "relative", borderRadius: 20, padding: 28 }}>
                <div style={{ position: "absolute", top: -12, right: 20, background: t.color + "20", border: `1px solid ${t.color}40`, borderRadius: 100, padding: "4px 12px", fontSize: 11, color: t.color, fontWeight: 700, whiteSpace: "nowrap" }}>{t.badge}</div>
                <div style={{ display: "flex", gap: 2, marginBottom: 14 }}>
                  {[1,2,3,4,5].map(s => <span key={s} style={{ color: B.amber, fontSize: 14 }}>★</span>)}
                </div>
                <p style={{ color: B.text, fontSize: 14, lineHeight: 1.75, marginBottom: 22, fontStyle: "italic" }}>"{t.text}"</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: `linear-gradient(135deg,${t.color},${t.color}80)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 16, flexShrink: 0 }}>{t.letter}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                    <div style={{ color: B.textSub, fontSize: 12 }}>{t.role}</div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, color: B.green }}>✓</span>
                    <span style={{ fontSize: 11, color: B.green }}>Verificado</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" style={{ padding: "90px 32px" }}>
        <div ref={faqRef as any} className={`reveal ${faqVis ? "visible" : ""}`} style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 52 }}>
            <h2 className="section-h" style={{ fontSize: 38, fontWeight: 900, letterSpacing: -1.5 }}>Perguntas <span className="gradient-text">frequentes</span></h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {faqItems.map((item, i) => (
              <div key={i} style={{ background: faqOpen === i ? B.card : B.surface, border: `1px solid ${faqOpen === i ? B.cyan + "45" : B.border}`, borderRadius: 14, overflow: "hidden", transition: "all .2s" }}>
                <button onClick={() => setFaqOpen(faqOpen === i ? null : i)} style={{ width: "100%", padding: "18px 24px", background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: B.text, fontWeight: 600, fontSize: 15, textAlign: "left", gap: 12, fontFamily: "inherit" }}>
                  {item.q}
                  <span style={{ fontSize: 22, color: B.cyan, flexShrink: 0, transform: faqOpen === i ? "rotate(45deg)" : "none", transition: "transform .2s" }}>+</span>
                </button>
                {faqOpen === i && <div style={{ padding: "0 24px 18px", color: B.textSub, fontSize: 14, lineHeight: 1.75 }}>{item.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section style={{ padding: "100px 32px", background: B.bg2, position: "relative", overflow: "hidden", textAlign: "center" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 800, height: 800, borderRadius: "50%", background: `radial-gradient(circle, ${B.cyan}08 0%, transparent 65%)`, pointerEvents: "none" }} />
        <div ref={ctaRef as any} className={`reveal ${ctaVis ? "visible" : ""}`} style={{ position: "relative", maxWidth: 600, margin: "0 auto" }}>
          <img src={finaxLogo} alt="Finax" style={{ width: 72, height: 72, borderRadius: "50%", margin: "0 auto 24px", display: "block", boxShadow: `0 0 40px ${B.cyan}40` }} />
          <h2 style={{ fontSize: 46, fontWeight: 900, letterSpacing: -2, lineHeight: 1.1, marginBottom: 18 }}>
            Pare de terminar o mês<br/><span className="gradient-text">sem entender por quê.</span>
          </h2>
          <p style={{ color: B.textSub, fontSize: 17, lineHeight: 1.75, marginBottom: 40 }}>14 dias grátis. Sem cartão. Sem app.<br/>Só você e o controle real do seu dinheiro.</p>
          <button className="btn-wa" onClick={go} style={{ fontSize: 19, padding: "20px 44px", borderRadius: 16, boxShadow: `0 16px 50px ${B.wa}30` }}>
            <span style={{ fontSize: 24 }}>💬</span> Começar agora no WhatsApp
          </button>
          <div style={{ marginTop: 22, display: "flex", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
            {["✓ Sem cartão","✓ 14 dias grátis","✓ Cancele quando quiser"].map(t => (
              <span key={t} style={{ fontSize: 13, color: B.textSub }}>{t}</span>
            ))}
          </div>
          <div style={{ marginTop: 44, display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
            {["Converse.", "Organize.", "Evolua."].map((word, i) => (
              <span key={word} className={i === 2 ? "gradient-text" : ""} style={{ fontSize: 15, fontWeight: i === 2 ? 800 : 500, color: i < 2 ? B.textDim : undefined }}>{word}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer style={{ borderTop: `1px solid ${B.border}`, padding: "36px 32px" }}>
        <div className="footer-row" style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={finaxLogo} alt="Finax" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} />
            <span style={{ fontWeight: 800, fontSize: 17 }} className="gradient-text">Finax</span>
            <span style={{ color: B.textDim, fontSize: 12, marginLeft: 4 }}>Converse. Organize. Evolua.</span>
          </div>
          <div style={{ color: B.textDim, fontSize: 13 }}>© 2026 Finax. Todos os direitos reservados.</div>
          <div style={{ display: "flex", gap: 22 }}>
            {["Privacidade","Termos","Suporte"].map(l => (
              <span key={l} style={{ color: B.textSub, fontSize: 13, cursor: "pointer" }}>{l}</span>
            ))}
          </div>
        </div>
      </footer>
      <CheckoutModal open={checkoutOpen} onOpenChange={setCheckoutOpen} plan={checkoutPlan} />
    </div>
  );
}
