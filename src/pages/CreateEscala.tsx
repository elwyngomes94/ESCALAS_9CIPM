import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc,
  query, 
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Policeman, ServiceType, Volunteer, Escala, QuotaSettings, QuotaLog, OrdinarySchedule } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { 
  X, 
  Search, 
  Users,
  AlertCircle,
  Clock,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Download,
  ShieldCheck,
  CheckCircle2,
  Info,
  ArrowRight,
  Check,
  Zap,
  Filter,
  Shield,
  CalendarDays,
  Target,
  BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  getDate, 
  isSameDay, 
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  isWeekend,
  isToday,
  parseISO
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Brazilian Holidays 2026 (Simplified for this year)
const HOLIDAYS_2026: Record<string, string> = {
  '2026-01-01': 'Confraternização Universal',
  '2026-02-16': 'Carnaval',
  '2026-02-17': 'Carnaval',
  '2026-02-18': 'Quarta-feira de Cinzas',
  '2026-04-03': 'Sexta-feira Santa',
  '2026-04-05': 'Páscoa',
  '2026-04-21': 'Tiradentes',
  '2026-05-01': 'Dia do Trabalho',
  '2026-06-04': 'Corpus Christi',
  '2026-09-07': 'Independência do Brasil',
  '2026-10-12': 'Nossa Sra. Aparecida',
  '2026-11-02': 'Finados',
  '2026-11-15': 'Proclamação da República',
  '2026-11-20': 'Dia da Consciência Negra',
  '2026-12-25': 'Natal',
};

const CreateEscala = () => {
  const { isAdmin } = useAuth();
  const [services, setServices] = useState<ServiceType[]>([]);
  const [volunteers, setVolunteers] = useState<(Volunteer & { policeman?: Policeman })[]>([]);
  const [allEscalasOfMonth, setAllEscalasOfMonth] = useState<(Escala & { service?: ServiceType })[]>([]);
  const [ordinarySchedules, setOrdinarySchedules] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPMId, setSelectedPMId] = useState<string | null>(null);

  const [assignmentModal, setAssignmentModal] = useState<{
    policemanId: string;
    date: Date;
  } | null>(null);

  const [unitQuotas, setUnitQuotas] = useState<QuotaSettings | null>(null);
  const [currentUsage, setCurrentUsage] = useState({
    PJES_MP: 0,
    PJES_FORUM: 0,
    PJES_ESCOLAR: 0,
    PJES_DECRETO: 0,
    OPS: 0
  });

  const mKey = format(currentMonth, 'yyyy-MM');

  const fetchData = async () => {
    setLoading(true);
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    try {
      const [sSnap, vSnap, polySnap, eSnap, ordSnap, settingsSnap, logsSnap] = await Promise.all([
        getDocs(query(collection(db, 'serviceTypes'))),
        getDocs(query(collection(db, 'volunteers'), where('month', '==', mKey))),
        getDocs(collection(db, 'policemen')),
        getDocs(query(
          collection(db, 'escalas'), 
          where('date', '>=', Timestamp.fromDate(start)),
          where('date', '<=', Timestamp.fromDate(end))
        )),
        getDocs(query(collection(db, 'ordinarySchedules'), where('month', '==', mKey))),
        getDocs(query(collection(db, 'quotaSettings'), where('month', '==', mKey))),
        getDocs(query(collection(db, 'quotaLogs'), where('month', '==', mKey)))
      ]);

      const sData = sSnap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(),
        cotasPorServico: d.data().cotasPorServico ?? 1
      } as ServiceType));
      setServices(sData);

      const polyData = polySnap.docs.reduce((acc, d) => {
        acc[d.id] = { id: d.id, ...d.data() } as Policeman;
        return acc;
      }, {} as Record<string, Policeman>);

      const vData = vSnap.docs.map(vDoc => {
        const v = { id: vDoc.id, ...vDoc.data() } as Volunteer;
        return { ...v, policeman: polyData[v.policemanId] };
      });
      setVolunteers(vData);

      const eData = eSnap.docs.map(d => {
        const data = d.data() as Escala;
        return { 
          id: d.id, 
          ...data,
          service: sData.find(s => s.id === data.serviceTypeId)
        };
      });
      setAllEscalasOfMonth(eData);

      const oMap: Record<string, number[]> = {};
      ordSnap.docs.forEach(d => {
        const data = d.data() as OrdinarySchedule;
        oMap[data.policemanId] = data.days || [];
      });
      setOrdinarySchedules(oMap);

      let qSettings: QuotaSettings = { month: mKey, pjesMPTotal: 0, pjesForumTotal: 0, pjesEscolarTotal: 0, pjesDecretoTotal: 0, opsTotal: 0 };
      if (!settingsSnap.empty) {
        qSettings = { id: settingsSnap.docs[0].id, ...settingsSnap.docs[0].data() } as QuotaSettings;
      }
      setUnitQuotas(qSettings);

      let usage = { PJES_MP: 0, PJES_FORUM: 0, PJES_ESCOLAR: 0, PJES_DECRETO: 0, OPS: 0 };
      logsSnap.docs.forEach(d => {
        const log = d.data() as QuotaLog;
        if (log.tipo === 'OPS') usage.OPS += log.quantidade;
        else if (log.tipo === 'PJES') {
          if (log.pjesSubtype === 'MP') usage.PJES_MP += log.quantidade;
          else if (log.pjesSubtype === 'FORUM') usage.PJES_FORUM += log.quantidade;
          else if (log.pjesSubtype === 'ESCOLAR') usage.PJES_ESCOLAR += log.quantidade;
          else if (log.pjesSubtype === 'DECRETO') usage.PJES_DECRETO += log.quantidade;
        }
      });
      setCurrentUsage(usage);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentMonth]);

  const selectedVolunteer = useMemo(() => 
    volunteers.find(v => v.policemanId === selectedPMId),
  [volunteers, selectedPMId]);

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const handleAssignService = async (serviceId: string) => {
    if (!assignmentModal || !isAdmin || !selectedVolunteer) return;
    const { date } = assignmentModal;
    const policemanId = selectedVolunteer.policemanId;
    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    const dateStr = format(date, 'yyyy-MM-dd');
    const existingEscala = allEscalasOfMonth.find(e => 
      e.serviceTypeId === serviceId && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr
    );

    const isFirstPM = !existingEscala;
    const needed = isFirstPM ? (service.cotasPorServico || 1) : 0;
    
    if (isFirstPM) {
      const type = service.tipo as 'PJES' | 'OPS';
      let limit = 0;
      let used = 0;

      if (type === 'OPS') { limit = unitQuotas?.opsTotal || 0; used = currentUsage.OPS; }
      else {
        const subtype = service.pjesSubtype;
        if (subtype === 'MP') { limit = unitQuotas?.pjesMPTotal || 0; used = currentUsage.PJES_MP; }
        else if (subtype === 'FORUM') { limit = unitQuotas?.pjesForumTotal || 0; used = currentUsage.PJES_FORUM; }
        else if (subtype === 'ESCOLAR') { limit = unitQuotas?.pjesEscolarTotal || 0; used = currentUsage.PJES_ESCOLAR; }
        else if (subtype === 'DECRETO') { limit = unitQuotas?.pjesDecretoTotal || 0; used = currentUsage.PJES_DECRETO; }
      }

      if (used + needed > limit) {
        alert(`Erro: Cota insuficiente para ${service.sigla}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (existingEscala) {
        await updateDoc(doc(db, 'escalas', existingEscala.id!), {
          policemenIds: [...new Set([...existingEscala.policemenIds, policemanId])],
          updatedAt: serverTimestamp()
        });
      } else {
        const docRef = await addDoc(collection(db, 'escalas'), {
          serviceTypeId: serviceId,
          policemenIds: [policemanId],
          date: Timestamp.fromDate(date),
          observations: '',
          createdAt: serverTimestamp()
        });
        
        await addDoc(collection(db, 'quotaLogs'), {
          serviceTypeId: serviceId,
          serviceName: service.nome,
          escalaId: docRef.id,
          tipo: service.tipo,
          pjesSubtype: service.pjesSubtype,
          quantidade: needed,
          usuarioUid: auth.currentUser?.uid,
          usuarioEmail: auth.currentUser?.email,
          data: serverTimestamp(),
          month: format(date, 'yyyy-MM')
        });
      }

      setAssignmentModal(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveFromScale = async (escalaId: string, policemanId: string) => {
    if (!isAdmin) return;
    const escala = allEscalasOfMonth.find(e => e.id === escalaId);
    if (!escala) return;

    try {
      if (escala.policemenIds.length <= 1) {
        await deleteDoc(doc(db, 'escalas', escalaId));
      } else {
        await updateDoc(doc(db, 'escalas', escalaId), {
          policemenIds: escala.policemenIds.filter(id => id !== policemanId)
        });
      }
      fetchData();
      setAssignmentModal(null);
    } catch (err) {
      console.error(err);
    }
  };

  const filteredVolunteersList = volunteers.filter(v => {
    const term = searchTerm.toLowerCase();
    return v.policeman?.nomeGuerra.toLowerCase().includes(term) || v.policeman?.matricula.includes(term);
  });

  const totalPjesLimit = (unitQuotas?.pjesMPTotal || 0) + (unitQuotas?.pjesForumTotal || 0) + (unitQuotas?.pjesEscolarTotal || 0) + (unitQuotas?.pjesDecretoTotal || 0);
  const totalPjesUsed = currentUsage.PJES_MP + currentUsage.PJES_FORUM + currentUsage.PJES_ESCOLAR + currentUsage.PJES_DECRETO;

  if (!isAdmin) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center p-10 bg-white rounded-3xl shadow-xl border border-slate-100 max-w-sm">
        <Shield className="w-16 h-16 text-rose-500 mx-auto mb-6" />
        <h3 className="text-lg font-black text-pmpe-navy uppercase mb-2">Acesso Restrito</h3>
        <p className="text-xs font-bold text-slate-400 uppercase leading-relaxed">Você não possui permissões administrativas para gerenciar escalas.</p>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-100px)] overflow-hidden p-6 font-sans">
      
      {/* Left Panel: Operational Calendar */}
      <div className="col-span-12 lg:col-span-9 flex flex-col gap-6 overflow-hidden">
        
        {/* Calendar Header */}
        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-pmpe-navy rounded-2xl flex items-center justify-center shadow-lg shadow-pmpe-navy/20">
               <CalendarDays className="w-7 h-7 text-pmpe-gold" />
            </div>
            <div>
              <h2 className="text-xs font-black text-pmpe-navy uppercase tracking-[0.2em]">Calendário Operacional</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xl font-black text-slate-800 uppercase tracking-tighter">
                  {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                </span>
                <div className="flex items-center gap-1 ml-2">
                  <button 
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                  ><ChevronLeft className="w-4 h-4 text-slate-400" /></button>
                  <button 
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                  ><ChevronRight className="w-4 h-4 text-slate-400" /></button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
             <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Selecionar Policial..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-black outline-none focus:ring-4 focus:ring-pmpe-navy/5 w-64 transition-all uppercase"
                />
                
                {/* Search Dropdown */}
                {searchTerm && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 z-[60] overflow-hidden max-h-60 overflow-y-auto">
                    {filteredVolunteersList.length > 0 ? filteredVolunteersList.map(v => (
                      <button 
                        key={v.id}
                        onClick={() => {
                          setSelectedPMId(v.policemanId);
                          setSearchTerm('');
                        }}
                        className="w-full p-4 border-b border-slate-50 text-left hover:bg-pmpe-navy group flex items-center justify-between transition-colors"
                      >
                         <div>
                            <p className="text-[10px] font-black text-pmpe-navy group-hover:text-white uppercase">{v.policeman?.nomeGuerra}</p>
                            <p className="text-[9px] font-bold text-slate-400 group-hover:text-white/60 uppercase">{v.policeman?.matricula} • {v.policeman?.graduacaoPosto}</p>
                         </div>
                         <ArrowRight className="w-4 h-4 text-slate-200 group-hover:text-pmpe-gold" />
                      </button>
                    )) : (
                      <div className="p-4 text-center text-[9px] font-bold text-slate-400 uppercase italic">Nenhum PM voluntário encontrado</div>
                    )}
                  </div>
                )}
             </div>

             <div className="h-10 w-px bg-slate-100 mx-2" />

             {selectedPMId && (
               <div className="flex items-center gap-4 animate-in fade-in slide-in-from-right-4">
                  <div className="text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase">Editando Escala de:</p>
                    <p className="text-[11px] font-black text-pmpe-navy uppercase">{selectedVolunteer?.policeman?.nomeGuerra}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedPMId(null)}
                    className="w-10 h-10 bg-slate-100 hover:bg-rose-100 hover:text-rose-500 rounded-xl flex items-center justify-center transition-all shadow-sm"
                  ><X className="w-5 h-5" /></button>
               </div>
             )}
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="bg-white rounded-[40px] p-8 shadow-sm border border-slate-100 flex-1 overflow-auto relative">
          <div className="grid grid-cols-7 gap-3 h-full min-h-[600px]">
             {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
               <div key={d} className="text-center py-4">
                 <span className={cn(
                   "text-[10px] font-black uppercase tracking-widest",
                   d === 'Dom' || d === 'Sáb' ? "text-rose-400" : "text-slate-400"
                 )}>{d}</span>
               </div>
             ))}

             {calendarDays.map((day, i) => {
               const dayStr = format(day, 'yyyy-MM-dd');
               const isMonth = format(day, 'MM') === format(currentMonth, 'MM');
               const weekend = isWeekend(day);
               const holiday = HOLIDAYS_2026[dayStr];
               const dayNum = getDate(day);
               
               const ordinary = selectedPMId ? (ordinarySchedules[selectedPMId] || []).includes(dayNum) : false;
               const escalasToday = selectedPMId ? allEscalasOfMonth.filter(e => isSameDay(e.date.toDate(), day) && e.policemenIds.includes(selectedPMId)) : [];
               
               const isClickable = isMonth && selectedPMId && !ordinary && !loading;

               return (
                 <motion.div 
                   key={dayStr}
                   initial={{ opacity: 0, scale: 0.95 }}
                   animate={{ opacity: 1, scale: 1 }}
                   transition={{ delay: i * 0.005 }}
                   onClick={() => isClickable && setAssignmentModal({ policemanId: selectedPMId, date: day })}
                   className={cn(
                     "rounded-3xl border transition-all p-3 flex flex-col justify-between relative group overflow-hidden h-full min-h-[100px]",
                     !isMonth ? "bg-slate-50/30 border-transparent opacity-20" : "border-slate-50",
                     isClickable ? "cursor-pointer hover:shadow-xl hover:border-pmpe-navy/20 hover:-translate-y-1" : "cursor-default",
                     ordinary ? "bg-pmpe-navy/[0.03] border-pmpe-navy/10" : 
                     holiday ? "bg-rose-50 border-rose-100" : 
                     weekend ? "bg-rose-50/20 hover:bg-rose-50/40 border-rose-100/30" : "bg-white",
                     isToday(day) ? "ring-2 ring-pmpe-gold ring-offset-4" : ""
                   )}
                 >
                    <div className="flex justify-between items-start">
                       <span className={cn(
                         "text-[10px] font-black",
                         holiday ? "text-rose-600" : 
                         weekend ? "text-rose-400" : 
                         !isMonth ? "text-slate-300" : "text-pmpe-navy"
                       )}>{dayNum}</span>

                       {holiday && (
                         <div className="p-1 bg-rose-600 rounded-lg shadow-lg shadow-rose-200" title={holiday}>
                           <Zap className="w-2.5 h-2.5 text-white fill-current" />
                         </div>
                       )}
                    </div>

                    <div className="mt-2 space-y-1.5 min-h-[40px] flex flex-col justify-center">
                       {ordinary && isMonth && (
                         <div className="flex items-center gap-1.5 px-3 py-1 bg-pmpe-navy text-white rounded-xl w-fit shadow-md">
                            <Shield className="w-2.5 h-2.5 text-pmpe-gold" />
                            <span className="text-[9px] font-black uppercase tracking-tighter">ORD</span>
                         </div>
                       )}

                       {escalasToday.map(e => (
                         <div 
                           key={e.id} 
                           className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border w-full shadow-sm"
                           style={{ backgroundColor: (e.service?.color || '#000') + '15', borderColor: (e.service?.color || '#000') + '30', color: e.service?.color }}
                         >
                            <span className="text-[8.5px] font-black uppercase truncate">{e.service?.sigla}</span>
                         </div>
                       ))}

                       {!ordinary && escalasToday.length === 0 && isMonth && selectedPMId && (
                         <div className={cn(
                           "flex items-center justify-center w-full h-10 rounded-2xl border border-dashed transition-all",
                           "border-emerald-200 bg-emerald-50/50 group-hover:bg-emerald-100/50 group-hover:border-solid group-hover:border-emerald-400"
                         )}>
                            <span className="text-sm font-black text-emerald-600 group-hover:scale-125 transition-transform tracking-widest">0</span>
                         </div>
                       )}
                    </div>

                    {holiday && isMonth && (
                      <div className="absolute top-0 right-0 p-1 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20">
                         <div className="bg-rose-600 text-white text-[8px] font-black px-3 py-1.5 rounded-bl-2xl uppercase shadow-xl border border-white/20">
                           {holiday}
                         </div>
                      </div>
                    )}
                 </motion.div>
               );
             })}
          </div>

          {!selectedPMId && (
            <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-[40px]">
               <div className="text-center max-w-sm px-10 py-12 bg-white rounded-[48px] shadow-2xl border border-slate-100">
                  <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
                     <Users className="w-10 h-10 text-slate-300" />
                  </div>
                  <h3 className="text-sm font-black text-pmpe-navy uppercase mb-3 px-10">Agendamento Operacional</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase leading-relaxed">Selecione um Policial acima para gerenciar sua escala de serviço extra individual para este mês.</p>
                  <div className="mt-8 pt-8 border-t border-slate-50 flex items-center justify-center gap-6">
                     <div className="flex flex-col items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-[8px] font-black text-slate-400 uppercase">Livre</span>
                     </div>
                     <div className="flex flex-col items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-pmpe-navy" />
                        <span className="text-[8px] font-black text-slate-400 uppercase">Ordinário</span>
                     </div>
                     <div className="flex flex-col items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-rose-400" />
                        <span className="text-[8px] font-black text-slate-400 uppercase">Feriado</span>
                     </div>
                  </div>
               </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Operational Summary */}
      <div className="col-span-12 lg:col-span-3 flex flex-col gap-6 overflow-hidden">
        
        {/* Total Quota Progress */}
        <div className="bg-pmpe-navy rounded-[40px] p-8 shadow-xl shadow-pmpe-navy/20 text-white shrink-0">
           <div className="flex items-center gap-3 mb-8">
              <div className="p-2.5 bg-pmpe-gold/20 rounded-xl">
                 <BarChart3 className="w-5 h-5 text-pmpe-gold" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white/80">Monitor de Cotas</h3>
           </div>
           
           <div className="space-y-8">
              <div className="space-y-3">
                 <div className="flex justify-between items-end">
                    <span className="text-[9px] font-black uppercase text-white/40 tracking-widest">PJES Global</span>
                    <span className="text-xl font-black text-white">{totalPjesUsed}/{totalPjesLimit}</span>
                 </div>
                 <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(totalPjesUsed / (totalPjesLimit || 1)) * 100}%` }}
                      className={cn(
                        "h-full rounded-full transition-all duration-1000",
                        (totalPjesUsed / (totalPjesLimit || 1)) > 0.9 ? "bg-rose-500" : "bg-pmpe-gold"
                      )}
                    />
                 </div>
              </div>

              <div className="space-y-3">
                 <div className="flex justify-between items-end">
                    <span className="text-[9px] font-black uppercase text-white/40 tracking-widest">OPS Global</span>
                    <span className="text-xl font-black text-white">{currentUsage.OPS}/{unitQuotas?.opsTotal}</span>
                 </div>
                 <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(currentUsage.OPS / (unitQuotas?.opsTotal || 1)) * 100}%` }}
                      className={cn(
                        "h-full rounded-full transition-all duration-1000",
                        (currentUsage.OPS/ (unitQuotas?.opsTotal || 1)) > 0.9 ? "bg-rose-500" : "bg-emerald-400"
                      )}
                    />
                 </div>
              </div>
           </div>

           <div className="mt-10 pt-8 border-t border-white/10 grid grid-cols-2 gap-6">
              <div>
                <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Policiais Voluntários</p>
                <p className="text-lg font-black text-white">{volunteers.length}</p>
              </div>
              <div>
                <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Escalas do Mês</p>
                <p className="text-lg font-black text-white">{allEscalasOfMonth.length}</p>
              </div>
           </div>
        </div>

        {/* Services List / Available Services */}
        <div className="bg-white rounded-[40px] p-8 shadow-sm border border-slate-100 flex-1 overflow-hidden flex flex-col">
           <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-50 rounded-xl">
                   <Target className="w-5 h-5 text-pmpe-navy" />
                </div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-pmpe-navy">Serviços Ativos</h3>
              </div>
           </div>

           <div className="flex-1 overflow-y-auto space-y-3 scrollbar-none pr-1">
              {services.map(s => {
                const countToday = allEscalasOfMonth.filter(e => e.serviceTypeId === s.id && isToday(e.date.toDate())).reduce((acc, e) => acc + e.policemenIds.length, 0);
                const limit = s.vagasNecessarias || 0;
                
                return (
                  <div 
                    key={s.id} 
                    className="p-4 bg-slate-50 border border-slate-100 rounded-3xl group hover:border-pmpe-navy/20 transition-all flex items-center justify-between"
                  >
                     <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-inner" style={{ backgroundColor: s.color + '10', color: s.color }}>
                           <span className="text-[9px] font-black">{s.sigla}</span>
                        </div>
                        <div>
                           <p className="text-[10px] font-black text-pmpe-navy uppercase truncate w-32">{s.nome}</p>
                           <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">{s.horarioInicio} - {s.horarioTermino}</p>
                        </div>
                     </div>
                     <div className="text-right">
                        <p className="text-[10px] font-black text-slate-600">{countToday}/{limit || '∞'}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase">Hoje</p>
                     </div>
                  </div>
                );
              })}
           </div>

           <div className="mt-8 pt-8 border-t border-slate-50">
              <p className="text-[8px] font-bold text-slate-400 leading-relaxed uppercase italic">Passe o mouse por um dia livre para iniciar um novo lançamento operacional.</p>
           </div>
        </div>
      </div>

      {/* Modern Assignment Modal */}
      <AnimatePresence>
        {assignmentModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[48px] w-full max-w-lg overflow-hidden shadow-2xl border border-white/20"
            >
               <div className="p-10 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-pmpe-navy rounded-[24px] flex items-center justify-center shadow-2xl shadow-pmpe-navy/30 relative">
                       <Users className="w-8 h-8 text-pmpe-gold" />
                       <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg transform rotate-12">
                          <Check className="w-3 h-3 text-white" />
                       </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-pmpe-navy uppercase tracking-tight leading-none">{selectedVolunteer?.policeman?.nomeGuerra}</h3>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[9px] font-black bg-slate-200 text-slate-600 px-2.5 py-1 rounded-full uppercase">{selectedVolunteer?.policeman?.matricula}</span>
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                          <CalendarIcon className="w-3 h-3" /> 
                          {format(assignmentModal.date, "dd 'de' MMMM", { locale: ptBR })}
                        </div>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setAssignmentModal(null)} className="p-4 hover:bg-slate-200 rounded-[20px] transition-all shadow-sm"><X className="w-6 h-6 text-slate-400" /></button>
               </div>

               <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto scrollbar-none bg-white">
                  
                  {/* Current Scales on this Day for this PM */}
                  {(() => {
                    const scaled = allEscalasOfMonth.filter(e => 
                      isSameDay(e.date.toDate(), assignmentModal.date) && e.policemenIds.includes(assignmentModal.policemanId)
                    );
                    if (scaled.length > 0) {
                      return (
                        <div className="space-y-3">
                           <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Escalas Ativas no Dia</label>
                           {scaled.map(e => (
                             <div key={e.id} className="p-6 bg-slate-50 border border-slate-100 rounded-[32px] flex items-center justify-between shadow-inner">
                                <div className="flex items-center gap-4">
                                   <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm" style={{ color: e.service?.color }}>
                                      <span className="text-xs font-black">{e.service?.sigla}</span>
                                   </div>
                                   <div>
                                      <p className="text-[10px] font-black text-pmpe-navy uppercase tracking-widest">{e.service?.nome}</p>
                                      <p className="text-[11px] font-black text-rose-500 uppercase tracking-tighter mt-0.5">Remover deste Serviço?</p>
                                   </div>
                                </div>
                                <button 
                                  onClick={() => handleRemoveFromScale(e.id!, assignmentModal.policemanId)}
                                  className="w-12 h-12 bg-white text-rose-500 rounded-2xl shadow-md border border-rose-100 hover:bg-rose-500 hover:text-white transition-all transform active:scale-90 flex items-center justify-center"
                                ><Trash2 className="w-5 h-5" /></button>
                             </div>
                           ))}
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="space-y-4">
                     <div className="flex items-center justify-between px-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Serviços Disponíveis</label>
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 uppercase">Cotas Disponíveis</span>
                     </div>
                     <div className="grid grid-cols-1 gap-3">
                        {services.filter(s => {
                           const dStr = format(assignmentModal.date, 'yyyy-MM-dd');
                           const isActiveDay = s.activationType === 'ALL' || (s.activeDates || []).includes(dStr);
                           // Prevent double scale for same service
                           const alreadyIn = allEscalasOfMonth.some(e => e.serviceTypeId === s.id && isSameDay(e.date.toDate(), assignmentModal.date) && e.policemenIds.includes(assignmentModal.policemanId));
                           return isActiveDay && !alreadyIn;
                        }).map(s => {
                           const escToday = allEscalasOfMonth.find(e => e.serviceTypeId === s.id && isSameDay(e.date.toDate(), assignmentModal.date));
                           const pToday = escToday?.policemenIds.length || 0;
                           const target = s.vagasNecessarias || 0;
                           const isFull = target > 0 && pToday >= target;

                           return (
                             <button 
                               key={s.id}
                               disabled={submitting || isFull}
                               onClick={() => handleAssignService(s.id!)}
                               className={cn(
                                 "p-6 rounded-[32px] flex items-center justify-between group transition-all text-left shadow-lg bg-white border border-slate-100",
                                 isFull ? "opacity-50 grayscale cursor-not-allowed" : "hover:border-pmpe-navy/30 hover:bg-slate-50 hover:shadow-2xl active:scale-[0.98]"
                               )}
                             >
                                <div className="flex items-center gap-5">
                                   <div className="w-14 h-14 rounded-[20px] flex items-center justify-center shadow-xl transition-transform group-hover:scale-110" style={{ backgroundColor: s.color + '15', color: s.color, border: `1px solid ${s.color}20` }}>
                                      <span className="text-xs font-black">{s.sigla}</span>
                                   </div>
                                   <div>
                                      <p className="text-[12px] font-black text-pmpe-navy uppercase leading-tight mb-1">{s.nome}</p>
                                      <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                                          <Clock className="w-3 h-3" /> {s.horarioInicio} - {s.horarioTermino}
                                        </div>
                                        {s.cotasPorServico > 1 && (
                                          <span className="text-[8px] font-black bg-rose-50 text-rose-500 px-2 py-0.5 rounded-lg border border-rose-100">-{s.cotasPorServico} COTAS</span>
                                        )}
                                      </div>
                                   </div>
                                </div>
                                <div className="flex flex-col items-end gap-1.5">
                                   <div className={cn(
                                     "text-[10px] font-black px-4 py-1.5 rounded-2xl uppercase border flex items-center gap-2",
                                     isFull ? "bg-rose-50 text-rose-600 border-rose-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                                   )}>
                                      <Users className="w-3 h-3" />
                                      {pToday}/{target || '∞'}
                                   </div>
                                   {isFull && <span className="text-[7px] font-black text-rose-500 uppercase">LOTADO</span>}
                                </div>
                             </button>
                           );
                        })}
                     </div>
                  </div>
               </div>
               
               <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex gap-4">
                  <button 
                    onClick={() => setAssignmentModal(null)}
                    className="flex-1 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] hover:text-slate-600 transition-colors"
                  >Cancelar Agendamento</button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.8 }}
            className="fixed bottom-12 inset-x-0 mx-auto w-fit bg-pmpe-navy text-white px-10 py-6 rounded-[32px] shadow-2xl z-[150] flex items-center gap-6 border border-white/10"
          >
            <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-500/40">
               <CheckCircle2 className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-base font-black uppercase tracking-tight">Agendamento Realizado</p>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mt-1 italic">Sincronização com o sistema de cotas completa.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-matrix-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-matrix-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 20px; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
        
        input::placeholder { color: #94a3b8; font-weight: 900; letter-spacing: 0.05em; }
        
        @keyframes ring-pulse {
          0% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4); }
          100% { box-shadow: 0 0 0 10px rgba(251, 191, 36, 0); }
        }
        .ring-pmpe-gold { animation: ring-pulse 2s infinite; }
      `}</style>
    </div>
  );
};

export default CreateEscala;
