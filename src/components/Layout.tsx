import React from 'react';
import { Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  LayoutDashboard, 
  Users, 
  Shield, 
  UserPlus, 
  ClipboardList, 
  LogOut, 
  Menu, 
  X, 
  Briefcase,
  Calendar,
  FileText
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const SidebarItem = ({ to, icon: Icon, label, active, onClick }: any) => (
  <Link
    to={to}
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 px-6 py-3 transition-all duration-300 text-[11px] font-black uppercase tracking-widest border-l-4",
      active 
        ? "bg-white/5 border-pmpe-gold text-white shadow-[inset_4px_0_10px_-5px_rgba(212,175,55,0.3)]" 
        : "text-white/40 hover:text-white hover:bg-white/5 border-transparent"
    )}
  >
    <Icon className={cn("w-4 h-4 transition-transform duration-300", active ? "text-pmpe-gold scale-110" : "group-hover:scale-110")} />
    <span>{label}</span>
  </Link>
);

const Layout = () => {
  const { user, profile, loading, isAdmin } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pmpe-navy">
        <div className="relative">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/10 border-t-pmpe-gold"></div>
          <div className="absolute inset-0 flex items-center justify-center">
             <span className="text-[10px] font-black text-pmpe-gold">9ª</span>
          </div>
        </div>
      </div>
    );
  }

  // Permite acesso mesmo sem usuário logado
  const displayEmail = profile?.email || 'Visitante';

  const menuGroups = [
    {
      title: "Painel e Visualização",
      items: [
        { to: "/", icon: LayoutDashboard, label: "Painel de Comando" },
        { to: "/escalas", icon: ClipboardList, label: "Visualizar Escalas" }
      ]
    },
    ...(isAdmin ? [
      {
        title: "Efetivo",
        items: [
          { to: "/peculio", icon: Users, label: "Efetivo (Pecúlio)" },
          { to: "/escala-ordinaria", icon: Calendar, label: "Escala Ordinária" }
        ]
      },
      {
        title: "Planejamento e Escalas",
        items: [
          { to: "/criar-escala", icon: Shield, label: "Gestão de Escalas" },
          { to: "/servicos", icon: Briefcase, label: "Tipos de Serviço" },
          { to: "/cotas", icon: Shield, label: "Controle de Cotas" }
        ]
      },
      {
        title: "Voluntariado",
        items: [
          { to: "/voluntarios-pjes", icon: UserPlus, label: "Voluntários PJES" },
          { to: "/voluntarios-ops", icon: UserPlus, label: "Voluntários OPS" }
        ]
      }
    ] : [])
  ];

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50 font-sans">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-pmpe-navy/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-pmpe-navy text-white flex flex-col transform transition-transform duration-500 lg:relative lg:translate-x-0 shrink-0 shadow-2xl border-r border-white/5",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Sidebar Interior Shadow/Gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 pointer-events-none" />

        <div className="p-8 border-b border-white/10 relative z-10 flex flex-col items-center gap-4">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-2xl border-2 border-pmpe-gold/40 p-2 overflow-hidden"
          >
            <img 
              src="/logo_9cipm.png" 
              alt="9ª CIPM Logo"
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent) {
                  parent.innerHTML = '<span class="text-pmpe-navy font-black text-3xl">9</span>';
                }
              }}
            />
          </motion.div>
          <div className="text-center">
            <h1 className="text-sm font-black uppercase tracking-[0.2em] leading-tight text-pmpe-gold">9ª CIPM - PMPE</h1>
            <p className="text-[9px] text-white/40 uppercase font-bold tracking-widest mt-1">Companhia Independente</p>
          </div>
        </div>

        <nav className="flex-1 py-6 overflow-y-auto relative z-10 custom-matrix-scroll space-y-6">
          {menuGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              <span className="block px-8 pt-2 pb-1 text-[8px] font-black uppercase tracking-[0.25em] text-white/30 truncate">
                {group.title}
              </span>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.to}
                    {...item}
                    active={location.pathname === item.to}
                    onClick={() => setIsSidebarOpen(false)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-6 bg-black/30 relative z-10 border-t border-white/5">
          <div className="flex items-center gap-4 px-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pmpe-navy to-slate-900 border border-white/10 flex items-center justify-center text-xs font-black text-pmpe-gold shadow-lg shadow-black/40">
              {displayEmail.substring(0, 2).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-[11px] font-black truncate leading-none mb-1 text-white uppercase tracking-wider">{displayEmail.split('@')[0]}</p>
              <p className="text-[8px] text-pmpe-gold font-bold uppercase tracking-[0.2em]">{isAdmin ? 'Comandante/Adm' : 'Operador'}</p>
            </div>
          </div>
          {user && (
            <button
              onClick={() => auth.signOut()}
              className="group flex items-center justify-center gap-3 w-full px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] text-white/40 hover:text-white hover:bg-red-600/20 hover:border-red-600/40 border border-transparent transition-all"
            >
              <LogOut className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              <span>Sair do Sistema</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-10 shadow-sm z-30">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-3 -ml-2 text-slate-500 lg:hidden hover:bg-slate-100 rounded-2xl transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="hidden lg:flex flex-col">
               <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Localização Atual</h2>
               <h3 className="text-sm font-black text-pmpe-navy uppercase tracking-tighter">
                 {menuGroups.flatMap(g => g.items).find(n => n.to === location.pathname)?.label || 'Gestão Operacional'}
               </h3>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end">
               <span className="text-[9px] text-slate-400 font-black uppercase tracking-[0.2em] mb-1">Status de Conexão</span>
               <span className="px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-full uppercase tracking-widest border border-emerald-100 flex items-center gap-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                 Servidor Online
               </span>
            </div>
            <div className="h-10 w-px bg-slate-200"></div>
            <div className="flex items-center gap-4 group cursor-pointer">
              <div className="text-right hidden sm:block">
                <span className="text-[9px] text-slate-400 font-black uppercase tracking-[0.1em] block leading-none mb-1">Identificação</span>
                <span className="text-xs font-black text-pmpe-navy tracking-tight group-hover:text-pmpe-gold transition-colors">{displayEmail}</span>
              </div>
              <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center p-2 group-hover:border-pmpe-gold transition-colors shadow-sm overflow-hidden">
                 <img src="/logo_9cipm.png" alt="PMPE" className="w-full h-full object-contain grayscale group-hover:grayscale-0 transition-all opacity-40 group-hover:opacity-100" />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50 scroll-smooth custom-matrix-scroll">
          <div className="p-8 md:p-10 max-w-full">
             <Outlet />
          </div>
        </div>

        <footer className="h-12 bg-white border-t border-slate-200 flex items-center justify-between px-10 text-[9px] text-slate-400 font-black uppercase tracking-[0.3em] shrink-0">
          <span className="hidden sm:inline">Unidade Operacional: 9ª CIPM - ARARIPINA-PE</span>
          <span className="sm:hidden">9ª CIPM - PMPE</span>
          <span className="text-right opacity-50 flex items-center gap-2">
             DESENVOLVIDO POR SEÇÃO DE INFORMÁTICA 
             <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
             2026
          </span>
        </footer>
      </main>
    </div>
  );
};

export default Layout;
