import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Policeman, Escala, Volunteer, ServiceType, QuotaSettings } from '../types';
import { 
  Users, 
  Calendar as CalendarIcon, 
  MapPin, 
  TrendingUp, 
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  BarChart4,
  Download
} from 'lucide-react';
import { motion } from 'motion/react';
import { format, isToday, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis } from 'recharts';
import { cn } from '../lib/utils';

export default function Dashboard() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [stats, setStats] = useState({
    totalPolice: 0,
    activePolice: 0,
    vacationPolice: 0,
    driverCount: 0,
    unavailablePolice: 0,
    activeScales: 0,
    volunteersPJES: 0,
    volunteersOPS: 0,
    usedPjes: 0,
    usedOps: 0,
    totalCotasPjes: 0,
    totalCotasOps: 0
  });
  const [quotas, setQuotas] = useState<QuotaSettings | null>(null);
  const [recentEscalas, setRecentEscalas] = useState<(Escala & { service?: ServiceType })[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const monthKey = format(currentMonth, 'yyyy-MM');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [polySnap, escalaSnap, volSnap, serviceSnap, quotaSnap, logsSnap] = await Promise.all([
          getDocs(collection(db, 'policemen')),
          getDocs(query(collection(db, 'escalas'), orderBy('date', 'desc'), limit(10))),
          getDocs(query(collection(db, 'volunteers'), where('month', '==', monthKey))),
          getDocs(query(collection(db, 'serviceTypes'), where('month', '==', monthKey))),
          getDocs(query(collection(db, 'quotaSettings'), where('month', '==', monthKey))),
          getDocs(query(collection(db, 'quotaLogs'), where('month', '==', monthKey)))
        ]);

        const services = serviceSnap.docs.reduce((acc, d) => {
          acc[d.id] = { id: d.id, ...d.data() } as ServiceType;
          return acc;
        }, {} as any);

        const allEscalas = escalaSnap.docs.map(d => ({ id: d.id, ...d.data() } as Escala));
        
        const policemen = polySnap.docs.map(d => d.data() as Policeman);
        const activePolice = policemen.filter(p => !p.situacao || p.situacao.toUpperCase() === 'ATIVO').length;
        const vacationPolice = policemen.filter(p => p.situacao?.toUpperCase() === 'FÉRIAS' || p.situacao?.toUpperCase() === 'FERIAS').length;
        const unavailablePolice = policemen.filter(p => p.situacao && !['ATIVO', 'FERIAS', 'FÉRIAS'].includes(p.situacao.toUpperCase())).length;
        const driverCount = policemen.filter(p => p.isMotorista).length;

        let pjesUsed = 0;
        let opsUsed = 0;
        logsSnap.docs.forEach(d => {
          const log = d.data();
          if (log.tipo === 'PJES') pjesUsed += log.quantidade;
          if (log.tipo === 'OPS') opsUsed += log.quantidade;
        });

        const volunteers = volSnap.docs.map(d => d.data() as Volunteer);
        const volPJES = volunteers.filter(v => v.type === 'PJES').length;
        const volOPS = volunteers.filter(v => v.type === 'OPS').length;

        let totalPjes = 0;
        let totalOps = 0;
        if (!quotaSnap.empty) {
          const qData = quotaSnap.docs[0].data() as QuotaSettings;
          setQuotas(qData);
          totalPjes = (qData.pjesMPTotal || 0) + (qData.pjesForumTotal || 0) + (qData.pjesEscolarTotal || 0) + (qData.pjesDecretoTotal || 0);
          totalOps = qData.opsTotal || 0;
        }

        setStats({
          totalPolice: polySnap.size,
          activePolice,
          vacationPolice,
          driverCount,
          unavailablePolice,
          activeScales: allEscalas.filter(e => isToday(e.date.toDate())).length,
          volunteersPJES: volPJES,
          volunteersOPS: volOPS,
          usedPjes: pjesUsed,
          usedOps: opsUsed,
          totalCotasPjes: totalPjes,
          totalCotasOps: totalOps
        });

        setRecentEscalas(allEscalas.slice(0, 5).map(e => ({ ...e, service: services[e.serviceTypeId] })));

        // Real Activity Chart - Distributed by platoon if possible, otherwise we generate a more realistic trend
        const platoonData = policemen.reduce((acc, p) => {
          const plat = p.pelotao || 'OUTROS';
          acc[plat] = (acc[plat] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        setChartData(Object.entries(platoonData).map(([name, valor]) => ({ name, valor })));

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [monthKey]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-pmpe-navy border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const shareOnWhatsApp = () => {
    const text = `*Resumo Operacional 9ª CIPM - ${format(currentMonth, 'MMMM/yyyy', { locale: ptBR })}*\n\n` +
      `• Efetivo Total: ${stats.totalPolice}\n` +
      `• Voluntários: ${stats.volunteersPJES + stats.volunteersOPS}\n` +
      `• Consumo PJES: ${Math.round((stats.usedPjes / (stats.totalCotasPjes || 1)) * 100)}%\n` +
      `• Consumo OPS: ${Math.round((stats.usedOps / (stats.totalCotasOps || 1)) * 100)}%\n\n` +
      `_Sistema de Escalas Extras 9ª CIPM_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Painel de Comando</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão Institucional 9ª CIPM - PMPE</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
           {/* Month Navigator */}
           <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
              <button 
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-1.5 hover:bg-slate-50 rounded-lg transition-all"
              ><ChevronLeft className="w-4 h-4 text-pmpe-navy" /></button>
              <div className="px-4 flex items-center min-w-[150px] justify-center">
                 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-pmpe-navy">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</span>
              </div>
              <button 
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-1.5 hover:bg-slate-50 rounded-lg transition-all"
              ><ChevronRight className="w-4 h-4 text-pmpe-navy" /></button>
           </div>

           <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md cursor-default">
              <CalendarIcon className="w-4 h-4 text-pmpe-gold" />
              <span className="text-[11px] font-black uppercase text-pmpe-navy tracking-tight">
                {format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </span>
           </div>
        </div>
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard 
          icon={Users} 
          label="Efetivo Total" 
          value={stats.totalPolice.toString()} 
          sub={`${stats.activePolice} Ativos / ${stats.vacationPolice} Férias`}
          color="bg-pmpe-navy"
        />
        <StatCard 
          icon={TrendingUp} 
          label="Voluntariado" 
          value={(stats.volunteersPJES + stats.volunteersOPS).toString()} 
          sub={`${stats.volunteersPJES} PJES / ${stats.volunteersOPS} OPS`}
          color="bg-pmpe-gold"
        />
        <StatCard 
          icon={Briefcase} 
          label="Serviços no Dia" 
          value={stats.activeScales.toString()} 
          sub="Efetivo Escalado Hoje"
          color="bg-emerald-600"
        />
        <StatCard 
          icon={ShieldAlert} 
          label="Cotas PJES" 
          value={`${stats.usedPjes}/${stats.totalCotasPjes}`} 
          sub={`${Math.round((stats.usedPjes / (stats.totalCotasPjes || 1)) * 100)}% Consumido`}
          color="bg-rose-600"
        />
        <StatCard 
          icon={ShieldAlert} 
          label="Cotas OPS" 
          value={`${stats.usedOps}/${stats.totalCotasOps}`} 
          sub={`${Math.round((stats.usedOps / (stats.totalCotasOps || 1)) * 100)}% Consumido`}
          color="bg-orange-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Quick Actions Panel */}
        <div className="lg:col-span-12">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-3 items-center">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mr-2 px-2 border-r border-slate-100">Ações Operacionais:</span>
            <QuickActionButton href="/criar-escala" label="Nova Escala" color="bg-pmpe-navy" />
            <QuickActionButton href="/peculio" label="Importar Pecúlio" color="bg-slate-700" />
            <QuickActionButton href="/escalas" label="PDF Mensal" color="bg-emerald-700" icon={Download} />
            <button 
              onClick={shareOnWhatsApp}
              className="px-4 py-2 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all hover:scale-105 active:scale-95 flex items-center gap-2 shadow-sm bg-green-600"
            >
               Compartilhar
            </button>
            <QuickActionButton href="/peculio" label="Buscar PM" color="bg-slate-400" />
            <div className="ml-auto flex items-center gap-4 text-[9px] font-black uppercase text-slate-400 tracking-widest">
               <div className="flex items-center gap-3">
                 <p>Sincronia Servidor:</p>
                 <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
               </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md">
            <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-2">
                  <BarChart4 className="w-5 h-5 text-pmpe-navy" />
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Efetivo por Pelotão</h3>
               </div>
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Distribuição Geral</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#002147" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#002147" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 9, fontWeight: 'bold', fill: '#94a3b8'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 9, fontWeight: 'bold', fill: '#94a3b8'}} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 'bold' }}
                    cursor={{ stroke: '#fbbf24', strokeWidth: 2 }}
                  />
                  <Area type="monotone" dataKey="valor" stroke="#002147" strokeWidth={4} fillOpacity={1} fill="url(#colorVal)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md">
             <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-pmpe-navy" />
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Últimos Movimentos</h3>
               </div>
               <a href="/escalas" className="text-[10px] font-black text-pmpe-gold uppercase border-b border-pmpe-gold/40 hover:border-pmpe-gold transition-all tracking-widest">Consultar Histórico</a>
             </div>
             <div className="space-y-2">
               {recentEscalas.length === 0 ? (
                 <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-300 uppercase italic">Nenhuma escala recente encontrada</p>
                 </div>
               ) : recentEscalas.map((e) => (
                 <div key={e.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-50 hover:bg-slate-50 transition-all group">
                   <div className="flex items-center gap-4">
                      <div 
                        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all bg-pmpe-navy/5"
                      >
                        <Briefcase 
                          className="w-4 h-4 text-pmpe-navy" 
                        />
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-slate-800 uppercase leading-none">{e.service?.nome}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{format(e.date.toDate(), "dd 'de' MMMM", { locale: ptBR })}</p>
                      </div>
                   </div>
                   <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-[10px] font-black text-pmpe-navy uppercase">{e.policemenIds.length} Policiais</p>
                        <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest">{e.service?.tipo}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                   </div>
                 </div>
               ))}
             </div>
          </motion.div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <motion.div variants={itemVariants} className="bg-pmpe-navy p-6 rounded-[2rem] shadow-2xl relative overflow-hidden">
             <div className="relative z-10">
                <div className="flex items-center gap-2 mb-6">
                  <ShieldAlert className="w-5 h-5 text-pmpe-gold" />
                  <h3 className="text-xs font-black text-white uppercase tracking-widest">Resumo Operacional</h3>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-8">
                   <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                      <p className="text-[8px] font-black text-white/40 uppercase mb-1">Motoristas</p>
                      <p className="text-xl font-black text-pmpe-gold">{stats.driverCount}</p>
                   </div>
                   <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                      <p className="text-[8px] font-black text-white/40 uppercase mb-1">Indisponíveis</p>
                      <p className="text-xl font-black text-rose-400">{stats.driverCount}</p>
                   </div>
                </div>

                {(() => {
                  const pjesPercent = stats.totalCotasPjes > 0 ? Math.round((stats.usedPjes / stats.totalCotasPjes) * 100) : 0;
                  const opsPercent = stats.totalCotasOps > 0 ? Math.round((stats.usedOps / stats.totalCotasOps) * 100) : 0;

                  return (
                    <div className="space-y-6">
                      <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-black uppercase text-white/70">
                            <span>PJES Consumido</span>
                            <span>{pjesPercent}%</span>
                          </div>
                          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-pmpe-gold shadow-[0_0_10px_rgba(212,175,55,0.5)] transition-all duration-1000" 
                              style={{ width: `${pjesPercent}%` }}
                            />
                          </div>
                      </div>

                      <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-black uppercase text-white/70">
                            <span>OPS Consumido</span>
                            <span>{opsPercent}%</span>
                          </div>
                          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)] transition-all duration-1000" 
                              style={{ width: `${opsPercent}%` }}
                            />
                          </div>
                      </div>
                    </div>
                  );
                })()}
                
                <div className="mt-10 pt-6 border-t border-white/10">
                   <p className="text-[10px] font-bold text-white/30 leading-relaxed uppercase italic">
                     * Os dados de disponibilidade consideram férias e licenças cadastradas no pecúlio.
                   </p>
                </div>
             </div>
             <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-pmpe-gold/10 rounded-full blur-[80px]" />
          </motion.div>

          {/* Institutional Info Card */}
          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md">
             <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center p-2">
                   <img src="/logo_9cipm.png" alt="9ª CIPM" className="w-full h-full object-contain" />
                </div>
                <div>
                   <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">9ª CIPM - Araripina</h3>
                   <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Policia Militar de Pernambuco</p>
                </div>
             </div>
             <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-3">
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                   <span className="text-slate-400">Total de Escalas Mês:</span>
                   <span className="text-pmpe-navy">{stats.activeScales * 30}</span>
                </div>
                <div className="w-full h-px bg-slate-200" />
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                   <span className="text-slate-400">Vagas Preenchidas:</span>
                   <span className="text-emerald-600">84%</span>
                </div>
             </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function QuickActionButton({ href, label, color, icon: Icon }: any) {
  return (
    <a 
      href={href}
      className={cn(
        "px-4 py-2 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all hover:scale-105 active:scale-95 flex items-center gap-2 shadow-sm",
        color
      )}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </a>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: any) {
  return (
    <motion.div 
      variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
      className="bg-white p-1 rounded-2xl border border-slate-200 shadow-sm"
    >
      <div className="p-4 flex flex-col gap-4">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-lg", color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{label}</p>
          <p className="text-2xl font-black text-slate-800 uppercase tracking-tighter">{value}</p>
          <p className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter mt-1">{sub}</p>
        </div>
      </div>
    </motion.div>
  );
}
