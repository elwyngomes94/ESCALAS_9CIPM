import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc,
  query, 
  where,
  orderBy,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Policeman, ServiceType, Volunteer, Escala } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { sortPolicemen } from '../lib/utils/policeUtils';
import { useAuth } from '../contexts/AuthContext';
import { 
  Plus, 
  Search, 
  X, 
  Save, 
  Calendar,
  Briefcase,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Car,
  Crown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDate, isSameDay, getDay } from 'date-fns';

const CreateEscala = () => {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'PJES' | 'OPS'>('PJES');
  const [services, setServices] = useState<ServiceType[]>([]);
  const [volunteers, setVolunteers] = useState<(Volunteer & { policeman?: Policeman })[]>([]);
  const [existingScales, setExistingScales] = useState<Escala[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [isMonthlyMode, setIsMonthlyMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [ordinarySchedules, setOrdinarySchedules] = useState<Record<string, number[]>>({});
  const [allEscalasOfMonth, setAllEscalasOfMonth] = useState<Escala[]>([]);

  const [formData, setFormData] = useState({
    serviceTypeId: '',
    selectedPoliceIds: [] as string[],
    date: format(new Date(), 'yyyy-MM-dd'),
    observations: ''
  });

  const [showOnlyDrivers, setShowOnlyDrivers] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleDay = (day: number) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter(d => d !== day));
    } else {
      setSelectedDays([...selectedDays, day].sort((a, b) => a - b));
    }
  };

  useEffect(() => {
    const fetchBaseData = async () => {
      setLoading(true);
      try {
        const sQ = activeTab === 'PJES' 
          ? query(collection(db, 'serviceTypes'), where('tipo', '==', 'PJES'), orderBy('nome'))
          : query(collection(db, 'serviceTypes'), where('tipo', '==', 'OPS'), orderBy('nome'));
          
        const sSnap = await getDocs(sQ);
        const sData = sSnap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceType));
        setServices(sData);
        
        // Reset selection when tab changes
        if (sData.length > 0 && !sData.find(s => s.id === formData.serviceTypeId)) {
          setFormData(prev => ({ ...prev, serviceTypeId: sData[0].id }));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchBaseData();
  }, [activeTab]);

  useEffect(() => {
    if (!formData.serviceTypeId) {
      setVolunteers([]);
      return;
    }

    const fetchVolunteersAndScales = async () => {
      const selectedService = services.find(s => s.id === formData.serviceTypeId);
      if (!selectedService) return;

      const dateObj = new Date(formData.date + 'T12:00:00');
      const mKey = format(dateObj, 'yyyy-MM');

      try {
        const vQ = query(
          collection(db, 'volunteers'), 
          where('type', '==', selectedService.tipo),
          where('month', '==', mKey)
        );
        const vSnap = await getDocs(vQ);
        
        // Fetch existing scales for this service
        const eQ = query(collection(db, 'escalas'), where('serviceTypeId', '==', formData.serviceTypeId));
        const eSnap = await getDocs(eQ);
        setExistingScales(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as Escala)));

        // Fetch ALL scales of the month
        const monthStart = Timestamp.fromDate(startOfMonth(dateObj));
        const monthEnd = Timestamp.fromDate(endOfMonth(dateObj));
        const allMQS = await getDocs(query(
          collection(db, 'escalas'), 
          where('date', '>=', monthStart),
          where('date', '<=', monthEnd)
        ));
        setAllEscalasOfMonth(allMQS.docs.map(d => ({ id: d.id, ...d.data() } as Escala)));

        // Fetch Ordinary Schedules
        const ordSnap = await getDocs(query(
          collection(db, 'ordinarySchedules'),
          where('month', '==', mKey)
        ));
        const oMap: Record<string, number[]> = {};
        ordSnap.docs.forEach(d => {
          const data = d.data();
          oMap[data.policemanId] = data.days || [];
        });
        setOrdinarySchedules(oMap);

        const polySnap = await getDocs(collection(db, 'policemen'));
        const polyData = polySnap.docs.map(d => ({ id: d.id, ...d.data() } as Policeman));

        const vData = vSnap.docs.map(vDoc => {
          const v = { id: vDoc.id, ...vDoc.data() } as Volunteer;
          const p = polyData.find(police => police.id === v.policemanId);
          return { ...v, policeman: p };
        });

        const sortedVData = [...vData].sort((a, b) => {
          if (!a.policeman || !b.policeman) return 0;
          return sortPolicemen([a.policeman, b.policeman])[0] === a.policeman ? -1 : 1;
        });

        setVolunteers(sortedVData);
      } catch (err) {
        console.error(err);
      }
    };
    fetchVolunteersAndScales();
  }, [formData.serviceTypeId, formData.date, services]);

  const togglePolice = (id: string) => {
    const conflicts = getDayConflicts(id, formData.date);
    
    if (conflicts.isOrdinary && !formData.selectedPoliceIds.includes(id)) {
      return; // Strict impediment: cannot select if has ordinary service
    }

    setFormData(prev => ({
      ...prev,
      selectedPoliceIds: prev.selectedPoliceIds.includes(id)
        ? prev.selectedPoliceIds.filter(pId => pId !== id)
        : [...prev.selectedPoliceIds, id]
    }));
  };

  const getDayConflicts = (policemanId: string, dateStr: string) => {
    const day = getDate(new Date(dateStr + 'T12:00:00'));
    const isOrdinary = (ordinarySchedules[policemanId] || []).includes(day);
    
    const extraScalesOnDay = allEscalasOfMonth.filter(esc => {
      const escDateStr = format(esc.date.toDate(), 'yyyy-MM-dd');
      return escDateStr === dateStr && esc.policemenIds.includes(policemanId);
    });

    // Check monthly volunteer limits (cotas used)
    const vol = volunteers.find(v => v.policemanId === policemanId);
    const totalExtrasInMonth = allEscalasOfMonth.filter(esc => esc.policemenIds.includes(policemanId)).length;
    const quotaReached = vol ? totalExtrasInMonth >= vol.cotas : false;

    return {
      isOrdinary,
      hasExtra: extraScalesOnDay.length > 0,
      totalExtrasInMonth,
      quotaReached
    };
  };

  const smartSuggest = () => {
    if (!formData.serviceTypeId) return;
    
    const availableVolunteers = volunteers.filter(v => {
      const conflicts = getDayConflicts(v.policemanId, formData.date);
      return !conflicts.isOrdinary && !conflicts.hasExtra;
    });

    // Intelligent fair distribution
    availableVolunteers.sort((a, b) => {
      const conflictsA = getDayConflicts(a.policemanId, formData.date);
      const conflictsB = getDayConflicts(b.policemanId, formData.date);
      
      // Prioritize who has fewer extras this month (fairness)
      if (conflictsA.totalExtrasInMonth !== conflictsB.totalExtrasInMonth) {
        return conflictsA.totalExtrasInMonth - conflictsB.totalExtrasInMonth;
      }
      
      // Secondary: Seniority (antiguidade) - just an example of tie-breaker
      return (a.policeman?.antiguidade || 0) - (b.policeman?.antiguidade || 0);
    });

    const suggestedIds = availableVolunteers.slice(0, 4).map(v => v.policemanId);
    setFormData(prev => ({
      ...prev,
      selectedPoliceIds: [...new Set([...prev.selectedPoliceIds, ...suggestedIds])]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.selectedPoliceIds.length === 0) {
      alert('Selecione pelo menos um policial para a escala.');
      return;
    }

    if (isMonthlyMode && selectedDays.length === 0) {
      alert('Selecione pelo menos um dia do mês.');
      return;
    }

    // Double check constraints for monthly mode
    if (isMonthlyMode) {
      for (const day of selectedDays) {
        for (const pId of formData.selectedPoliceIds) {
          const mKey = format(new Date(formData.date + 'T12:00:00'), 'yyyy-MM');
          const isOrd = (ordinarySchedules[pId] || []).includes(day);
          if (isOrd) {
            const poly = volunteers.find(v => v.policemanId === pId)?.policeman?.nomeGuerra || pId;
            alert(`O policial ${poly} possui serviço ordinário no dia ${day}. Remova-o ou desmarque este dia.`);
            return;
          }
        }
      }
    }

    setSubmitting(true);
    try {
      const batch = (await import('firebase/firestore')).writeBatch(db);
      const baseDate = new Date(formData.date + 'T12:00:00');
      const year = baseDate.getFullYear();
      const month = baseDate.getMonth();

      if (isMonthlyMode) {
        for (const day of selectedDays) {
          const dateToSave = new Date(year, month, day, 12, 0, 0);
          const docRef = doc(collection(db, 'escalas'));
          batch.set(docRef, {
            serviceTypeId: formData.serviceTypeId,
            policemenIds: formData.selectedPoliceIds,
            date: Timestamp.fromDate(dateToSave),
            observations: formData.observations,
            createdAt: serverTimestamp()
          });
        }
      } else {
        const docRef = doc(collection(db, 'escalas'));
        batch.set(docRef, {
          serviceTypeId: formData.serviceTypeId,
          policemenIds: formData.selectedPoliceIds,
          date: Timestamp.fromDate(new Date(formData.date + 'T12:00:00')),
          observations: formData.observations,
          createdAt: serverTimestamp()
        });
      }
      
      await batch.commit();
      setSuccess(true);
      setFormData(prev => ({ ...prev, selectedPoliceIds: [], observations: '' }));
      setSelectedDays([]);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'escalas');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAdmin) return <div className="text-center py-20 text-xs font-black uppercase text-slate-400 italic font-sans">Acesso restrito ao P/1.</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
            <Calendar className="w-7 h-7 text-pmpe-gold" />
            Gestor de Escalas {activeTab}
          </h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sincronização mensal de voluntários e serviços</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-sm">
          <button
            onClick={() => setActiveTab('PJES')}
            className={cn(
              "px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
              activeTab === 'PJES' ? "bg-pmpe-navy text-white shadow-xl" : "text-slate-400 hover:text-slate-600"
            )}
          >
            PJES
          </button>
          <button
            onClick={() => setActiveTab('OPS')}
            className={cn(
              "px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
              activeTab === 'OPS' ? "bg-pmpe-navy text-white shadow-xl" : "text-slate-400 hover:text-slate-600"
            )}
          >
            OPS
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Service & Controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
             <div className="absolute top-0 left-0 w-1 h-full bg-pmpe-gold" />
             <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black text-pmpe-navy uppercase tracking-widest flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-pmpe-gold" /> Serviços {activeTab}
                </h3>
                <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black">{services.length}</span>
             </div>
             
             <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2 scrollbar-thin">
                {loading ? (
                  <div className="py-10 flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-pmpe-navy border-t-transparent rounded-full animate-spin" />
                    <span className="text-[8px] font-bold text-slate-400 uppercase">Sincronizando...</span>
                  </div>
                ) : services.length === 0 ? (
                  <div className="py-10 text-center text-[10px] font-bold text-slate-300 uppercase italic">Nenhum serviço disponível</div>
                ) : (
                  services.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setFormData({...formData, serviceTypeId: s.id, selectedPoliceIds: []})}
                      className={cn(
                        "w-full p-4 rounded-xl border text-left transition-all relative group",
                        formData.serviceTypeId === s.id 
                          ? "border-pmpe-navy bg-pmpe-navy shadow-lg ring-4 ring-pmpe-navy/5" 
                          : "border-slate-100 bg-slate-50/50 hover:border-slate-300 hover:bg-white"
                      )}
                    >
                       <div className="relative z-10">
                          <p className={cn(
                            "text-[8px] font-black uppercase tracking-widest",
                            formData.serviceTypeId === s.id ? "text-pmpe-gold" : "text-pmpe-navy"
                          )}>{s.tipo} • {s.cidade}</p>
                          <p className={cn(
                            "text-[11px] font-black uppercase mt-1 leading-tight",
                            formData.serviceTypeId === s.id ? "text-white" : "text-slate-800"
                          )}>{s.nome}</p>
                       </div>
                       {formData.serviceTypeId === s.id && (
                         <div className="absolute right-4 top-1/2 -translate-y-1/2">
                           <CheckCircle2 className="w-5 h-5 text-pmpe-gold" />
                         </div>
                       )}
                    </button>
                  ))
                )}
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-pmpe-gold" />
                <h3 className="text-[10px] font-black text-pmpe-navy uppercase tracking-widest">Parâmetros de Escala</h3>
             </div>
             
             <div className="space-y-4">
                <div>
                   <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Data ou Mês Base</label>
                   <input 
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({...formData, date: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-pmpe-navy/5 outline-none font-sans"
                   />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                   <div className="flex items-center justify-between mb-3">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-tighter">Publicação em Massa</span>
                      <button 
                        onClick={() => setIsMonthlyMode(!isMonthlyMode)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                          isMonthlyMode ? "bg-pmpe-navy text-white shadow-md" : "bg-white text-slate-400 border border-slate-200"
                        )}
                      >
                         {isMonthlyMode ? 'ATIVO' : 'DESATIVADO'}
                      </button>
                   </div>
                   <p className="text-[8px] font-bold text-slate-400 uppercase leading-relaxed tracking-tight">
                     {isMonthlyMode 
                      ? 'No modo mensal, você pode selecionar múltiplos dias e aplicar a mesma escala simultaneamente.' 
                      : 'No modo avulso, as alterações são aplicadas apenas para a data selecionada acima.'}
                   </p>
                </div>
             </div>
          </div>
        </div>

        {/* Right Column: Calendar and Allocation */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative">
             <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-[10px] font-black text-pmpe-navy uppercase tracking-widest flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-pmpe-gold" /> Mapa de Alocação
                  </h3>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">Selecione os dias no calendário para associar o efetivo</p>
                </div>

                {isMonthlyMode && (
                  <button 
                    onClick={() => {
                      const days = eachDayOfInterval({
                        start: startOfMonth(new Date(formData.date + 'T12:00:00')),
                        end: endOfMonth(new Date(formData.date + 'T12:00:00'))
                      }).map(d => getDate(d));
                      setSelectedDays(selectedDays.length === days.length ? [] : days);
                    }}
                    className="text-[9px] font-black text-white bg-pmpe-navy px-4 py-2 rounded-xl shadow-lg hover:shadow-pmpe-navy/20 transition-all uppercase tracking-widest"
                  >
                    Marcar Todo o Mês
                  </button>
                )}
             </div>

             <div className="grid grid-cols-7 gap-3">
                {['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].map(d => (
                  <div key={d} className="text-center text-[9px] font-black text-slate-300 py-2 border-b border-slate-50">{d}</div>
                ))}
                {Array.from({ length: getDay(startOfMonth(new Date(formData.date + 'T12:00:00'))) }).map((_, i) => (
                  <div key={`pad-${i}`} className="h-16" />
                ))}
                {eachDayOfInterval({
                  start: startOfMonth(new Date(formData.date + 'T12:00:00')),
                  end: endOfMonth(new Date(formData.date + 'T12:00:00'))
                }).map(dayDate => {
                  const day = getDate(dayDate);
                  const isDaySelected = isMonthlyMode 
                    ? selectedDays.includes(day) 
                    : isSameDay(new Date(formData.date + 'T12:00:00'), dayDate);
                  
                  const hasScale = existingScales.some(esc => isSameDay(esc.date.toDate(), dayDate));

                  return (
                    <button
                      key={day}
                      onClick={() => {
                        if (isMonthlyMode) toggleDay(day);
                        else setFormData({...formData, date: format(dayDate, 'yyyy-MM-dd')});
                      }}
                      className={cn(
                        "h-16 rounded-xl border flex flex-col items-center justify-center transition-all relative group",
                        isDaySelected 
                          ? "bg-pmpe-navy border-pmpe-navy mb-1 shadow-lg z-10 scale-[1.05]" 
                          : "bg-white border-slate-100 hover:border-slate-300 shadow-sm"
                      )}
                    >
                      <span className={cn("text-xs font-black", isDaySelected ? "text-white" : "text-slate-800")}>{day}</span>
                      {hasScale && (
                        <div className="flex gap-0.5 mt-1">
                          <div className={cn("w-1 h-1 rounded-full", isDaySelected ? "bg-pmpe-gold" : "bg-red-400")} />
                        </div>
                      )}
                    </button>
                  );
                })}
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
                <div>
                   <h3 className="text-[10px] font-black text-pmpe-navy uppercase tracking-widest flex items-center gap-2">
                     <Users className="w-4 h-4 text-pmpe-gold" /> Voluntários Candidatos
                   </h3>
                   <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">Selecione quem será associado à(s) data(s) acima</p>
                </div>
                
                <div className="flex gap-2 w-full sm:w-auto">
                   <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input 
                        type="text"
                        placeholder="Nome ou Matrícula..."
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none font-sans"
                      />
                   </div>
                   <button 
                    onClick={smartSuggest}
                    className="px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all font-sans"
                   >
                     Sugestão
                   </button>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {volunteers
                  .filter(v => !searchTerm || v.policeman?.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) || v.policeman?.matricula.includes(searchTerm))
                  .map(v => {
                    const conflicts = getDayConflicts(v.policemanId, formData.date);
                    const isSelected = formData.selectedPoliceIds.includes(v.policemanId);
                    const isBlocked = conflicts.isOrdinary || conflicts.quotaReached;

                    return (
                      <button
                        key={v.id}
                        disabled={isBlocked && !isSelected}
                        onClick={() => togglePolice(v.policemanId)}
                        className={cn(
                          "p-3 rounded-xl border text-left flex flex-col justify-between h-32 transition-all relative overflow-hidden group",
                          isSelected 
                            ? "bg-pmpe-navy border-pmpe-navy shadow-inner" 
                            : isBlocked 
                              ? "bg-red-50 border-red-100 opacity-60 cursor-not-allowed" 
                              : "bg-white border-slate-50 hover:border-slate-200"
                        )}
                      >
                         <div className="flex justify-between items-start">
                            <div className={cn(
                              "w-4 h-4 rounded-full border flex items-center justify-center shrink-0",
                              isSelected ? "bg-white border-white" : "border-slate-200 bg-white"
                            )}>
                              {isSelected && <CheckCircle2 className="w-3 h-3 text-pmpe-navy" />}
                              {isBlocked && !isSelected && <AlertCircle className="w-3 h-3 text-red-500" />}
                            </div>
                            <div className="flex flex-col items-end">
                               <div className={cn(
                                 "text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter",
                                 isSelected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                               )}>
                                 Cotas: {conflicts.totalExtrasInMonth}/{v.cotas}
                               </div>
                               {v.policeman?.isMotorista && <Car className={cn("w-3.5 h-3.5 mt-1", isSelected ? "text-pmpe-gold" : "text-purple-400")} />}
                            </div>
                         </div>

                         <div>
                            <p className={cn("text-[9px] font-black uppercase tracking-tight truncate", isSelected ? "text-white/70" : "text-slate-400")}>
                               {v.policeman?.graduacaoPosto}
                            </p>
                            <p className={cn("text-[11px] font-black uppercase truncate", isSelected ? "text-white" : "text-slate-800")}>
                               {v.policeman?.nomeGuerra}
                            </p>
                         </div>

                         {isBlocked && !isSelected && (
                           <div className="absolute inset-0 bg-red-100/10 flex items-center justify-center p-2">
                             <div className="bg-red-600 text-white text-[7px] font-black uppercase tracking-widest px-2 py-0.5 rounded shadow-lg transform -rotate-12">
                               {conflicts.isOrdinary ? 'IMPEDIDO: ORDINÁRIA' : 'LIMITE DE COTAS'}
                             </div>
                           </div>
                         )}

                         {isSelected && (
                           <div className="absolute -top-1 -right-1 p-2 bg-pmpe-gold/20 rounded-bl-lg">
                              <Crown className="w-3.5 h-3.5 text-pmpe-gold" />
                           </div>
                         )}
                      </button>
                    );
                  })}
             </div>

             <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex-1 w-full">
                   <label className="block text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                     <span className="w-1.5 h-1.5 bg-pmpe-gold rounded-full" /> Observações da Escala
                   </label>
                   <input
                      type="text"
                      placeholder="Ex: Ponto de encontro, fardamento, etc..."
                      value={formData.observations}
                      onChange={(e) => setFormData({...formData, observations: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-pmpe-navy/5 font-sans"
                   />
                </div>

                <div className="flex items-center gap-4 shrink-0">
                   <div className="text-right">
                      <p className="text-[10px] font-black text-pmpe-navy uppercase tracking-tighter leading-none mb-1">Total de Escalados</p>
                      <p className="text-xl font-black text-slate-800 uppercase tracking-tighter leading-none">
                        {formData.selectedPoliceIds.length} <span className="text-[10px] text-slate-400">Pms</span>
                      </p>
                   </div>
                   <button 
                      onClick={handleSubmit}
                      disabled={submitting || !formData.serviceTypeId || formData.selectedPoliceIds.length === 0 || (isMonthlyMode && selectedDays.length === 0)}
                      className={cn(
                        "px-10 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest text-white transition-all transform hover:scale-[1.02] shadow-2xl flex items-center gap-3 font-sans",
                        submitting || !formData.serviceTypeId || formData.selectedPoliceIds.length === 0 
                          ? "bg-slate-300 shadow-none cursor-not-allowed" 
                          : "bg-pmpe-navy hover:shadow-pmpe-navy/20"
                      )}
                   >
                     {submitting ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                     ) : (
                        <Save className="w-4 h-4 text-pmpe-gold" />
                     )}
                     <span>{isMonthlyMode ? `Publicar Ciclo (${selectedDays.length} Dias)` : 'Publicar Escala'}</span>
                   </button>
                </div>
             </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-4 border border-emerald-500/20"
          >
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-tighter">Escalas Criadas!</p>
              <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest leading-none">O boletim diário foi atualizado com as novas escalas.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};


export default CreateEscala;
