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
import { QuotaSettings, Volunteer, Escala } from '../types';
import { 
  ShieldCheck, 
  TrendingUp, 
  PieChart as PieChartIcon, 
  AlertTriangle,
  Save,
  BarChart3,
  Calendar
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const QuotaControl = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const monthKey = format(currentDate, 'yyyy-MM');
  const [settings, setSettings] = useState<QuotaSettings | null>(null);
  const [stats, setStats] = useState({
    pjesUsed: 0,
    opsUsed: 0,
    volunteersCount: 0,
    totalEscalas: 0
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // Fetch settings
      const settingsSnap = await getDocs(query(collection(db, 'quotaSettings'), where('month', '==', monthKey)));
      if (!settingsSnap.empty) {
        setSettings({ id: settingsSnap.docs[0].id, ...settingsSnap.docs[0].data() } as QuotaSettings);
      } else {
        setSettings({ month: monthKey, pjesTotal: 100, opsTotal: 50 });
      }

      // Fetch scales for PJES/OPS usage
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      const escalasSnap = await getDocs(query(collection(db, 'escalas')));
      const monthEscalas = escalasSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Escala))
        .filter(e => {
            const date = e.date.toDate();
            return date >= start && date <= end;
        });

      // Calculate usage (we need to know the type of each scale)
      // This is dynamic, so we'll fetch service types too
      const serviceSnap = await getDocs(collection(db, 'serviceTypes'));
      const services = serviceSnap.docs.reduce((acc, d) => {
        const s = d.data();
        acc[d.id] = s.tipo;
        return acc;
      }, {} as any);

      let pjes = 0;
      let ops = 0;
      monthEscalas.forEach(e => {
        const type = services[e.serviceTypeId];
        if (type === 'PJES') pjes += e.policemenIds.length;
        if (type === 'OPS') ops += e.policemenIds.length;
      });

      const volSnap = await getDocs(query(collection(db, 'volunteers'), where('month', '==', monthKey)));

      setStats({
        pjesUsed: pjes,
        opsUsed: ops,
        volunteersCount: volSnap.size,
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

  const pjesData = [
    { name: 'Utilizado', value: stats.pjesUsed },
    { name: 'Disponível', value: Math.max(0, (settings?.pjesTotal || 0) - stats.pjesUsed) }
  ];

  const opsData = [
    { name: 'Utilizado', value: stats.opsUsed },
    { name: 'Disponível', value: Math.max(0, (settings?.opsTotal || 0) - stats.opsUsed) }
  ];

  const COLORS = ['#1e293b', '#fbbf24'];

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
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-black text-pmpe-navy uppercase">Total de Cotas PJES</span>
                  <span className="text-xs font-black text-slate-800">{settings?.pjesTotal}</span>
                </div>
                <input 
                  type="number"
                  value={settings?.pjesTotal || 0}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, pjesTotal: parseInt(e.target.value) } : null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold shadow-inner"
                />
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex justify-between items-center mb-2">
                   <span className="text-[10px] font-black text-pmpe-navy uppercase">Total de Cotas OPS</span>
                   <span className="text-xs font-black text-slate-800">{settings?.opsTotal}</span>
                </div>
                <input 
                  type="number"
                  value={settings?.opsTotal || 0}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, opsTotal: parseInt(e.target.value) } : null)}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* PJES Chart */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-[10px] font-black text-pmpe-navy uppercase">Monitor de PJES</h3>
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</p>
                </div>
                <div className="text-right">
                    <span className="text-lg font-black text-slate-800">{Math.round((stats.pjesUsed / (settings?.pjesTotal || 1)) * 100)}%</span>
                </div>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pjesData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pjesData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '10px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                 <div className="p-2 bg-slate-50 rounded-lg">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Utilizado</p>
                    <p className="text-xs font-black text-pmpe-navy">{stats.pjesUsed}</p>
                 </div>
                 <div className="p-2 bg-slate-50 rounded-lg">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Restante</p>
                    <p className="text-xs font-black text-pmpe-gold">{Math.max(0, (settings?.pjesTotal || 0) - stats.pjesUsed)}</p>
                 </div>
              </div>
            </motion.div>

            {/* OPS Chart */}
            <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.1 }}
               className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-[10px] font-black text-pmpe-navy uppercase">Monitor de OPS</h3>
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</p>
                </div>
                <div className="text-right">
                    <span className="text-lg font-black text-slate-800">{Math.round((stats.opsUsed / (settings?.opsTotal || 1)) * 100)}%</span>
                </div>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={opsData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {opsData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '10px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                 <div className="p-2 bg-slate-50 rounded-lg">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Utilizado</p>
                    <p className="text-xs font-black text-pmpe-navy">{stats.opsUsed}</p>
                 </div>
                 <div className="p-2 bg-slate-50 rounded-lg">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Restante</p>
                    <p className="text-xs font-black text-pmpe-gold">{Math.max(0, (settings?.opsTotal || 0) - stats.opsUsed)}</p>
                 </div>
              </div>
            </motion.div>
          </div>

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
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Alerta de Excesso</p>
                   {stats.pjesUsed > (settings?.pjesTotal || 0) || stats.opsUsed > (settings?.opsTotal || 0) ? (
                     <p className="text-xs font-black text-red-600 mt-1 uppercase tracking-tighter">COTA EXCEDIDA</p>
                   ) : (
                     <p className="text-xs font-black text-emerald-600 mt-1 uppercase tracking-tighter">DENTRO DOS LIMITES</p>
                   )}
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuotaControl;
