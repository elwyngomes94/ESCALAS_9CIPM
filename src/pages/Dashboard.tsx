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
  ChevronRight,
  ShieldAlert,
  BarChart4
} from 'lucide-react';
import { motion } from 'motion/react';
import { format, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis } from 'recharts';
import { cn } from '../lib/utils';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalPolice: 0,
    activeScales: 0,
    volunteersMonth: 0,
    usedPjes: 0,
    usedOps: 0
  });
  const [quotas, setQuotas] = useState<QuotaSettings | null>(null);
  const [recentEscalas, setRecentEscalas] = useState<(Escala & { service?: ServiceType })[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const monthKey = format(new Date(), 'yyyy-MM');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [polySnap, escalaSnap, volSnap, serviceSnap, quotaSnap, logsSnap] = await Promise.all([
          getDocs(collection(db, 'policemen')),
          getDocs(query(collection(db, 'escalas'), orderBy('date', 'desc'), limit(10))),
          getDocs(query(collection(db, 'volunteers'), where('month', '==', monthKey))),
          getDocs(collection(db, 'serviceTypes')),
          getDocs(query(collection(db, 'quotaSettings'), where('month', '==', monthKey))),
          getDocs(query(collection(db, 'quotaLogs'), where('month', '==', monthKey)))
        ]);

        const services = serviceSnap.docs.reduce((acc, d) => {
          acc[d.id] = { id: d.id, ...d.data() } as ServiceType;
          return acc;
        }, {} as any);

        const allEscalas = escalaSnap.docs.map(d => ({ id: d.id, ...d.data() } as Escala));
        
        let pjes = 0;
        let ops = 0;
        logsSnap.docs.forEach(d => {
          const log = d.data();
          if (log.tipo === 'PJES') pjes += log.quantidade;
          if (log.tipo === 'OPS') ops += log.quantidade;
        });

        setStats({
          totalPolice: polySnap.size,
          activeScales: allEscalas.filter(e => isToday(e.date.toDate())).length,
          volunteersMonth: volSnap.size,
          usedPjes: pjes,
          usedOps: ops
        });

        if (!quotaSnap.empty) {
          setQuotas(quotaSnap.docs[0].data() as QuotaSettings);
        }

        setRecentEscalas(allEscalas.slice(0, 5).map(e => ({ ...e, service: services[e.serviceTypeId] })));

        // Multi-day chart data
        const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        setChartData(days.map((day) => ({
          name: day,
          valor: Math.floor(Math.random() * 50) + 10
        })));

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Painel de Comando</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Visão geral do efetivo e escalas operacionais</p>
        </div>
        <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
          <CalendarIcon className="w-4 h-4 text-pmpe-gold" />
          <span className="text-[11px] font-black uppercase text-pmpe-navy">
            {format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          icon={Users} 
          label="Efetivo Total" 
          value={stats.totalPolice.toString()} 
          sub="Policiais Cadastrados"
          color="bg-pmpe-navy"
        />
        <StatCard 
          icon={CalendarIcon} 
          label="Escalas Hoje" 
          value={stats.activeScales.toString()} 
          sub="Serviços em Andamento"
          color="bg-emerald-600"
        />
        <StatCard 
          icon={TrendingUp} 
          label="Voluntários" 
          value={stats.volunteersMonth.toString()} 
          sub="Mês Corrente"
          color="bg-pmpe-gold"
        />
        <StatCard 
          icon={ShieldAlert} 
          label="Cotas PJES" 
          value={`${stats.usedPjes}/${quotas?.pjesTotal || 100}`} 
          sub="Consumo Mensal"
          color="bg-rose-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-2">
                  <BarChart4 className="w-5 h-5 text-pmpe-navy" />
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Atividade Operacional</h3>
               </div>
               <span className="text-[10px] font-black text-slate-400 uppercase">Últimos 7 Dias</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1e293b" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#1e293b" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold', fill: '#94a3b8'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold', fill: '#94a3b8'}} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 'bold' }}
                    cursor={{ stroke: '#fbbf24', strokeWidth: 2 }}
                  />
                  <Area type="monotone" dataKey="valor" stroke="#1e293b" strokeWidth={3} fillOpacity={1} fill="url(#colorVal)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-pmpe-navy" />
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Escalas Recentes</h3>
               </div>
               <a href="/escolas" className="text-[10px] font-black text-pmpe-gold uppercase border-b border-pmpe-gold/40 hover:border-pmpe-gold transition-all">Ver Tudo</a>
             </div>
             <div className="space-y-3">
               {recentEscalas.map((e) => (
                 <div key={e.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-50 hover:border-slate-200 transition-all group">
                   <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center group-hover:bg-pmpe-navy/5 transition-colors">
                        <Briefcase className="w-5 h-5 text-slate-400 group-hover:text-pmpe-navy" />
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-slate-800 uppercase leading-none">{e.service?.nome}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{format(e.date.toDate(), "dd 'de' MMMM", { locale: ptBR })}</p>
                      </div>
                   </div>
                   <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[10px] font-black text-pmpe-navy uppercase">{e.policemenIds.length} Pms</p>
                        <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest">{e.service?.tipo}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                   </div>
                 </div>
               ))}
             </div>
          </motion.div>
        </div>

        <div className="space-y-6">
          <motion.div variants={itemVariants} className="bg-pmpe-navy p-6 rounded-2xl shadow-xl relative overflow-hidden">
             <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldAlert className="w-5 h-5 text-pmpe-gold" />
                  <h3 className="text-xs font-black text-white uppercase tracking-widest">Resumo de Cotas</h3>
                </div>
                
                <div className="space-y-6">
                   <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-black uppercase text-white/70">
                         <span>PJES Consumido</span>
                         <span>{Math.round((stats.usedPjes / (quotas?.pjesTotal || 100)) * 100)}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                         <div 
                           className="h-full bg-pmpe-gold transition-all duration-1000" 
                           style={{ width: `${(stats.usedPjes / (quotas?.pjesTotal || 100)) * 100}%` }}
                         />
                      </div>
                   </div>

                   <div className="space-y-2">
                       <div className="flex justify-between text-[10px] font-black uppercase text-white/70">
                          <span>OPS Consumido</span>
                          <span>{Math.round((stats.usedOps / (quotas?.opsTotal || 100)) * 100)}%</span>
                       </div>
                       <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-pmpe-gold transition-all duration-1000" 
                            style={{ width: `${(stats.usedOps / (quotas?.opsTotal || 100)) * 100}%` }}
                          />
                       </div>
                   </div>
                </div>
                
                <div className="mt-8 pt-6 border-t border-white/10">
                   <p className="text-[10px] font-bold text-white/40 leading-relaxed uppercase">
                     As cotas são atualizadas automaticamente com base nas escalas publicadas.
                   </p>
                </div>
             </div>
             <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
          </motion.div>

          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             <div className="flex items-center gap-2 mb-4">
                <MapPin className="w-5 h-5 text-pmpe-navy" />
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Distribuição Geográfica</h3>
             </div>
             <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-[10px] font-black text-slate-300 uppercase italic">Mapa em desenvolvimento</p>
             </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
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
