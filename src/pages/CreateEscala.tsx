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
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDate, isSameDay } from 'date-fns';

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
        const vQ = query(collection(db, 'volunteers'), where('type', '==', selectedService.tipo));
        const vSnap = await getDocs(vQ);
        
        // Fetch existing scales for this service to highlight occupied days in calendar
        const eQ = query(collection(db, 'escalas'), where('serviceTypeId', '==', formData.serviceTypeId));
        const eSnap = await getDocs(eQ);
        setExistingScales(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as Escala)));

        // Fetch ALL scales of the month for all services to check for concurrency
        const monthStart = Timestamp.fromDate(startOfMonth(dateObj));
        const monthEnd = Timestamp.fromDate(endOfMonth(dateObj));
        const allMQS = await getDocs(query(
          collection(db, 'escalas'), 
          where('date', '>=', monthStart),
          where('date', '<=', monthEnd)
        ));
        setAllEscalasOfMonth(allMQS.docs.map(d => ({ id: d.id, ...d.data() } as Escala)));

        // Fetch Ordinary Schedules for the month
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

        // Hierarchy sorting
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

    // Sort by fewer extras in month (fair distribution)
    availableVolunteers.sort((a, b) => {
      const cA = getDayConflicts(a.policemanId, formData.date).totalExtrasInMonth;
      const cB = getDayConflicts(b.policemanId, formData.date).totalExtrasInMonth;
      return cA - cB;
    });

    // Pick top 4 suggestions
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

    setSubmitting(true);
    try {
      if (isMonthlyMode) {
        const baseDate = new Date(formData.date + 'T12:00:00');
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth();

        const { writeBatch } = await import('firebase/firestore');
        const batch = writeBatch(db);

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
        await batch.commit();
      } else {
        await addDoc(collection(db, 'escalas'), {
          serviceTypeId: formData.serviceTypeId,
          policemenIds: formData.selectedPoliceIds,
          date: Timestamp.fromDate(new Date(formData.date + 'T12:00:00')),
          observations: formData.observations,
          createdAt: serverTimestamp()
        });
      }
      
      setSuccess(true);
      setFormData({
        serviceTypeId: '',
        selectedPoliceIds: [],
        date: format(new Date(), 'yyyy-MM-dd'),
        observations: ''
      });
      setSelectedDays([]);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'escalas');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAdmin) return <div className="text-center py-20 text-xs font-black uppercase text-slate-400 italic">Acesso restrito ao P/1.</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Criar Nova Escala</h2>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Geração de escala operacional extra</p>
      </div>

      <AnimatePresence>
        {success && (
          <motion.div
             initial={{ opacity: 0, y: -10 }}
             animate={{ opacity: 1, y: 0 }}
             exit={{ opacity: 0, y: -10 }}
             className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg flex items-center gap-3 text-emerald-700"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-[11px] font-black uppercase tracking-tight">Escala gerada com sucesso!</span>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <Briefcase className="w-3 h-3" /> Tipo de Serviço
              </label>
              <select
                required
                value={formData.serviceTypeId}
                onChange={(e) => setFormData({...formData, serviceTypeId: e.target.value, selectedPoliceIds: []})}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all appearance-none"
              >
                <option value="">Selecione o serviço...</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.tipo} - {s.nome} ({s.cidade})</option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> {isMonthlyMode ? 'Mês Referência' : 'Data da Escala'}
                </label>
                <button
                  type="button"
                  onClick={() => setIsMonthlyMode(!isMonthlyMode)}
                  className={cn(
                    "text-[9px] font-black uppercase px-2 py-0.5 rounded border transition-all",
                    isMonthlyMode ? "bg-pmpe-navy text-white border-pmpe-navy" : "bg-slate-50 text-slate-400 border-slate-200"
                  )}
                >
                  {isMonthlyMode ? 'Modo Mensal Ativo' : 'Ativar Modo Mensal'}
                </button>
              </div>
              <input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
              />
            </div>
          </div>

          <AnimatePresence>
            {isMonthlyMode && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden border-t border-slate-100 pt-4"
              >
                <div className="flex justify-between items-center mb-3">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    Selecionar Dias do Mês
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedDays.length === eachDayOfInterval({
                        start: startOfMonth(new Date(formData.date + 'T12:00:00')),
                        end: endOfMonth(new Date(formData.date + 'T12:00:00'))
                      }).length) {
                        setSelectedDays([]);
                      } else {
                        const days = eachDayOfInterval({
                          start: startOfMonth(new Date(formData.date + 'T12:00:00')),
                          end: endOfMonth(new Date(formData.date + 'T12:00:00'))
                        }).map(d => getDate(d));
                        setSelectedDays(days);
                      }
                    }}
                    className="text-[9px] font-black underline uppercase tracking-widest text-pmpe-navy hover:text-slate-800 transition-all"
                  >
                    {selectedDays.length === eachDayOfInterval({
                      start: startOfMonth(new Date(formData.date + 'T12:00:00')),
                      end: endOfMonth(new Date(formData.date + 'T12:00:00'))
                    }).length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                  </button>
                </div>
                <div className="grid grid-cols-7 sm:grid-cols-10 gap-1.5">
                  {eachDayOfInterval({
                    start: startOfMonth(new Date(formData.date + 'T12:00:00')),
                    end: endOfMonth(new Date(formData.date + 'T12:00:00'))
                  }).map(dayDate => {
                    const day = getDate(dayDate);
                    const hasScale = existingScales.some(esc => isSameDay(esc.date.toDate(), dayDate));
                    const isSelected = selectedDays.includes(day);

                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={cn(
                          "h-10 flex flex-col items-center justify-center rounded border transition-all relative",
                          isSelected
                            ? "bg-pmpe-navy text-white border-pmpe-navy shadow-md z-10 scale-105"
                            : "bg-white text-slate-600 border-slate-200 hover:border-pmpe-navy/30 shadow-xs"
                        )}
                      >
                        <span className="text-[10px] font-black">{day}</span>
                        {hasScale && (
                          <span className={cn(
                            "w-1 h-1 rounded-full absolute bottom-1",
                            isSelected ? "bg-pmpe-gold" : "bg-red-400 animate-pulse"
                          )} />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-4 mt-2">
                  {selectedDays.length > 0 && (
                    <p className="text-[9px] font-bold text-pmpe-navy uppercase tracking-tight">
                      {selectedDays.length} {selectedDays.length === 1 ? 'dia selecionado' : 'dias selecionados'} para criação.
                    </p>
                  )}
                  {existingScales.length > 0 && (
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Escala já existente
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3">
             <div className="flex justify-between items-end">
               <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                 <Users className="w-3 h-3" /> Efetivo Voluntário
               </label>
               {formData.selectedPoliceIds.length > 0 && (
                 <span className="text-[9px] font-black text-pmpe-navy bg-slate-100 px-2 py-0.5 rounded border border-slate-200 uppercase">
                    {formData.selectedPoliceIds.length} selecionados
                 </span>
               )}
             </div>
             
             {formData.serviceTypeId && (
               <div className="flex flex-col sm:flex-row gap-3 mb-3">
                 <div className="relative flex-1">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                   <input 
                     type="text"
                     placeholder="Buscar por nome ou matrícula..."
                     value={searchTerm}
                     onChange={(e) => setSearchTerm(e.target.value)}
                     className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-pmpe-navy outline-none"
                   />
                 </div>
                 <div className="flex gap-2">
                   <button
                     type="button"
                     onClick={smartSuggest}
                     className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all border bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                   >
                     <CheckCircle2 className="w-3.5 h-3.5" />
                     Sugerir Efetivo
                   </button>
                   <button
                     type="button"
                     onClick={() => setShowOnlyDrivers(!showOnlyDrivers)}
                     className={cn(
                       "flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all border",
                       showOnlyDrivers 
                         ? "bg-purple-100 border-purple-200 text-purple-700 shadow-sm" 
                         : "bg-white border-slate-200 text-slate-400 hover:text-slate-600"
                     )}
                   >
                     <Car className="w-3.5 h-3.5" />
                     {showOnlyDrivers ? 'Apenas Motoristas' : 'Motoristas'}
                   </button>
                 </div>
               </div>
             )}
             
             {!formData.serviceTypeId ? (
               <div className="p-10 border border-slate-100 rounded-xl text-center text-slate-400 italic text-[11px] font-bold uppercase tracking-tight bg-slate-50/50">
                 Selecione um tipo de serviço para listar voluntários.
               </div>
             ) : volunteers.length === 0 ? (
               <div className="p-8 border border-red-100 rounded-xl text-center text-red-500 bg-red-50/30 text-[11px] font-black uppercase tracking-tight flex flex-col items-center gap-2">
                 <AlertCircle className="w-5 h-5" />
                 Sem voluntários para {services.find(s => s.id === formData.serviceTypeId)?.tipo}
               </div>
             ) : (
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                 {volunteers
                   .filter(v => {
                     const mS = !searchTerm || v.policeman?.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) || (v.policeman?.matricula || '').includes(searchTerm);
                     const mD = !showOnlyDrivers || v.policeman?.isMotorista;
                     return mS && mD;
                   })
                   .map(v => {
                     const conflicts = getDayConflicts(v.policemanId, formData.date);
                     const isSelected = formData.selectedPoliceIds.includes(v.policemanId);
                     
                     return (
                       <div 
                          key={v.id} 
                          onClick={() => togglePolice(v.policemanId)}
                          className={cn(
                            "p-2.5 rounded-lg border transition-all cursor-pointer flex items-center gap-2.5 active:scale-[0.98] relative",
                            isSelected 
                              ? "border-pmpe-navy bg-pmpe-navy/5 shadow-inner" 
                              : "border-slate-100 bg-white hover:border-slate-300",
                            (conflicts.isOrdinary || conflicts.hasExtra) && !isSelected && "opacity-60 bg-slate-50 grayscale"
                          )}
                        >
                          <div className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                            isSelected ? "bg-pmpe-navy border-pmpe-navy" : "border-slate-300 bg-white"
                          )}>
                            {isSelected && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                             <div className="flex items-center gap-1.5 leading-none mb-0.5">
                                <p className="text-[12px] font-black text-slate-800 truncate">{v.policeman?.nomeGuerra}</p>
                                {volunteers.indexOf(v) === 0 && <span title="Possível Comandante"><Crown className="w-2.5 h-2.5 text-amber-500" /></span>}
                                {v.policeman?.isMotorista && <span title="Motorista do Quadro"><Car className="w-2.5 h-2.5 text-purple-500" /></span>}
                             </div>
                             <div className="flex items-center gap-2">
                               <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">{v.policeman?.graduacaoPosto}</p>
                               {conflicts.isOrdinary && (
                                 <span className="text-[7px] font-black bg-red-100 text-red-600 px-1 py-0.5 rounded uppercase leading-none">ORDINÁRIA</span>
                               )}
                               {conflicts.hasExtra && (
                                 <span className="text-[7px] font-black bg-blue-100 text-blue-600 px-1 py-0.5 rounded uppercase leading-none">EXTRA</span>
                               )}
                             </div>
                          </div>
                          {conflicts.totalExtrasInMonth > 0 && (
                            <div className="absolute top-1 right-1 text-[7px] font-black text-slate-300">
                              {conflicts.totalExtrasInMonth}x
                            </div>
                          )}
                       </div>
                     );
                   })}
               </div>
             )}
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">Observações Operacionais</label>
            <textarea
              rows={2}
              value={formData.observations}
              onChange={(e) => setFormData({...formData, observations: e.target.value})}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all resize-none"
              placeholder="Ex: Ponto de encontro, fardamento, armamento..."
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting || !formData.serviceTypeId || formData.selectedPoliceIds.length === 0}
            className={cn(
              "px-8 py-3 rounded-lg text-xs font-black uppercase tracking-widest text-white transition-all transform hover:translate-y-[-1px] active:translate-y-0 flex items-center gap-2 shadow-md",
              submitting ? "bg-slate-300 animate-pulse" : "bg-pmpe-navy hover:bg-slate-800"
            )}
          >
            {submitting ? (
              <>Processando...</>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>{isMonthlyMode && selectedDays.length > 0 ? `Publicar ${selectedDays.length} Escalas` : 'Salvar e Publicar Escala'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateEscala;
