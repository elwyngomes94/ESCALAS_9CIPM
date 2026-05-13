import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  query, 
  where,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { QuotaSettings, QuotaLog, ServiceType, Escala } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { 
  ShieldCheck, 
  TrendingUp, 
  PieChart as PieChartIcon, 
  AlertTriangle,
  Save,
  BarChart3,
  Calendar,
  History,
  ArrowDownCircle,
  User as UserIcon,
  Tag
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';

const QuotaControl = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const monthKey = format(currentDate, 'yyyy-MM');
  const [settings, setSettings] = useState<QuotaSettings | null>(null);
  const [stats, setStats] = useState({
    pjesMPUsed: 0,
    pjesForumUsed: 0,
    pjesEscolarUsed: 0,
    pjesDecretoUsed: 0,
    opsUsed: 0,
    totalEscalas: 0
  });
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<QuotaLog[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // Fetch settings
      const settingsSnap = await getDocs(query(collection(db, 'quotaSettings'), where('month', '==', monthKey)));
      if (!settingsSnap.empty) {
        setSettings({ id: settingsSnap.docs[0].id, ...settingsSnap.docs[0].data() } as QuotaSettings);
      } else {
        setSettings({ 
          month: monthKey, 
          pjesMPTotal: 0, 
          pjesForumTotal: 0, 
          pjesEscolarTotal: 0, 
          pjesDecretoTotal: 0, 
          opsTotal: 0 
        });
      }

      // Fetch Service Types for the table
      const serviceSnap = await getDocs(collection(db, 'serviceTypes'));
      setServiceTypes(serviceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ServiceType));

      // Fetch History logs
      const historyQ = query(
        collection(db, 'quotaLogs'), 
        where('month', '==', monthKey),
        orderBy('data', 'desc')
      );
      const historySnap = await getDocs(historyQ);
      setHistory(historySnap.docs.map(d => ({ id: d.id, ...d.data() }) as QuotaLog));

      // Calculate usage from logs
      let pMP = 0, pForum = 0, pEscolar = 0, pDecreto = 0, ops = 0;
      historySnap.docs.forEach(doc => {
        const log = doc.data() as QuotaLog;
        if (log.tipo === 'OPS') ops += log.quantidade;
        else if (log.tipo === 'PJES') {
          if (log.pjesSubtype === 'MP') pMP += log.quantidade;
          else if (log.pjesSubtype === 'FORUM') pForum += log.quantidade;
          else if (log.pjesSubtype === 'ESCOLAR') pEscolar += log.quantidade;
          else if (log.pjesSubtype === 'DECRETO') pDecreto += log.quantidade;
        }
      });

      // Also count total scales for stats
      const escalasSnap = await getDocs(query(collection(db, 'escalas')));
      const monthEscalas = escalasSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Escala))
        .filter(e => {
            const dateStr = typeof e.date === 'string' ? e.date : e.date.toDate().toISOString();
            return dateStr.startsWith(monthKey);
        });

      setStats({
        pjesMPUsed: pMP,
        pjesForumUsed: pForum,
        pjesEscolarUsed: pEscolar,
        pjesDecretoUsed: pDecreto,
        opsUsed: ops,
        totalEscalas: monthEscalas.length
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [monthKey]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      const id = settings.id || `${monthKey}_settings`;
      await setDoc(doc(db, 'quotaSettings', id), {
        ...settings,
        updatedAt: serverTimestamp()
      }, { merge: true });
      alert('Configurações salvas com sucesso!');
      fetchStats();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-pmpe-gold" />
          Controle de Cotas PJES/OPS
        </h2>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão orçamentária de serviços extraordinários</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings Form */}
        <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="w-4 h-4 text-pmpe-navy" />
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Definir Limites</h3>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Mês de Referência</label>
              <input 
                type="month"
                value={monthKey}
                onChange={(e) => setCurrentDate(new Date(e.target.value + '-02'))}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold font-sans bg-slate-50"
              />
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-[9px] font-black text-pmpe-navy uppercase mb-1">PJES - MP</label>
                <input 
                  type="number"
                  value={settings?.pjesMPTotal || 0}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, pjesMPTotal: parseFloat(e.target.value) } : null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold shadow-inner"
                />
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-[9px] font-black text-pmpe-navy uppercase mb-1">PJES - Fóruns</label>
                <input 
                  type="number"
                  value={settings?.pjesForumTotal || 0}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, pjesForumTotal: parseFloat(e.target.value) } : null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold shadow-inner"
                />
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-[9px] font-black text-pmpe-navy uppercase mb-1">PJES - Patrulha Escolar</label>
                <input 
                  type="number"
                  value={settings?.pjesEscolarTotal || 0}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, pjesEscolarTotal: parseFloat(e.target.value) } : null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold shadow-inner"
                />
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-[9px] font-black text-pmpe-navy uppercase mb-1">PJES - Decreto</label>
                <input 
                  type="number"
                  value={settings?.pjesDecretoTotal || 0}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, pjesDecretoTotal: parseFloat(e.target.value) } : null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold shadow-inner"
                />
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-[9px] font-black text-amber-600 uppercase mb-1">Cotas OPS</label>
                <input 
                  type="number"
                  value={settings?.opsTotal || 0}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, opsTotal: parseFloat(e.target.value) } : null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold shadow-inner"
                />
              </div>
            </div>

            <button
               type="submit"
               className="w-full py-3 bg-pmpe-navy text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4 text-pmpe-gold" />
              Salvar Configurações
            </button>
          </form>
        </motion.div>

        {/* Charts and Stats */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
            >
              <h3 className="text-[10px] font-black text-pmpe-navy uppercase mb-6 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Consumo por Categoria
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[
                  { label: 'PJES MP', used: stats.pjesMPUsed, total: settings?.pjesMPTotal || 0, color: 'bg-pmpe-navy' },
                  { label: 'PJES Fóruns', used: stats.pjesForumUsed, total: settings?.pjesForumTotal || 0, color: 'bg-pmpe-navy' },
                  { label: 'PJES Escolar', used: stats.pjesEscolarUsed, total: settings?.pjesEscolarTotal || 0, color: 'bg-pmpe-navy' },
                  { label: 'PJES Decreto', used: stats.pjesDecretoUsed, total: settings?.pjesDecretoTotal || 0, color: 'bg-pmpe-navy' },
                  { label: 'Cotas OPS', used: stats.opsUsed, total: settings?.opsTotal || 0, color: 'bg-pmpe-gold' },
                ].map((item, i) => {
                  const percent = item.total > 0 ? Math.min(100, (item.used / item.total) * 100) : 0;
                  const statusColor = percent >= 95 ? 'text-red-600' : percent >= 75 ? 'text-amber-600' : 'text-emerald-600';
                  
                  return (
                    <div key={i} className="space-y-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex justify-between items-end">
                        <span className="text-[9px] font-black text-slate-500 uppercase">{item.label}</span>
                        <span className={`text-xs font-black ${statusColor}`}>{Math.round(percent)}%</span>
                      </div>
                      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${percent}%` }}
                          className={`h-full ${item.color} ${percent >= 90 ? 'bg-red-500' : ''}`}
                        />
                      </div>
                      <div className="flex justify-between text-[9px] font-bold uppercase">
                        <span className="text-slate-400">Uso: {item.used}</span>
                        <span className="text-slate-800">Saldo: {Math.max(0, item.total - item.used)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>

          {/* Distribution Table */}
          <motion.div 
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.1 }}
             className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
          >
             <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <Tag className="w-4 h-4 text-pmpe-navy" />
                   <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Distribuição por Tipos de Serviços</h3>
                </div>
             </div>

             <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                   <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Tipo de Serviço</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Categoria</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Cotas Totais</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Utilizadas</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Saldo</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                      {serviceTypes.map(s => {
                        const used = history
                          .filter(h => h.serviceTypeId === s.id)
                          .reduce((acc, h) => acc + h.quantidade, 0);
                        
                        // Find category total from settings
                        let total = 0;
                        if (s.tipo === 'OPS') total = settings?.opsTotal || 0;
                        else if (s.tipo === 'PJES') {
                          if (s.pjesSubtype === 'MP') total = settings?.pjesMPTotal || 0;
                          else if (s.pjesSubtype === 'FORUM') total = settings?.pjesForumTotal || 0;
                          else if (s.pjesSubtype === 'ESCOLAR') total = settings?.pjesEscolarTotal || 0;
                          else if (s.pjesSubtype === 'DECRETO') total = settings?.pjesDecretoTotal || 0;
                        }

                        return (
                          <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <span className="text-[11px] font-black text-slate-800 uppercase tracking-tight">{s.nome}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest text-white",
                                s.tipo === 'PJES' ? "bg-pmpe-navy" : "bg-pmpe-gold text-pmpe-navy"
                              )}>
                                {s.tipo} {s.pjesSubtype ? `- ${s.pjesSubtype}` : ''}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-[11px] font-black text-slate-400">{total || '-'}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-[11px] font-black text-red-600">{used}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className={cn(
                                "text-[11px] font-black",
                                (total - used) <= 0 ? "text-red-600" : "text-emerald-600"
                              )}>
                                {total ? (total - used) : '-'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                   </tbody>
                </table>
             </div>
          </motion.div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <div className="bg-pmpe-navy p-5 rounded-2xl border border-slate-200 flex flex-col justify-between overflow-hidden relative group">
                <div className="absolute -right-4 -top-4 w-16 h-16 bg-white/5 rounded-full group-hover:scale-150 transition-all duration-700" />
                <BarChart3 className="w-5 h-5 text-pmpe-gold mb-3" />
                <div>
                   <p className="text-[8px] font-black text-white/50 uppercase tracking-widest">Total de Escalas</p>
                   <p className="text-2xl font-black text-white">{stats.totalEscalas}</p>
                </div>
             </div>

             <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col justify-between shadow-sm">
                <Calendar className="w-5 h-5 text-pmpe-navy mb-3" />
                <div>
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Mês em Exercício</p>
                   <p className="text-xl font-black text-slate-800 uppercase tracking-tighter truncate">{format(currentDate, 'MMMM / yy', { locale: ptBR })}</p>
                </div>
             </div>

            <div className="bg-slate-100 p-5 rounded-2xl border border-slate-200 flex flex-col justify-between overflow-hidden relative">
                <div className="absolute right-0 bottom-0 p-2 opacity-10">
                   <AlertTriangle className="w-10 h-10" />
                </div>
                <div>
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Status Geral</p>
                   {(() => {
                     const totalPjesLimit = (settings?.pjesMPTotal || 0) + (settings?.pjesForumTotal || 0) + (settings?.pjesEscolarTotal || 0) + (settings?.pjesDecretoTotal || 0);
                     const totalPjesUsed = stats.pjesMPUsed + stats.pjesForumUsed + stats.pjesEscolarUsed + stats.pjesDecretoUsed;
                     const opsLimit = settings?.opsTotal || 0;
                     const opsUsed = stats.opsUsed;

                     const isCritical = (totalPjesLimit > 0 && totalPjesUsed >= totalPjesLimit * 0.95) || (opsLimit > 0 && opsUsed >= opsLimit * 0.95);
                     const isWarning = (totalPjesLimit > 0 && totalPjesUsed >= totalPjesLimit * 0.75) || (opsLimit > 0 && opsUsed >= opsLimit * 0.75);

                     if (isCritical) {
                       return (
                         <div className="flex items-center gap-2 mt-1">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <p className="text-xs font-black text-red-600 uppercase tracking-tighter">CRÍTICO: SALDO ZERADO</p>
                         </div>
                       );
                     } else if (isWarning) {
                       return (
                         <div className="flex items-center gap-2 mt-1">
                            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            <p className="text-xs font-black text-amber-600 uppercase tracking-tighter">ATENÇÃO: SALDO BAIXO</p>
                         </div>
                       );
                     } else {
                       return (
                         <div className="flex items-center gap-2 mt-1">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                            <p className="text-xs font-black text-emerald-600 uppercase tracking-tighter">SALDO SAUDÁVEL</p>
                         </div>
                       );
                     }
                   })()}
                </div>
             </div>
          </div>

          {/* History Table */}
          <motion.div 
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.2 }}
             className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
          >
             <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <History className="w-4 h-4 text-pmpe-navy" />
                   <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Histórico de Utilização</h3>
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Últimas movimentações do mês</span>
             </div>

             <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                   <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Data/Hora</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Serviço</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Tipo</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Cotas</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Responsável</th>
                         <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Escala</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        <tr><td colSpan={6} className="px-6 py-12 text-center text-[10px] font-bold text-slate-400 uppercase italic">Carregando histórico...</td></tr>
                      ) : history.length === 0 ? (
                        <tr><td colSpan={6} className="px-6 py-12 text-center text-[10px] font-bold text-slate-400 uppercase italic">Nenhuma movimentação registrada</td></tr>
                      ) : (
                        history.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                             <td className="px-6 py-4">
                                <div className="flex flex-col">
                                   <span className="text-[11px] font-black text-slate-700">{format(log.data.toDate(), 'dd/MM/yyyy')}</span>
                                   <span className="text-[9px] font-bold text-slate-400 font-mono">{format(log.data.toDate(), 'HH:mm:ss')}</span>
                                </div>
                             </td>
                             <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                   <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center">
                                      <Tag className="w-3.5 h-3.5 text-pmpe-navy" />
                                   </div>
                                   <span className="text-[11px] font-black text-slate-800 uppercase tracking-tight">{log.serviceName}</span>
                                </div>
                             </td>
                             <td className="px-6 py-4 text-center">
                                <span className={cn(
                                   "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest text-white",
                                   log.tipo === 'PJES' ? "bg-pmpe-navy" : "bg-pmpe-gold text-pmpe-navy"
                                )}>
                                   {log.tipo}
                                </span>
                             </td>
                             <td className="px-6 py-4 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                   <ArrowDownCircle className="w-3 h-3 text-red-500" />
                                   <span className="text-xs font-black text-slate-800">-{log.quantidade}</span>
                                </div>
                             </td>
                             <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                   <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                                      <UserIcon className="w-3 h-3 text-slate-400" />
                                   </div>
                                   <span className="text-[10px] font-bold text-slate-500 truncate max-w-[150px]">{log.usuarioEmail}</span>
                                </div>
                             </td>
                             <td className="px-6 py-4 text-right">
                                <span className="text-[10px] font-mono font-bold text-slate-300">ID: {log.escalaId.substring(0, 8)}</span>
                             </td>
                          </tr>
                        ))
                      )}
                   </tbody>
                </table>
             </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default QuotaControl;
