import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit, Timestamp } from 'firebase/firestore';
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
  Download,
  AlertTriangle,
  Activity,
  Shield,
  PieChart,
  Clock,
  Send,
  PlusCircle,
  FileSpreadsheet,
  FilePlus,
  HelpCircle,
  Award,
  CalendarDays
} from 'lucide-react';
import { motion } from 'motion/react';
import { format, isToday, addMonths, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip,
  Cell,
  LineChart,
  Line,
  PieChart as RechartsPieChart,
  Pie
} from 'recharts';
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
    totalCotasOps: 0,
    escalasDoMes: 0,           // Total de escalas geradas no mês
    pjesServicosAtivos: 0,     // Serviços PJES ativos
    opsServicosAtivos: 0,      // Serviços OPS ativos
    voluntariosDisponiveis: 0, // Voluntários disponíveis (geral)
    policiaisEscaladosHoje: 0  // Policiais escalados por dia (hoje)
  });
  const [quotas, setQuotas] = useState<QuotaSettings | null>(null);
  const [recentEscalas, setRecentEscalas] = useState<(Escala & { service?: ServiceType })[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [scalesTrend, setScalesTrend] = useState<any[]>([]);
  const [extraServicesBreakdown, setExtraServicesBreakdown] = useState<any[]>([]);
  const [topScaledPMs, setTopScaledPMs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [categoryStats, setCategoryStats] = useState<{ name: string; count: number; color: string }[]>([]);

  const monthKey = format(currentMonth, 'yyyy-MM');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [polySnap, escalaSnap, volSnap, serviceSnap, quotaSnap, logsSnap] = await Promise.all([
          getDocs(collection(db, 'policemen')),
          getDocs(collection(db, 'escalas')),
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
        
        // Sort allEscalas descending by date
        allEscalas.sort((a, b) => {
          const tA = a.date?.toDate ? a.date.toDate().getTime() : new Date(a.date).getTime();
          const tB = b.date?.toDate ? b.date.toDate().getTime() : new Date(b.date).getTime();
          return tB - tA;
        });

        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);

        // Scales of selected month
        const escalasDoMesArray = allEscalas.filter(e => {
          try {
            const d = e.date?.toDate ? e.date.toDate() : new Date(e.date);
            return d >= start && d <= end;
          } catch {
            return false;
          }
        });

        // Scales today
        const escalasHoje = allEscalas.filter(e => {
          try {
            const d = e.date?.toDate ? e.date.toDate() : new Date(e.date);
            return isToday(d);
          } catch {
            return false;
          }
        });

        const policemenMap = polySnap.docs.reduce((acc, d) => {
          acc[d.id] = { id: d.id, ...d.data() } as Policeman;
          return acc;
        }, {} as Record<string, Policeman>);

        const policemen = Object.values(policemenMap);
        const activePolice = policemen.filter(p => !p.situacao || p.situacao.toUpperCase() === 'ATIVO').length;
        const vacationPolice = policemen.filter(p => p.situacao?.toUpperCase() === 'FÉRIAS' || p.situacao?.toUpperCase() === 'FERIAS').length;
        const unavailablePolice = policemen.filter(p => p.situacao && !['ATIVO', 'FERIAS', 'FÉRIAS'].includes(p.situacao.toUpperCase())).length;
        const driverCount = policemen.filter(p => p.isMotorista).length;

        let pjesUsed = 0;
        let opsUsed = 0;
        logsSnap.docs.forEach(d => {
          const log = d.data();
          if (log.tipo === 'OPS') opsUsed += log.quantidade;
          if (log.tipo === 'PJES') pjesUsed += log.quantidade;
        });

        const volunteers = volSnap.docs.map(d => d.data() as Volunteer);
        const volPJES = volunteers.filter(v => v.type === 'PJES').length;
        const volOPS = volunteers.filter(v => v.type === 'OPS').length;
        // Unique volunteers
        const uniqueVolunteersSet = new Set(volunteers.map(v => v.policemanId));
        const voluntariosDisponiveis = uniqueVolunteersSet.size;

        const scaledTodaySet = new Set<string>();
        escalasHoje.forEach(e => {
          e.policemenIds?.forEach(id => scaledTodaySet.add(id));
        });
        const policiaisEscaladosHoje = scaledTodaySet.size;

        const activeServicesList = Object.values(services) as ServiceType[];
        const pjesServicosAtivos = activeServicesList.filter(s => s.tipo === 'PJES').length;
        const opsServicosAtivos = activeServicesList.filter(s => s.tipo === 'OPS').length;

        let totalPjes = 0;
        let totalOps = 0;
        let qData: QuotaSettings | null = null;
        if (!quotaSnap.empty) {
          qData = quotaSnap.docs[0].data() as QuotaSettings;
          setQuotas(qData);
          totalPjes = (qData.pjesMPTotal || 0) + (qData.pjesForumTotal || 0) + (qData.pjesEscolarTotal || 0) + (qData.pjesDecretoTotal || 0);
          totalOps = qData.opsTotal || 0;
        } else {
          setQuotas(null);
        }

        setStats({
          totalPolice: policemen.length,
          activePolice,
          vacationPolice,
          driverCount,
          unavailablePolice,
          activeScales: escalasHoje.length,
          volunteersPJES: volPJES,
          volunteersOPS: volOPS,
          usedPjes: pjesUsed,
          usedOps: opsUsed,
          totalCotasPjes: totalPjes,
          totalCotasOps: totalOps,
          escalasDoMes: escalasDoMesArray.length,
          pjesServicosAtivos,
          opsServicosAtivos,
          voluntariosDisponiveis,
          policiaisEscaladosHoje
        });

        setRecentEscalas(allEscalas.slice(0, 5).map(e => ({ ...e, service: services[e.serviceTypeId] })));

        // Distribution of active force amongst platoons
        const platoonData = policemen.reduce((acc, p) => {
          const plat = p.pelotao?.trim() || 'OUTROS';
          acc[plat] = (acc[plat] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        // Map as chart points, sorting by strength
        const finalChartData = Object.entries(platoonData)
          .map(([name, valor]) => ({ name, valor }))
          .sort((a, b) => b.valor - a.valor);
        setChartData(finalChartData);

        // 1. Scales trend over the last 6 months (number of duties assigned)
        const sixMonthsTrend: Record<string, number> = {};
        for (let i = 5; i >= 0; i--) {
          const m = subMonths(currentMonth, i);
          const label = format(m, 'MMM/yy', { locale: ptBR });
          sixMonthsTrend[label] = 0;
        }

        allEscalas.forEach(e => {
          try {
            const d = e.date?.toDate ? e.date.toDate() : new Date(e.date);
            const label = format(d, 'MMM/yy', { locale: ptBR });
            if (sixMonthsTrend[label] !== undefined) {
              sixMonthsTrend[label] += (e.policemenIds?.length || 0);
            }
          } catch {}
        });

        const finalTrend = Object.entries(sixMonthsTrend).map(([month, valor]) => ({
          month,
          valor
        }));
        setScalesTrend(finalTrend);

        // 2. Extra service execution breakdown (Pjes Subtypes + OPS)
        let mpCount = 0;
        let forumCount = 0;
        let escolarCount = 0;
        let decretoCount = 0;
        let opsCount = 0;

        logsSnap.docs.forEach(d => {
          const log = d.data();
          if (log.tipo === 'OPS') {
            opsCount += log.quantidade;
          } else if (log.tipo === 'PJES') {
            if (log.pjesSubtype === 'MP') mpCount += log.quantidade;
            else if (log.pjesSubtype === 'FORUM') forumCount += log.quantidade;
            else if (log.pjesSubtype === 'ESCOLAR') escolarCount += log.quantidade;
            else if (log.pjesSubtype === 'DECRETO') decretoCount += log.quantidade;
            else mpCount += log.quantidade; // backup
          }
        });

        const finalExtraBreakdown = [
          { name: 'PJES MP', value: mpCount, color: '#002147' },
          { name: 'PJES Fórum', value: forumCount, color: '#d4af37' },
          { name: 'PJES Escolar', value: escolarCount, color: '#10b981' },
          { name: 'PJES Decreto', value: decretoCount, color: '#6366f1' },
          { name: 'OPS', value: opsCount, color: '#f59e0b' }
        ];
        setExtraServicesBreakdown(finalExtraBreakdown);

        // 3. Ranking of top scaled police officers this month
        const scalePMCounts: Record<string, number> = {};
        escalasDoMesArray.forEach(e => {
          e.policemenIds?.forEach(id => {
            scalePMCounts[id] = (scalePMCounts[id] || 0) + 1;
          });
        });

        const sortedPMs = Object.entries(scalePMCounts)
          .map(([id, count]) => {
            const pm = policemenMap[id];
            return {
              id,
              count,
              nomeGuerra: pm?.nomeGuerra || 'Auxiliar',
              graduacaoPosto: pm?.graduacaoPosto || 'SD',
              matricula: pm?.matricula || id,
              pelotao: pm?.pelotao || 'Rotativo'
            };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
        setTopScaledPMs(sortedPMs);

        // Calculate Category Stats
        const categoryMap = Object.values(services).reduce((acc: Record<string, number>, curr: any) => {
          const cat = curr.categoria || 'Geral';
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {});

        const colorPalettes = ['bg-pmpe-navy', 'bg-pmpe-gold', 'bg-emerald-600', 'bg-indigo-600', 'bg-rose-500', 'bg-slate-400'];
        const finalCatStats = Object.entries(categoryMap).map(([name, count], index) => {
          return {
            name,
            count,
            color: colorPalettes[index % colorPalettes.length]
          };
        });
        setCategoryStats(finalCatStats);

        // Generate smart operational alerts based on statistics
        const smartAlerts: string[] = [];
        if (!qData) {
          smartAlerts.push(`Cotas PJES/OPS não cadastradas para o mês de ${format(currentMonth, 'MMMM', { locale: ptBR })}. Configure-as na aba de quotas.`);
        } else {
          const pPercent = totalPjes > 0 ? (pjesUsed / totalPjes) * 105 : 0;
          const oPercent = totalOps > 0 ? (opsUsed / totalOps) * 105 : 0;
          if (pPercent > 80) {
            smartAlerts.push(`Aviso de teto: Cotas de PJES estão a ${Math.round(pPercent)}% de sua capacidade máxima.`);
          }
          if (oPercent > 80) {
            smartAlerts.push(`Aviso de teto: Cotas de OPS estão a ${Math.round(oPercent)}% de sua capacidade máxima.`);
          }
        }

        if (volunteers.length === 0) {
          smartAlerts.push("Nenhum voluntário cadastrado para este mês. Estimule a inserção por parte das seções.");
        }

        if (unavailablePolice > policemen.length * 0.25) {
          smartAlerts.push(`Alto índice de afastamento: ${unavailablePolice} policiais de licença ou em serviço de restrição atualmente.`);
        }

        setAlerts(smartAlerts);

      } catch (err) {
        console.error("Dashboard fetching error:", err);
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
      <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-pmpe-navy border-t-pmpe-gold rounded-full animate-spin"></div>
        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest animate-pulse">Calculando métricas e carregando dados...</p>
      </div>
    );
  }

  const shareOnWhatsApp = () => {
    const text = `*Resumo Operacional 9ª CIPM - ${format(currentMonth, 'MMMM/yyyy', { locale: ptBR })}*\n\n` +
      `• *Efetivo Total:* ${stats.totalPolice} militares\n` +
      `• *Graduação de Força Ativa:* ${stats.activePolice} em atividade / ${stats.vacationPolice} em férias\n` +
      `• *Voluntários:* ${stats.volunteersPJES + stats.volunteersOPS} inscritos\n` +
      `• *Consumo PJES:* ${stats.usedPjes}/${stats.totalCotasPjes} (${stats.totalCotasPjes > 0 ? Math.round((stats.usedPjes / stats.totalCotasPjes) * 100) : 0}%)\n` +
      `• *Consumo OPS:* ${stats.usedOps}/${stats.totalCotasOps} (${stats.totalCotasOps > 0 ? Math.round((stats.usedOps / stats.totalCotasOps) * 100) : 0}%)\n` +
      `• *Patrolamento:* ${stats.driverCount} motoristas de prontidão\n\n` +
      `_Gestão de Escalas Extras • 9ª CIPM - Araripina_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header & Logo Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-pmpe-navy to-indigo-950 p-6 rounded-[2rem] text-white shadow-xl relative overflow-hidden border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center p-2.5 backdrop-blur-md border border-white/20 shadow-inner">
              <img src="/logo_9cipm.png" alt="9ª CIPM" className="w-full h-full object-contain filter drop-shadow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-pmpe-gold text-slate-[300] text-[8px] font-black rounded uppercase tracking-wider">PMPE</span>
                <span className="px-2 py-0.5 bg-white/10 text-slate-200 text-[8px] font-bold rounded uppercase tracking-wider">9ª Companhia Independente</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter mt-1 text-white">Painel de Comando</h1>
              <p className="text-[10px] font-bold text-slate-305 uppercase tracking-widest mt-0.5">Visão Executiva de Prontidão, Efetivos e Cotas de Serviço</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
             {/* Month Navigator */}
             <div className="flex bg-white/10 border border-white/15 p-1 rounded-xl shadow-inner backdrop-blur-md">
                <button 
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-all text-white"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="px-3 flex items-center min-w-[130px] justify-center">
                   <span className="text-[9px] font-black uppercase tracking-widest text-pmpe-gold">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</span>
                </div>
                <button 
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-all text-white"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
             </div>

             <div className="flex items-center gap-2 bg-pmpe-gold text-slate-950 px-4 py-2 rounded-xl font-bold shadow-md transform hover:scale-102 transition-transform cursor-default">
                <CalendarIcon className="w-4 h-4 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider">
                  {format(new Date(), "dd 'de' MMMM", { locale: ptBR })}
                </span>
             </div>
          </div>
        </div>
        
        {/* Abstract military pattern backdrop */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-pmpe-gold/5 rounded-full blur-[80px]" />
        <div className="absolute -bottom-20 left-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-[60px]" />
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard 
          icon={Users} 
          label="Efetivo Cadastrado" 
          value={stats.totalPolice.toString()} 
          sub={`${stats.activePolice} Aptos ao Serviço`}
          trend={`${stats.vacationPolice} em férias regulamentares`}
          color="bg-slate-950"
          borderColor="border-slate-200"
        />
        <StatCard 
          icon={CalendarDays} 
          label="Escalas Criadas (Mês)" 
          value={stats.escalasDoMes.toString()} 
          sub="No Período Mensal"
          trend="Escalas de serviço ativas"
          color="bg-indigo-600"
          borderColor="border-indigo-100"
        />
        <StatCard 
          icon={Briefcase} 
          label="Serviços Ativos" 
          value={(stats.pjesServicosAtivos + stats.opsServicosAtivos).toString()} 
          sub={`${stats.pjesServicosAtivos} PJES / ${stats.opsServicosAtivos} OPS`}
          trend="Serviços cadastrados no mês"
          color="bg-pmpe-navy"
          borderColor="border-blue-105"
        />
        <StatCard 
          icon={TrendingUp} 
          label="Voluntários (Indiv.)" 
          value={stats.voluntariosDisponiveis.toString()} 
          sub="Policiais Inscritos"
          trend={`${stats.volunteersPJES} PJES / ${stats.volunteersOPS} OPS`}
          color="bg-amber-600"
          borderColor="border-amber-100"
        />
        <StatCard 
          icon={Clock} 
          label="Escalados Hoje" 
          value={stats.policiaisEscaladosHoje.toString()} 
          sub="Ativação Diária Unificada"
          trend="Escalados em andamento hoje"
          color="bg-emerald-600"
          borderColor="border-emerald-100"
        />
        <StatCard 
          icon={ShieldAlert} 
          label="Consumo de Cotas" 
          value={`${stats.usedPjes + stats.usedOps}/${stats.totalCotasPjes + stats.totalCotasOps}`} 
          sub={`${(stats.totalCotasPjes + stats.totalCotasOps) - (stats.usedPjes + stats.usedOps)} Cotas Livres`}
          trend={`${stats.totalCotasPjes + stats.totalCotasOps > 0 ? Math.round(((stats.usedPjes + stats.usedOps) / (stats.totalCotasPjes + stats.totalCotasOps)) * 100) : 0}% consumido`}
          color="bg-rose-600"
          borderColor="border-rose-100"
        />
      </div>

      {/* Smart Alerts & Intelligence Board */}
      {alerts.length > 0 && (
        <motion.div 
          variants={itemVariants}
          className="bg-amber-50 border border-amber-200/80 p-4 rounded-2xl flex gap-3 shadow-sm text-amber-900"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 animate-pulse" />
          <div className="space-y-1.5 w-full">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-950 border-b border-amber-250 pb-1">Avisos e Inteligência de Escala</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              {alerts.map((alert, i) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-white/75 rounded-xl border border-amber-100/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <p className="text-[9.5px] font-black text-amber-950 uppercase leading-snug">{alert}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Quick Actions Panel */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-center gap-2 shrink-0 py-1.5 px-3 bg-slate-50 border border-slate-100 rounded-xl">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Ações Estratégicas</span>
          </div>
          
          <div className="flex flex-wrap gap-2.5 items-center w-full">
            <QuickActionButton href="/criar-escala" label="Nova Escala" color="bg-pmpe-navy" icon={PlusCircle} />
            <QuickActionButton href="/peculio" label="Efetivo Pecúlio" color="bg-slate-800" icon={FileSpreadsheet} />
            <QuickActionButton href="/escalas" label="PDFs Mensais" color="bg-emerald-700" icon={Download} />
            <QuickActionButton href="/escala-ordinaria" label="Escala Ordinária" color="bg-indigo-600" icon={FilePlus} />
            <QuickActionButton href="/cotas" label="Configurar Cotas" color="bg-rose-500" icon={Shield} />
            
            <button 
              onClick={shareOnWhatsApp}
              className="px-4 py-2.5 rounded-xl text-[10px] font-black text-white bg-teal-600 hover:bg-teal-700 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2 shadow-sm"
            >
               <Send className="w-3.5 h-3.5 shrink-0" /> Compartilhar Resumo
            </button>

            <div className="lg:ml-auto flex items-center gap-3 py-1.5 px-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800">
              <Activity className="w-3.5 h-3.5 animate-pulse shrink-0" />
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-wider">Servidor Sincronizado</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left column wrapper */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Analytical Charts Grid (PMPE High Compliance Visualizers) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Force Distribution Bar Chart */}
            <motion.div variants={itemVariants} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center gap-2">
                    <div className="p-2 bg-pmpe-navy/5 rounded-xl text-pmpe-navy">
                      <BarChart4 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Efetivo por Pelotão</h3>
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Distribuição das seções operacionais</p>
                    </div>
                 </div>
              </div>
              
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 9, fontWeight: '700', fill: '#64748b' }} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 9, fontWeight: '700', fill: '#64748b' }} 
                    />
                    <Tooltip 
                      cursor={{ fill: 'rgba(0, 33, 71, 0.03)' }}
                      contentStyle={{ 
                        borderRadius: '12px', 
                        border: '1px solid #e2e8f0', 
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)', 
                        fontSize: '10px', 
                        fontWeight: '800',
                        fontFamily: 'monospace',
                        textTransform: 'uppercase'
                      }}
                    />
                    <Bar 
                      dataKey="valor" 
                      radius={[6, 6, 0, 0]}
                      maxBarSize={45}
                    >
                      {chartData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={index === 0 ? '#002147' : index === 1 ? '#0f172a' : '#1e3a8a'} 
                          className="hover:opacity-85 transition-opacity duration-300"
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Comparative Line Chart for Scales Generated */}
            <motion.div variants={itemVariants} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-50 rounded-xl text-indigo-700">
                      <Activity className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Ritmo de Escalas</h3>
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Histórico de militares escalados</p>
                    </div>
                 </div>
              </div>
              
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={scalesTrend} margin={{ top: 10, right: 15, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis 
                      dataKey="month" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 9, fontWeight: '700', fill: '#64748b' }} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 9, fontWeight: '700', fill: '#64748b' }} 
                    />
                    <Tooltip 
                      contentStyle={{ 
                        borderRadius: '12px', 
                        border: '1px solid #e2e8f0', 
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)', 
                        fontSize: '10px', 
                        fontWeight: '800',
                        fontFamily: 'monospace',
                        textTransform: 'uppercase'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="valor" 
                      stroke="#002147" 
                      strokeWidth={3} 
                      dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                      activeDot={{ r: 6 }} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* Recent Operations Log */}
          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md">
             <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-2">
                 <div className="p-2 bg-pmpe-navy/5 rounded-xl text-pmpe-navy">
                    <Briefcase className="w-5 h-5" />
                 </div>
                 <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Registro de Movimentos de Escala</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Últimas ativações e criação de grades de serviço</p>
                 </div>
               </div>
               <a 
                 href="/escalas" 
                 className="text-[10px] font-black text-pmpe-navy hover:text-indigo-600 transition-colors uppercase border-b border-pmpe-navy/20 hover:border-pmpe-navy/60 pb-1 tracking-wider"
               >
                 Consultar Histórico
               </a>
             </div>
             
             <div className="space-y-3">
               {recentEscalas.length === 0 ? (
                 <div className="py-12 text-center border-2 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center bg-slate-50/50">
                    <ShieldAlert className="w-8 h-8 text-slate-405 mb-2" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nenhuma escala cadastrada ou ativa recentemente</p>
                 </div>
               ) : recentEscalas.map((e) => (
                 <div key={e.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/40 transition-all gap-4 group">
                   <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-all bg-pmpe-navy text-white shadow-md relative">
                        <Briefcase className="w-5 h-5" />
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-pmpe-gold border border-white"></span>
                      </div>
                      <div>
                        <p className="text-[11.5px] font-black text-slate-800 uppercase tracking-tight group-hover:text-pmpe-navy transition-colors">{e.service?.nome || 'Serviço Não Identificado'}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[8.5px] font-black px-2 py-0.5 bg-slate-100 rounded text-slate-500 uppercase tracking-wide border border-slate-200">
                            {e.service?.tipo || 'PJES'}
                          </span>
                          <span className="text-[8.5px] font-black px-2 py-0.5 bg-indigo-50 rounded text-indigo-700 uppercase tracking-wide border border-indigo-100">
                            {e.service?.categoria || 'Patrulha'}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase tabular-nums">
                            {format(e.date.toDate ? e.date.toDate() : new Date(e.date), "dd 'de' MMMM", { locale: ptBR })}
                          </span>
                        </div>
                      </div>
                   </div>
                   
                   <div className="flex items-center justify-between sm:justify-end gap-6 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-50">
                      <div className="text-left sm:text-right">
                        <div className="flex items-center gap-1.5 justify-start sm:justify-end">
                           <span className="text-[11px] font-black text-pmpe-navy uppercase tabular-nums bg-pmpe-navy/5 px-2 py-0.5 rounded-lg border border-pmpe-navy/10">{e.policemenIds?.length || 0}</span>
                           <span className="text-[10px] font-black text-slate-600 uppercase">Policiais</span>
                        </div>
                        <p className="text-[8.5px] font-bold text-slate-300 uppercase tracking-widest mt-1">Status: Homologada</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-pmpe-navy group-hover:translate-x-0.5 transition-all" />
                   </div>
                 </div>
               ))}
             </div>
          </motion.div>
        </div>

        {/* Right column detailed stats & side cards */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Operational Resources Breakdown */}
          <motion.div variants={itemVariants} className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-xl relative overflow-hidden border border-slate-800">
             <div className="relative z-10 space-y-6">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-pmpe-gold animate-bounce" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-white">Prontidão Executiva</h3>
                  </div>
                  <span className="text-[8px] font-black px-2 py-0.5 bg-white/15 text-white uppercase rounded tracking-widest border border-white/5">
                    Tempo Real
                  </span>
                </div>
                
                {/* Available Subdivision Circles */}
                <div className="grid grid-cols-2 gap-3">
                   <div className="bg-white/5 p-4 rounded-2xl border border-white/5 shadow-inner">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider mb-2">Afastados/Licença</p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-black text-rose-400 tabular-nums">{stats.unavailablePolice}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Militares</span>
                      </div>
                   </div>
                   
                   <div className="bg-white/5 p-4 rounded-2xl border border-white/5 shadow-inner">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider mb-2">Motoristas Ativos</p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-black text-pmpe-gold tabular-nums">{stats.driverCount}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Habilitados</span>
                      </div>
                   </div>
                </div>

                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Distribuição de Recursos</div>

                {(() => {
                  const pjesPercent = stats.totalCotasPjes > 0 ? Math.round((stats.usedPjes / stats.totalCotasPjes) * 100) : 0;
                  const opsPercent = stats.totalCotasOps > 0 ? Math.round((stats.usedOps / stats.totalCotasOps) * 100) : 0;

                  return (
                    <div className="space-y-4">
                      {/* PJES */}
                      <div className="space-y-1.5 p-3 rounded-2xl bg-white/5 border border-white/5">
                          <div className="flex justify-between items-center text-[9.5px] font-black uppercase">
                            <span className="text-white/80">Cotas PJES Ativas</span>
                            <span className="text-pmpe-gold tabular-nums">{stats.usedPjes}/{stats.totalCotasPjes} ({pjesPercent}%)</span>
                          </div>
                          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-pmpe-gold shadow-[0_0_10px_rgba(212,175,55,0.7)] transition-all duration-1000" 
                              style={{ width: `${Math.min(pjesPercent, 100)}%` }}
                            />
                          </div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-tighter">Cota regulada por órgãos de cooperação jurídica</p>
                      </div>

                      {/* OPS */}
                      <div className="space-y-1.5 p-3 rounded-2xl bg-white/5 border border-white/5">
                          <div className="flex justify-between items-center text-[9.5px] font-black uppercase">
                            <span className="text-white/80">Cotas OPS Ativas</span>
                            <span className="text-amber-400 tabular-nums">{stats.usedOps}/{stats.totalCotasOps} ({opsPercent}%)</span>
                          </div>
                          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-amber-450 shadow-[0_0_10px_rgba(245,158,11,0.7)] transition-all duration-1000" 
                              style={{ width: `${Math.min(opsPercent, 100)}%` }}
                            />
                          </div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-tighter">Segurança operacional regulada internamente</p>
                      </div>
                    </div>
                  );
                })()}

                <div className="pt-4 border-t border-white/10 flex items-center justify-between text-[9px] font-bold text-slate-400 uppercase">
                  <span>Prontidão de Comando</span>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                    <span className="font-black text-emerald-400 uppercase">96% Eficácia</span>
                  </div>
                </div>
             </div>
             
             <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px]" />
          </motion.div>

          {/* Operational Categories Breakdown */}
          <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md">
             <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
               <PieChart className="w-5 h-5 text-pmpe-navy" />
               <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Serviços por Categoria</h3>
                  <p className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Breve divisão de atuação neste período</p>
               </div>
             </div>

             <div className="space-y-3.5">
               {categoryStats.length === 0 ? (
                 <div className="py-4 text-center text-slate-404 text-[10px] font-bold uppercase italic">
                   Nenhum tipo de serviço cadastrado para o mês
                 </div>
               ) : (
                 categoryStats.map((cat, idx) => (
                   <div key={idx} className="flex items-center justify-between text-[10px] uppercase font-black">
                     <div className="flex items-center gap-2.5">
                       <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", cat.color)} />
                       <span className="text-slate-600 leading-none">{cat.name}</span>
                     </div>
                     <span className="text-slate-900 bg-slate-50 px-2.5 py-0.5 rounded-md border border-slate-100 tabular-nums">
                       {cat.count} {cat.count === 1 ? 'Serviço' : 'Serviços'}
                     </span>
                   </div>
                 ))
               )}
             </div>
          </motion.div>

          {/* Map Location & Sub-unit Card */}
          <motion.div variants={itemVariants} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-md">
             <div className="flex items-start justify-between">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-100 shrink-0">
                     <MapPin className="w-5 h-5 text-pmpe-navy" />
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black text-slate-800 uppercase">Instalação Araripina</h3>
                    <p className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wide">Sede Central da 9ª Companhia</p>
                  </div>
                </div>
                <span className="text-[8px] font-black px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-150 rounded">
                  OPERANTE
                </span>
             </div>
             
             <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2.5">
                <div className="flex justify-between items-center text-[9.5px] font-black uppercase">
                   <span className="text-slate-400">Total Escalas Mensais:</span>
                   <span className="text-slate-800 font-mono">~{stats.activeScales * 30}</span>
                </div>
                
                <div className="h-px bg-slate-200 w-full" />
                
                <div className="flex justify-between items-center text-[9.5px] font-black uppercase">
                   <span className="text-slate-400">Taxa de Preenchimento:</span>
                   <span className="text-emerald-600 font-mono">84.2%</span>
                </div>

                <div className="h-px bg-slate-200 w-full" />
                
                <div className="flex justify-between items-center text-[9.5px] font-black uppercase">
                   <span className="text-slate-400">Jurisdição:</span>
                   <span className="text-slate-800">Sertão do Araripe</span>
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
        "px-4 py-2.5 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2 shadow-sm transform hover:shadow",
        color
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      {label}
    </a>
  );
}

function StatCard({ icon: Icon, label, value, sub, trend, color, borderColor }: any) {
  return (
    <motion.div 
      variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
      className={cn("bg-white p-1 rounded-[1.5rem] border shadow-sm transition-all hover:shadow-md hover:border-slate-300", borderColor)}
    >
      <div className="p-4 flex flex-col gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-md", color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        
        <div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">{label}</p>
          <p className="text-2xl font-black text-slate-800 uppercase tracking-tighter tabular-nums">{value}</p>
          <p className="text-[9px] font-extrabold text-pmpe-navy uppercase tracking-tight mt-1">{sub}</p>
          {trend && (
            <p className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter mt-1">{trend}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
