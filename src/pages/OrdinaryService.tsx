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
import { Policeman, OrdinarySchedule, Volunteer, Escala, ServiceType } from '../types';
import { 
  Calendar as CalendarIcon, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  Info,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Printer,
  Share2,
  X,
  Download,
  Phone,
  MessageSquare,
  FileText,
  ShieldAlert,
  Shield
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDate, addMonths, subMonths, isSameDay, isWeekend } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';

const OrdinaryService = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policemen, setPolicemen] = useState<Policeman[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [schedules, setSchedules] = useState<Record<string, number[]>>({});
  const [escalas, setEscalas] = useState<Escala[]>([]);
  const [serviceTypes, setServiceTypes] = useState<Record<string, ServiceType>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVolunteers, setFilterVolunteers] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedPolicemanCalendar, setSelectedPolicemanCalendar] = useState<Policeman | null>(null);

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
      // Fetch all policemen to ensure volunteers are included even if not marked ATIVO
      const pSnapshot = await getDocs(collection(db, 'policemen'));
      const pList = pSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Policeman));
      // Sort by antiguidade, but prioritize ATIVO
      pList.sort((a, b) => {
        if (a.situacao === 'ATIVO' && b.situacao !== 'ATIVO') return -1;
        if (a.situacao !== 'ATIVO' && b.situacao === 'ATIVO') return 1;
        return a.antiguidade - b.antiguidade;
      });
      setPolicemen(pList);

      // Fetch volunteers for this specific month
      const vSnapshot = await getDocs(query(collection(db, 'volunteers'), where('month', '==', monthKey)));
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

      // Fetch service types to know the tipo (PJES/OPS)
      const stSnapshot = await getDocs(query(collection(db, 'serviceTypes'), where('month', '==', monthKey)));
      const stMap: Record<string, ServiceType> = {};
      stSnapshot.docs.forEach(d => {
        stMap[d.id] = { id: d.id, ...d.data() } as ServiceType;
      });
      setServiceTypes(stMap);

      // Fetch escalas for this month
      // Escalas use date (timestamp). We need to filter by range.
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      const eSnapshot = await getDocs(query(
        collection(db, 'escalas'),
        where('date', '>=', start),
        where('date', '<=', end)
      ));
      const eList = eSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Escala));
      setEscalas(eList);
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

      // We only save entries that have at least one day or exist already
      // To be safe and clean up, we can also delete empty ones if needed, 
      // but batch.set with merge is fine.
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

  const filteredPolicemen = policemen.filter(p => {
    const matchesSearch = p.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) || p.matricula.includes(searchTerm);
    const isVolunteer = volunteers.some(v => v.policemanId === p.id);
    
    // Only show active policemen OR volunteers of the month
    const isRelevant = p.situacao === 'ATIVO' || isVolunteer;
    
    if (filterVolunteers) return matchesSearch && isVolunteer;
    return matchesSearch && isRelevant;
  });

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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-pmpe-red" />
              <span className="font-bold">Ordinário</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="font-bold">Escala PJES</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="font-bold">Escala OPS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="font-bold">Vol. PJES</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="font-bold">Vol. OPS</span>
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
        <div className="flex gap-2">
          <button
            onClick={() => setFilterVolunteers(!filterVolunteers)}
            className={cn(
              "px-4 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all flex items-center gap-2",
              filterVolunteers 
                ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm" 
                : "bg-white border-slate-200 text-slate-400 hover:text-slate-600"
            )}
          >
            <UserCheck className="w-4 h-4" />
            {filterVolunteers ? 'Apenas Voluntários' : 'Filtrar Voluntários'}
          </button>
          <button
            onClick={saveSchedules}
            disabled={saving}
            className="px-8 py-3 bg-pmpe-navy text-white rounded-xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-pmpe-navy/20 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {saving ? 'SALVANDO...' : 'SALVAR ALTERAÇÕES'}
          </button>
        </div>
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
                {daysInMonth.map(day => {
                  const wknd = isWeekend(day);
                  return (
                    <th 
                      key={getDate(day)} 
                      className={cn(
                        "px-2 py-4 text-center text-[10px] font-black uppercase min-w-[32px] border-r border-slate-100 last:border-r-0",
                        wknd ? "text-pmpe-red bg-pmpe-red/5" : "text-slate-500"
                      )}
                    >
                      {getDate(day)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredPolicemen.length > 0 ? (
                filteredPolicemen.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-all group">
                    <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-6 py-3 border-r border-slate-200 shadow-[2px_0_4px_rgba(0,0,0,0.02)]">
                      <div className="flex flex-col">
                        <button 
                          onClick={() => setSelectedPolicemanCalendar(p)}
                          className="flex items-center gap-1.5 hover:text-pmpe-gold transition-colors text-left"
                        >
                          <span className="text-[11px] font-black text-pmpe-navy">{p.graduacaoPosto} {p.nomeGuerra}</span>
                          {volunteers.some(v => v.policemanId === p.id && v.type === 'PJES') && (
                            <span title="Voluntário PJES" className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                          )}
                          {volunteers.some(v => v.policemanId === p.id && v.type === 'OPS') && (
                            <span title="Voluntário OPS" className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                          )}
                        </button>
                        <span className="text-[9px] text-slate-400 font-bold">{p.matricula}</span>
                      </div>
                    </td>
                    {daysInMonth.map(day => {
                      const d = getDate(day);
                      const isSelected = (schedules[p.id!] || []).includes(d);
                      const wknd = isWeekend(day);
                      
                      // Check for PJES/OPS scales
                      const scaledExteriors = escalas.filter(e => 
                        isSameDay(e.date.toDate(), day) && 
                        e.policemenIds.includes(p.id!)
                      );

                      const hasPJES = scaledExteriors.some(e => serviceTypes[e.serviceTypeId]?.tipo === 'PJES');
                      const hasOPS = scaledExteriors.some(e => serviceTypes[e.serviceTypeId]?.tipo === 'OPS');

                      return (
                        <td 
                          key={d} 
                          className={cn(
                            "p-1 border-r border-slate-100 last:border-r-0 text-center",
                            wknd && "bg-slate-50/50"
                          )}
                        >
                          <div className="relative inline-block">
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
                            
                            {/* Indicators for PJES/OPS */}
                            <div className="absolute -top-1 -right-1 flex flex-col gap-0.5">
                              {hasPJES && (
                                <div className="w-2 h-2 rounded-full bg-emerald-500 border border-white" title="PJES" />
                              )}
                              {hasOPS && (
                                <div className="w-2 h-2 rounded-full bg-blue-500 border border-white" title="OPS" />
                              )}
                            </div>
                          </div>
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

      {/* Personal Calendar Modal */}
      <AnimatePresence>
        {selectedPolicemanCalendar && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-pmpe-navy text-white" style={{ backgroundColor: '#002147' }}>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black shadow-inner" style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.2)', borderWidth: '1px', borderStyle: 'solid', color: '#FFD700' }}>
                    {selectedPolicemanCalendar.graduacaoPosto.substring(0, 2)}
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tighter">
                      {selectedPolicemanCalendar.graduacaoPosto} {selectedPolicemanCalendar.nomeGuerra}
                    </h3>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      RELATÓRIO INDIVIDUAL DE SERVIÇO – {monthName}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedPolicemanCalendar(null)}
                  className="p-3 rounded-2xl transition-all"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: '1px', borderStyle: 'solid' }}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-8 custom-matrix-scroll" style={{ backgroundColor: '#f8fafc' }}>
                <div id="personal-report-content" className="p-6 border-2 rounded-3xl" style={{ backgroundColor: '#ffffff', borderColor: '#f1f5f9', borderStyle: 'solid' }}>
                   <div className="flex items-center justify-between mb-8 border-b-2 pb-6" style={{ borderColor: 'rgba(0,33,71,0.1)', borderBottomStyle: 'solid' }}>
                      <div className="flex items-center gap-3">
                         <div className="w-12 h-12">
                            <img src="/logo_9cipm.png" alt="9ª CIPM" className="w-full h-full object-contain" />
                         </div>
                         <div>
                            <p className="text-[11px] font-black uppercase tracking-widest leading-none" style={{ color: '#002147' }}>9ª CIPM - ARARIPINA</p>
                            <p className="text-[9px] font-bold uppercase mt-1" style={{ color: '#94a3b8' }}>Polícia Militar de Pernambuco</p>
                         </div>
                      </div>
                      <div className="text-right">
                         <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>Matrícula</p>
                         <p className="text-sm font-black" style={{ color: '#002147' }}>{selectedPolicemanCalendar.matricula}</p>
                      </div>
                   </div>

                   {/* Calendar Visualizer */}
                   <div className="grid grid-cols-7 gap-1.5 mb-8">
                      {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
                         <div key={d} className="text-center py-2 text-[10px] font-black uppercase tracking-widest rounded-lg" style={{ backgroundColor: '#f8fafc', color: '#94a3b8' }}>
                            {d}
                         </div>
                      ))}
                      {/* Offset for first day of month */}
                      {Array.from({ length: startOfMonth(currentDate).getDay() }).map((_, i) => (
                         <div key={`offset-${i}`} className="h-14 rounded-xl" style={{ backgroundColor: '#f8fafc' }} />
                      ))}
                      {daysInMonth.map(day => {
                         const d = getDate(day);
                         const isOrd = (schedules[selectedPolicemanCalendar.id!] || []).includes(d);
                         const scaled = escalas.filter(e => isSameDay(e.date.toDate(), day) && e.policemenIds.includes(selectedPolicemanCalendar.id!));
                         const pjesScales = scaled.filter(e => serviceTypes[e.serviceTypeId]?.tipo === 'PJES');
                         const opsScales = scaled.filter(e => serviceTypes[e.serviceTypeId]?.tipo === 'OPS');
                         const wknd = isWeekend(day);

                         return (
                            <div key={d} className="h-20 rounded-xl border p-2 flex flex-col justify-between transition-all" style={{ 
                              backgroundColor: isOrd ? '#fdf2f2' : (scaled.length > 0 ? '#ecfdf5' : (wknd ? '#f8fafc' : '#ffffff')),
                              borderColor: isOrd ? '#fee2e2' : (scaled.length > 0 ? '#d1fae5' : '#f1f5f9'),
                              borderStyle: 'solid',
                              borderWidth: '1px'
                            }}>
                               <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-black" style={{ color: isOrd ? '#ef4444' : '#94a3b8' }}>{d}</span>
                                  {isOrd && <ShieldAlert className="w-2.5 h-2.5" style={{ color: '#ef4444' }} />}
                               </div>
                               <div className="space-y-1">
                                  {pjesScales.map(e => (
                                     <div key={e.id} className="text-[7px] font-black text-white rounded px-1 py-0.5 truncate uppercase" style={{ backgroundColor: '#10b981' }}>
                                        PJES: {serviceTypes[e.serviceTypeId]?.sigla}
                                     </div>
                                  ))}
                                  {opsScales.map(e => (
                                     <div key={e.id} className="text-[7px] font-black text-white rounded px-1 py-0.5 truncate uppercase" style={{ backgroundColor: '#3b82f6' }}>
                                        OPS: {serviceTypes[e.serviceTypeId]?.sigla}
                                     </div>
                                  ))}
                                  {isOrd && (
                                     <div className="text-[7px] font-black text-white rounded px-1 py-0.5 truncate uppercase" style={{ backgroundColor: '#ef4444' }}>
                                        ORDINÁRIO
                                     </div>
                                  )}
                               </div>
                            </div>
                         );
                      })}
                   </div>

                   {/* List View for Report */}
                   <div className="space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 mb-4" style={{ color: '#002147' }}>
                         <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#FFD700' }} />
                         Resumo de Empenhamento
                      </h4>
                      <table className="w-full text-left">
                         <thead>
                            <tr className="border-b text-[9px] font-black uppercase tracking-widest" style={{ borderBottomColor: '#f1f5f9', borderBottomStyle: 'solid', borderBottomWidth: '1px', color: '#94a3b8' }}>
                               <th className="py-2">Data</th>
                               <th className="py-2">Serviço/Unidade</th>
                               <th className="py-2">Tipo</th>
                               <th className="py-2">Horário</th>
                            </tr>
                         </thead>
                         <tbody className="text-[10px] uppercase font-bold" style={{ color: '#334155' }}>
                            {(schedules[selectedPolicemanCalendar.id!] || []).map(dayNum => (
                               <tr key={`ord-${dayNum}`} className="border-b" style={{ borderBottomColor: '#f8fafc', borderBottomStyle: 'solid', borderBottomWidth: '1px' }}>
                                  <td className="py-2">{dayNum} / {format(currentDate, 'MM/yy')}</td>
                                  <td className="py-2">SERVICIO ORDINÁRIO 9ª CIPM</td>
                                  <td className="py-2"><span style={{ color: '#ef4444' }}>ORDINÁRIO</span></td>
                                  <td className="py-2">-</td>
                               </tr>
                            ))}
                            {escalas.filter(e => e.policemenIds.includes(selectedPolicemanCalendar.id!))
                              .sort((a, b) => a.date.toDate().getTime() - b.date.toDate().getTime())
                              .map(e => {
                                 const sType = serviceTypes[e.serviceTypeId];
                                 return (
                                    <tr key={e.id} className="border-b" style={{ borderBottomColor: '#f8fafc', borderBottomStyle: 'solid', borderBottomWidth: '1px' }}>
                                       <td className="py-2">{format(e.date.toDate(), 'dd/MM/yy')}</td>
                                       <td className="py-2">{sType?.nome} ({sType?.cidade})</td>
                                       <td className="py-2">
                                          <span style={{ color: sType?.tipo === 'PJES' ? '#059669' : '#2563eb' }}>
                                             {sType?.tipo}
                                          </span>
                                       </td>
                                       <td className="py-2">{sType?.horarioInicio} - {sType?.horarioTermino}</td>
                                    </tr>
                                 );
                              })}
                         </tbody>
                      </table>
                   </div>
                   
                   <div className="mt-8 pt-6 border-t flex items-center justify-between" style={{ borderTopColor: '#f1f5f9', borderTopStyle: 'solid', borderTopWidth: '1px' }}>
                      <div className="text-[8px] font-bold uppercase italic" style={{ color: '#94a3b8' }}>
                         Gerado via Sistema Integrado de Escalas - 9ª CIPM
                      </div>
                      <div className="text-[8px] font-black uppercase" style={{ color: '#002147' }}>
                         {new Date().toLocaleString('pt-BR')}
                      </div>
                   </div>
                </div>
              </div>

              {/* Modal Footer (Actions) */}
              <div className="p-8 border-t border-slate-100 bg-slate-50 flex flex-wrap gap-4 items-center justify-end">
                <button 
                  onClick={() => {
                    const poly = selectedPolicemanCalendar;
                    const ordDays = (schedules[poly.id!] || []).sort((a,b) => a-b);
                    const extras = escalas.filter(e => e.policemenIds.includes(poly.id!))
                      .sort((a,b) => a.date.toDate().getTime() - b.date.toDate().getTime());
                    
                    let text = `*ESCALA MENSAL - 9ª CIPM*\n`;
                    text += `*PM:* ${poly.graduacaoPosto} ${poly.nomeGuerra}\n`;
                    text += `*MÊS:* ${monthName.toUpperCase()}\n\n`;
                    
                    if (ordDays.length > 0) {
                      text += `*ORDINÁRIO:* ${ordDays.join(', ')}\n`;
                    }
                    
                    if (extras.length > 0) {
                      text += `\n*EXTRAS (PJES/OPS):*\n`;
                      extras.forEach(e => {
                        const s = serviceTypes[e.serviceTypeId];
                        text += `• ${format(e.date.toDate(), 'dd/MM')} - ${s?.sigla} (${s?.horarioInicio}-${s?.horarioTermino})\n`;
                      });
                    }
                    
                    text += `\n_Consulte sua escala completa no terminal de serviço._`;
                    
                    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                  }}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" /> Whatsapp
                </button>

                <button 
                  onClick={async () => {
                    const el = document.getElementById('personal-report-content');
                    if (!el) return;
                    const html2canvas = (await import('html2canvas')).default;
                    const jsPDF = (await import('jspdf')).jsPDF;
                    
                    const canvas = await html2canvas(el, { scale: 2 });
                    const imgData = canvas.toDataURL('image/png');
                    const pdf = new jsPDF('p', 'mm', 'a4');
                    const imgProps = pdf.getImageProperties(imgData);
                    const pdfWidth = pdf.internal.pageSize.getWidth();
                    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
                    
                    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
                    pdf.save(`Escala_${selectedPolicemanCalendar.nomeGuerra}_${monthKey}.pdf`);
                  }}
                  className="px-6 py-3 bg-pmpe-navy text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-pmpe-navy/20 flex items-center gap-2"
                >
                  <Download className="w-4 h-4 text-pmpe-gold" /> Salvar PDF
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrdinaryService;
