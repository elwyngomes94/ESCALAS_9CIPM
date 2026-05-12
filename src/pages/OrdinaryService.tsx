import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  setDoc, 
  doc, 
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Policeman, OrdinarySchedule, Volunteer } from '../types';
import { 
  Calendar as CalendarIcon, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  Info,
  CheckCircle2,
  AlertCircle,
  UserCheck
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDate, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/firebase';

const OrdinaryService = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policemen, setPolicemen] = useState<Policeman[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [schedules, setSchedules] = useState<Record<string, number[]>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const monthKey = format(currentDate, 'yyyy-MM');
  const monthName = format(currentDate, 'MMMM yyyy', { locale: ptBR });
  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentDate),
    end: endOfMonth(currentDate)
  });

  useEffect(() => {
    fetchData();
  }, [monthKey]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch all active policemen
      const pSnapshot = await getDocs(query(collection(db, 'policemen'), where('situacao', '==', 'ATIVO')));
      const pList = pSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Policeman));
      pList.sort((a, b) => a.antiguidade - b.antiguidade);
      setPolicemen(pList);

      // Fetch all volunteers
      const vSnapshot = await getDocs(collection(db, 'volunteers'));
      const vList = vSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Volunteer));
      setVolunteers(vList);

      // Fetch schedules for this month
      const sSnapshot = await getDocs(query(collection(db, 'ordinarySchedules'), where('month', '==', monthKey)));
      const sMap: Record<string, number[]> = {};
      sSnapshot.docs.forEach(d => {
        const data = d.data();
        sMap[data.policemanId] = data.days || [];
      });
      setSchedules(sMap);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'multiple');
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (policemanId: string, day: number) => {
    setSchedules(prev => {
      const currentDays = prev[policemanId] || [];
      const newDays = currentDays.includes(day)
        ? currentDays.filter(d => d !== day)
        : [...currentDays, day].sort((a, b) => a - b);
      return { ...prev, [policemanId]: newDays };
    });
  };

  const saveSchedules = async () => {
    setSaving(true);
    try {
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);

      // We only save entries that have at least one day
      Object.entries(schedules).forEach(([policemanId, days]) => {
        const id = `${policemanId}_${monthKey}`;
        const docRef = doc(db, 'ordinarySchedules', id);
        batch.set(docRef, {
          policemanId,
          month: monthKey,
          days,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();
      setSuccessMessage('Escala ordinária salva com sucesso!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'bulk_ordinary');
    } finally {
      setSaving(false);
    }
  };

  const filteredPolicemen = policemen.filter(p => 
    p.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.matricula.includes(searchTerm)
  );

  if (loading && policemen.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-pmpe-navy border-t-transparent mb-4"></div>
        <p className="text-[10px] font-black uppercase tracking-widest">Carregando efetivo...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-pmpe-navy flex items-center gap-3">
            <CalendarIcon className="w-6 h-6 text-pmpe-red" />
            Definir Serviço Ordinário
          </h2>
          <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest mt-1">
            Marque os dias em que o policial estará de serviço na escala ordinária
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setCurrentDate(prev => subMonths(prev, 1))}
            className="p-2 hover:bg-slate-100 rounded-lg transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="px-4 py-2 bg-slate-50 rounded-lg border border-slate-200 text-sm font-bold text-pmpe-navy min-w-[150px] text-center capitalize">
            {monthName}
          </div>
          <button 
            onClick={() => setCurrentDate(prev => addMonths(prev, 1))}
            className="p-2 hover:bg-slate-100 rounded-lg transition-all"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-4">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-[11px] text-blue-800 leading-relaxed">
          <p className="font-bold uppercase tracking-tight mb-1">Por que definir o serviço ordinário?</p>
          <p>Ao definir os dias de serviço regular, o sistema impedirá que este policial seja selecionado para escalas extras (GJ) nestes mesmos dias, garantindo o tempo de descanso e evitando erros operacionais.</p>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-bold">Voluntário PJES</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="font-bold">Voluntário OPS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls & Search */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="BUSCAR POR NOME DE GUERRA OU MATRÍCULA..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-[11px] font-bold uppercase tracking-widest focus:ring-2 focus:ring-pmpe-navy outline-none transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button
          onClick={saveSchedules}
          disabled={saving}
          className="px-8 py-3 bg-pmpe-navy text-white rounded-xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-pmpe-navy/20 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {saving ? 'SALVANDO...' : 'SALVAR ALTERAÇÕES'}
        </button>
      </div>

      {/* Grid Container - Horizontal scroll for days */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="sticky left-0 bg-slate-50 z-20 px-6 py-4 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-200 min-w-[200px]">
                  Policial
                </th>
                {daysInMonth.map(day => (
                  <th key={getDate(day)} className="px-2 py-4 text-center text-[10px] font-black text-slate-500 uppercase min-w-[32px] border-r border-slate-100 last:border-r-0">
                    {getDate(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPolicemen.length > 0 ? (
                filteredPolicemen.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-all group">
                    <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-6 py-3 border-r border-slate-200 shadow-[2px_0_4px_rgba(0,0,0,0.02)]">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-pmpe-navy">{p.graduacaoPosto} {p.nomeGuerra}</span>
                          {volunteers.some(v => v.policemanId === p.id && v.type === 'PJES') && (
                            <span title="Voluntário PJES" className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                          )}
                          {volunteers.some(v => v.policemanId === p.id && v.type === 'OPS') && (
                            <span title="Voluntário OPS" className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                          )}
                        </div>
                        <span className="text-[9px] text-slate-400 font-bold">{p.matricula}</span>
                      </div>
                    </td>
                    {daysInMonth.map(day => {
                      const d = getDate(day);
                      const isSelected = (schedules[p.id!] || []).includes(d);
                      return (
                        <td 
                          key={d} 
                          className="p-1 border-r border-slate-100 last:border-r-0 text-center"
                        >
                          <button
                            onClick={() => toggleDay(p.id!, d)}
                            className={cn(
                              "w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold transition-all",
                              isSelected 
                                ? "bg-pmpe-red text-white shadow-md shadow-pmpe-red/30 scale-110" 
                                : "text-slate-300 hover:bg-slate-200/50"
                            )}
                          >
                            {isSelected ? <CheckCircle2 className="w-3 h-3" /> : d}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={daysInMonth.length + 1} className="py-12 text-center text-[10px] font-black text-slate-400 uppercase italic">
                    Nenhum policial encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Success Notification */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-10 right-10 bg-green-600 text-white px-6 py-3 rounded-xl shadow-2xl z-50 flex items-center gap-3 border border-green-500"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-widest">{successMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Simple utility for CN
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}

export default OrdinaryService;
