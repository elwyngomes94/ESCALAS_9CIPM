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
      try {
        const sSnap = await getDocs(query(collection(db, 'serviceTypes'), orderBy('nome')));
        setServices(sSnap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceType)));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchBaseData();
  }, []);

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

    return {
      isOrdinary,
      hasExtra: extraScalesOnDay.length > 0,
      totalExtrasInMonth: allEscalasOfMonth.filter(esc => esc.policemenIds.includes(policemanId)).length
    };
  };

  const smartSuggest = () => {
    if (!formData.serviceTypeId) return;
    
    const availableVolunteers = volunteers.filter(v => {
      const conflicts = getDayConflicts(v.policemanId, formData.date);
      return !conflicts.isOrdinary && !conflicts.hasExtra;
    });

    availableVolunteers.sort((a, b) => {
      const cA = getDayConflicts(a.policemanId, formData.date).totalExtrasInMonth;
      const cB = getDayConflicts(b.policemanId, formData.date).totalExtrasInMonth;
      return cA - cB;
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
            <Plus className="w-6 h-6 text-pmpe-gold" />
            Criar Nova Escala
          </h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão de alocação de efetivo voluntário</p>
        </div>
        
        <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          <button 
            type="button"
            onClick={() => setIsMonthlyMode(false)}
            className={cn(
              "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              !isMonthlyMode ? "bg-pmpe-navy text-white shadow-md" : "text-slate-400 hover:text-slate-600"
            )}
          >
            Escala Avulsa
          </button>
          <button 
            type="button"
            onClick={() => setIsMonthlyMode(true)}
            className={cn(
              "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              isMonthlyMode ? "bg-pmpe-navy text-white shadow-md" : "text-slate-400 hover:text-slate-600"
            )}
          >
            Escala Mensal
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Service Selection & Steps */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <label className="block text-[10px] font-black text-pmpe-navy uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-pmpe-navy text-white rounded-full flex items-center justify-center text-[8px]">1</span>
              Tipo de Serviço
            </label>
            
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
              {services.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="w-8 h-8 border-2 border-pmpe-navy border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Carregando serviços...</p>
                </div>
              ) : (
                services.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setFormData({...formData, serviceTypeId: s.id, selectedPoliceIds: []})}
                    className={cn(
                      "w-full p-4 rounded-xl border text-left transition-all group relative overflow-hidden",
                      formData.serviceTypeId === s.id 
                        ? "border-pmpe-navy bg-pmpe-navy shadow-lg" 
                        : "border-slate-100 bg-slate-50/50 hover:border-slate-300 hover:bg-white"
                    )}
                  >
                    <div className="relative z-10">
                      <p className={cn(
                        "text-[10px] font-black uppercase tracking-tight",
                        formData.serviceTypeId === s.id ? "text-pmpe-gold" : "text-pmpe-navy"
                      )}>{s.tipo} {s.cidade}</p>
                      <p className={cn(
                        "text-[12px] font-black uppercase mt-0.5",
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
            <label className="block text-[10px] font-black text-pmpe-navy uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-pmpe-navy text-white rounded-full flex items-center justify-center text-[8px]">2</span>
              Configurações
            </label>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Mês / Data Base</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({...formData, date: e.target.value})}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-pmpe-navy outline-none font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Observações</label>
                <textarea
                  rows={3}
                  value={formData.observations}
                  onChange={(e) => setFormData({...formData, observations: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:ring-1 focus:ring-pmpe-navy outline-none resize-none"
                  placeholder="Instruções para o serviço..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Center: Calendar & Date Selection */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-h-[400px]">
            <div className="flex justify-between items-center mb-6">
              <label className="block text-[10px] font-black text-pmpe-navy uppercase tracking-widest flex items-center gap-2">
                <span className="w-5 h-5 bg-pmpe-navy text-white rounded-full flex items-center justify-center text-[8px]">3</span>
                {isMonthlyMode ? 'Programação Mensal' : 'Alocação de Efetivo'}
              </label>

              {isMonthlyMode && (
                <button
                  type="button"
                  onClick={() => {
                    const days = eachDayOfInterval({
                      start: startOfMonth(new Date(formData.date + 'T12:00:00')),
                      end: endOfMonth(new Date(formData.date + 'T12:00:00'))
                    }).map(d => getDate(d));
                    setSelectedDays(selectedDays.length === days.length ? [] : days);
                  }}
                  className="text-[9px] font-black uppercase tracking-widest text-pmpe-navy hover:underline"
                >
                  {selectedDays.length > 0 ? 'Limpar Calendário' : 'Selecionar Todo o Mês'}
                </button>
              )}
            </div>

            {isMonthlyMode ? (
              <div className="grid grid-cols-7 gap-2">
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
                  const isSelected = selectedDays.includes(day);
                  const hasScale = existingScales.some(esc => isSameDay(esc.date.toDate(), dayDate));

                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={cn(
                        "h-16 flex flex-col items-center justify-center rounded-xl border transition-all relative group",
                        isSelected
                          ? "bg-pmpe-navy text-white border-pmpe-navy shadow-lg scale-[1.02] z-10"
                          : "bg-white text-slate-600 border-slate-100 hover:border-slate-300"
                      )}
                    >
                      <span className="text-xs font-black">{day}</span>
                      {hasScale && (
                        <div className={cn(
                          "absolute top-2 right-2 w-1.5 h-1.5 rounded-full",
                          isSelected ? "bg-pmpe-gold" : "bg-red-400"
                        )} />
                      )}
                      <div className="absolute bottom-2 inset-x-0 flex justify-center gap-0.5">
                        {/* Status preview could go here */}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-6">
                {formData.serviceTypeId ? (
                  <>
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Pesquisar por nome ou matrícula..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-pmpe-navy/5 outline-none font-bold"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => smartSuggest()}
                          className="px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl text-[10px] font-black uppercase tracking-tight flex items-center gap-2 hover:bg-emerald-100 transition-all font-sans"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Sugerir
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowOnlyDrivers(!showOnlyDrivers)}
                          className={cn(
                            "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-tight flex items-center gap-2 border transition-all font-sans",
                            showOnlyDrivers ? "bg-purple-50 border-purple-200 text-purple-600" : "bg-white border-slate-200 text-slate-400"
                          )}
                        >
                          <Car className="w-4 h-4" /> Motoristas
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {volunteers
                        .filter(v => {
                          const mS = !searchTerm || v.policeman?.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) || (v.policeman?.matricula || '').includes(searchTerm);
                          const mD = !showOnlyDrivers || v.policeman?.isMotorista;
                          return mS && mD;
                        })
                        .map(v => {
                          const conflicts = getDayConflicts(v.policemanId, formData.date);
                          const isSelected = formData.selectedPoliceIds.includes(v.policemanId);
                          const isBlocked = conflicts.isOrdinary;
                          
                          return (
                            <button
                               key={v.id}
                               type="button"
                               onClick={() => togglePolice(v.policemanId)}
                               className={cn(
                                 "p-3 rounded-xl border text-left transition-all h-full flex flex-col justify-between group relative overflow-hidden",
                                 isSelected 
                                    ? "bg-pmpe-navy border-pmpe-navy shadow-inner" 
                                    : isBlocked 
                                        ? "bg-red-50 border-red-100 cursor-not-allowed opacity-75"
                                        : "bg-white border-slate-100 hover:border-slate-300"
                               )}
                             >
                               <div className="flex items-start justify-between mb-2">
                                  <div className={cn(
                                    "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
                                    isSelected ? "bg-white border-white" : "border-slate-300"
                                  )}>
                                    {isSelected && <CheckCircle2 className="w-3 h-3 text-pmpe-navy" />}
                                    {isBlocked && <AlertCircle className="w-3 h-3 text-red-500" />}
                                  </div>
                                  <div className="flex gap-1">
                                    {v.policeman?.isMotorista && <Car className={cn("w-3 h-3", isSelected ? "text-white/60" : "text-purple-400")} />}
                                  </div>
                               </div>

                               <div>
                                 <p className={cn(
                                   "text-[10px] font-black uppercase tracking-tight truncate",
                                   isSelected ? "text-white/70" : "text-slate-400"
                                 )}>{v.policeman?.graduacaoPosto}</p>
                                 <p className={cn(
                                   "text-[12px] font-black uppercase truncate",
                                   isSelected ? "text-white" : "text-slate-800"
                                 )}>{v.policeman?.nomeGuerra}</p>
                               </div>

                               {isBlocked && (
                                 <div className="mt-2 py-1 px-2 bg-red-600/10 rounded flex items-center gap-1.5 border border-red-600/20">
                                   <X className="w-2.5 h-2.5 text-red-600" />
                                   <span className="text-[8px] font-black uppercase text-red-600 tracking-tighter">IMPEDIDO: ORDINÁRIA</span>
                                 </div>
                               )}

                               {isSelected && (
                                 <div className="absolute -top-1 -right-1 p-2 bg-pmpe-gold/20 rounded-bl-xl">
                                   <Crown className="w-3 h-3 text-pmpe-gold" />
                                 </div>
                               )}
                            </button>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                    <Users className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-[12px] font-black uppercase tracking-widest italic">Aguardando seleção de serviço...</p>
                  </div>
                )}
              </div>
            )}

            {isMonthlyMode && formData.selectedPoliceIds.length > 0 && (
              <div className="mt-8 p-6 bg-slate-50 border border-slate-100 rounded-2xl">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-pmpe-navy text-white rounded-xl shadow-lg">
                    <Users className="w-5 h-5 text-pmpe-gold" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-pmpe-navy uppercase tracking-widest leading-none mb-1">Efetivo da Programação</p>
                    <p className="text-xl font-black text-slate-800 uppercase tracking-tighter">
                      {formData.selectedPoliceIds.length} <span className="text-sm">Policias Selecionados</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {volunteers
                    .filter(v => formData.selectedPoliceIds.includes(v.policemanId))
                    .map(v => (
                       <div key={v.id} className="bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2 group">
                          <span className="text-[9px] font-black text-slate-800 uppercase">{v.policeman?.graduacaoPosto} {v.policeman?.nomeGuerra}</span>
                          <button 
                            type="button"
                            onClick={() => togglePolice(v.policemanId)}
                            className="p-0.5 text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                       </div>
                    ))}
                </div>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
               <div className="space-y-1">
                  {isMonthlyMode && selectedDays.length > 0 && (
                    <p className="text-[10px] font-black text-pmpe-navy uppercase tracking-tight flex items-center gap-2">
                      <div className="w-2 h-2 bg-pmpe-gold rounded-full" /> {selectedDays.length} dias para publicação simultânea
                    </p>
                  )}
                  {formData.selectedPoliceIds.length > 0 && (
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-tight flex items-center gap-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full" /> {formData.selectedPoliceIds.length} policiais prontos
                    </p>
                  )}
               </div>

               <button
                  type="submit"
                  disabled={submitting || !formData.serviceTypeId || formData.selectedPoliceIds.length === 0 || (isMonthlyMode && selectedDays.length === 0)}
                  className={cn(
                    "px-10 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest text-white transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-3 shadow-xl",
                    submitting || !formData.serviceTypeId || formData.selectedPoliceIds.length === 0 ? "bg-slate-300" : "bg-pmpe-navy hover:shadow-pmpe-navy/20"
                  )}
                >
                  {submitting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 text-pmpe-gold" />
                  )}
                  <span>{isMonthlyMode ? 'Publicar Ciclo Mensal' : 'Publicar Escala Extra'}</span>
                </button>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-4"
          >
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-tighter">Escala Publicada!</p>
              <p className="text-[10px] font-bold text-white/80 uppercase tracking-widest">Os policiais já podem visualizar no painel.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};


export default CreateEscala;
