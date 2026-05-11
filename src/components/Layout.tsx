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
  Briefcase
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const SidebarItem = ({ to, icon: Icon, label, active, onClick }: any) => (
  <Link
    to={to}
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 px-6 py-2.5 transition-all duration-200 text-sm font-medium border-l-4",
      active 
        ? "bg-white/10 border-pmpe-red text-white" 
        : "text-white/60 hover:text-white hover:bg-white/5 border-transparent"
    )}
  >
    <Icon className={cn("w-4 h-4", active ? "text-pmpe-red" : "")} />
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
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-pmpe-gold border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const navigation = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/escalas", icon: ClipboardList, label: "Visualizar Escalas" },
  ];

  if (isAdmin) {
    navigation.push(
      { to: "/peculio", icon: Users, label: "Pecúlio (Efetivo)" },
      { to: "/servicos", icon: Briefcase, label: "Tipos de Serviço" },
      { to: "/voluntarios-pjes", icon: UserPlus, label: "Voluntários PJES" },
      { to: "/voluntarios-ops", icon: UserPlus, label: "Voluntários OPS" },
      { to: "/criar-escala", icon: Shield, label: "Criar Escalas" }
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 sidebar-gradient text-white flex flex-col transform transition-transform duration-300 lg:relative lg:translate-x-0 shrink-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-pmpe-navy font-bold text-xl shadow-inner italic border-2 border-pmpe-gold/20">
              9
            </div>
            <div>
              <h1 className="text-xs font-bold uppercase tracking-wider leading-tight">9ª CIPM - PMPE</h1>
              <p className="text-[10px] text-white/60">Escalas Extras</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          {navigation.map((item) => (
            <SidebarItem
              key={item.to}
              {...item}
              active={location.pathname === item.to}
              onClick={() => setIsSidebarOpen(false)}
            />
          ))}
        </nav>

        <div className="p-4 bg-black/20">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="w-8 h-8 rounded bg-pmpe-red flex items-center justify-center text-[10px] font-bold">
              {profile?.email?.substring(0, 2).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-[11px] font-bold truncate leading-none mb-1">{profile?.email?.split('@')[0]}</p>
              <p className="text-[9px] text-white/50 uppercase tracking-tighter">{isAdmin ? 'Administrador' : 'Usuário'}</p>
            </div>
          </div>
          <button
            onClick={() => auth.signOut()}
            className="flex items-center gap-3 w-full px-4 py-2 rounded text-[11px] font-bold uppercase tracking-widest text-white/50 hover:text-white hover:bg-white/5 transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 text-slate-500 lg:hidden hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-tighter hidden sm:block">
              {navigation.find(n => n.to === location.pathname)?.label || 'Painel de Controle'}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <span className="px-3 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-full uppercase tracking-widest border border-green-100">
              Sistema Ativo
            </span>
            <div className="h-6 w-px bg-slate-200"></div>
            <div className="text-right hidden sm:block">
              <span className="text-[10px] text-slate-500 font-bold uppercase block leading-none">Usuário</span>
              <span className="text-xs font-bold text-pmpe-navy">{profile?.email}</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50 scroll-smooth">
          <div className="p-6 md:p-8 max-w-full">
             <Outlet />
          </div>
        </div>

        <footer className="h-10 bg-white border-t border-slate-200 flex items-center justify-between px-8 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
          <span className="hidden sm:inline">9ª CIPM - COMPANHIA INDEPENDENTE DE POLÍCIA MILITAR</span>
          <span className="sm:hidden">9ª CIPM - PMPE</span>
          <span className="text-right italic">POLÍCIA MILITAR DE PERNAMBUCO © 2024</span>
        </footer>
      </main>
    </div>
  );
};

export default Layout;
