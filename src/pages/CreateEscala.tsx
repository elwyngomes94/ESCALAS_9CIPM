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
  Timestamp,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Policeman, ServiceType, Volunteer, Escala, QuotaSettings, QuotaLog } from '../types';
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
  Zap,
  Download,
  ShieldCheck,
  CheckCircle2
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
  subMonths
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
  const [filterType, setFilterType] = useState<'ALL' | 'PJES' | 'OPS'>('ALL');
  
  const [assignmentModal, setAssignmentModal] = useState<{
    policemanId: string;
    policemanName: string;
    policemanMat: string;
    day: number;
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

  const fetchData = async () => {
    setLoading(true);
    const mKey = format(currentMonth, 'yyyy-MM');
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    try {
      const sSnap = await getDocs(query(collection(db, 'serviceTypes')));
      const sData = sSnap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(),
        cotasPorServico: d.data().cotasPorServico ?? 1
      } as ServiceType));
      setServices(sData);

      const vSnap = await getDocs(query(collection(db, 'volunteers'), where('month', '==', mKey)));
      const polySnap = await getDocs(collection(db, 'policemen'));
      const polyData = polySnap.docs.reduce((acc, d) => {
        acc[d.id] = { id: d.id, ...d.data() } as Policeman;
        return acc;
      }, {} as Record<string, Policeman>);

      const vData = vSnap.docs.map(vDoc => {
        const v = { id: vDoc.id, ...vDoc.data() } as Volunteer;
        return { ...v, policeman: polyData[v.policemanId] };
      });
      setVolunteers(vData);

      const eSnap = await getDocs(query(
        collection(db, 'escalas'), 
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end))
      ));
      const eData = eSnap.docs.map(d => {
        const data = d.data() as Escala;
        return { 
          id: d.id, 
          ...data,
          service: sData.find(s => s.id === data.serviceTypeId)
        };
      });
      setAllEscalasOfMonth(eData);

      const ordSnap = await getDocs(query(collection(db, 'ordinarySchedules'), where('month', '==', mKey)));
      const oMap: Record<string, number[]> = {};
      ordSnap.docs.forEach(d => {
        const data = d.data();
        oMap[data.policemanId] = data.days || [];
      });
      setOrdinarySchedules(oMap);

      const settingsSnap = await getDocs(query(collection(db, 'quotaSettings'), where('month', '==', mKey)));
      let qSettings: QuotaSettings = { month: mKey, pjesMPTotal: 0, pjesForumTotal: 0, pjesEscolarTotal: 0, pjesDecretoTotal: 0, opsTotal: 0 };
      if (!settingsSnap.empty) {
        qSettings = { id: settingsSnap.docs[0].id, ...settingsSnap.docs[0].data() } as QuotaSettings;
      }
      setUnitQuotas(qSettings);

      const logsSnap = await getDocs(query(collection(db, 'quotaLogs'), where('month', '==', mKey)));
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

  const handleAssignService = async (serviceId: string) => {
    if (!assignmentModal || !isAdmin) return;
    const { policemanId, date } = assignmentModal;
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

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const filteredVolunteers = volunteers.filter(v => {
    const matchesSearch = !searchTerm || v.policeman?.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) || v.policeman?.matricula.includes(searchTerm);
    const matchesType = filterType === 'ALL' || v.type === filterType;
    return matchesSearch && matchesType;
  });

  if (!isAdmin) return <div className="text-center py-20 text-xs font-black uppercase text-slate-400 italic">Acesso restrito.</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden font-sans">
      {/* Matrix Toolbar */}
      <div className="bg-white border-b border-slate-200 p-4 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 shadow-sm z-10">
        <div className="flex flex-wrap items-center gap-4">
           <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
              <button 
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-1.5 bg-white shadow-sm border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
              ><ChevronLeft className="w-4 h-4 text-pmpe-navy" /></button>
              <div className="px-6 flex items-center min-w-[150px] justify-center">
                 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-pmpe-navy">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</span>
              </div>
              <button 
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-1.5 bg-white shadow-sm border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
              ><ChevronRight className="w-4 h-4 text-pmpe-navy" /></button>
           </div>
           
           <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pmpe-navy transition-colors" />
              <input 
                type="text"
                placeholder="Pesquisar por nome ou matrícula..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-bold outline-none focus:ring-4 focus:ring-pmpe-navy/5 w-72 transition-all"
              />
           </div>

           <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-200 shadow-inner">
              {['ALL', 'PJES', 'OPS'].map(t => (
                <button 
                  key={t}
                  onClick={() => setFilterType(t as any)}
                  className={cn(
                    "px-4 py-1.5 rounded-xl text-[9px] font-black uppercase transition-all",
                    filterType === t ? "bg-pmpe-navy text-white shadow-md" : "text-slate-400 hover:text-slate-600"
                  )}
                >{t === 'ALL' ? 'Todos' : t}</button>
              ))}
           </div>
        </div>

        <div className="flex items-center gap-2">
           <button className="flex items-center gap-2 px-5 py-2.5 bg-pmpe-navy text-white rounded-2xl text-[10px] font-black uppercase hover:bg-slate-800 transition-all shadow-lg shadow-pmpe-navy/10">
              <Download className="w-4 h-4 text-pmpe-gold" /> Exportar Planilha
           </button>
        </div>
      </div>

      {/* High-Density Matrix Table */}
      <div className="flex-1 overflow-auto bg-slate-50 custom-matrix-scroll p-1">
        <div className="min-w-fit bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full border-collapse text-[10px] relative">
            <thead className="sticky top-0 z-[30]">
              <tr className="bg-pmpe-navy text-white">
                <th className="sticky left-0 z-40 p-3 border-r border-white/10 w-12 text-center font-black uppercase tracking-tighter bg-pmpe-navy">Posto</th>
                <th className="sticky left-12 z-40 p-3 border-r border-white/10 w-20 text-center font-black uppercase tracking-tighter bg-pmpe-navy">Mat.</th>
                <th className="sticky left-32 z-40 p-3 border-r border-white/10 w-52 text-left font-black uppercase tracking-tighter bg-pmpe-navy">Efetivo Braçal</th>
                
                {/* Fixed Stats Columns (Gold) */}
                <th className="p-3 border-r border-white/10 w-14 text-center bg-pmpe-gold text-pmpe-navy font-black">SOLIC.</th>
                <th className="p-3 border-r border-white/10 w-14 text-center bg-pmpe-gold text-pmpe-navy font-black">DISP.</th>
                <th className="p-3 border-r border-white/10 w-14 text-center bg-emerald-600 font-black">ESCAL.</th>
                <th className="p-3 border-r border-white/10 w-14 text-center bg-rose-600 font-black">A ESC.</th>
                
                {/* Days Month Matrix */}
                {days.map(day => {
                  const isWknd = [0, 6].includes(day.getDay());
                  return (
                    <th 
                      key={day.toISOString()} 
                      className={cn(
                        "p-2 border-r border-white/10 min-w-[36px] text-center transition-colors",
                        isWknd ? "bg-slate-900" : "bg-pmpe-navy hover:bg-slate-800"
                      )}
                    >
                      <div className="flex flex-col items-center">
                        <span className="text-[7px] font-black opacity-40 mb-0.5">{format(day, 'EEE', { locale: ptBR }).toUpperCase()}</span>
                        <span className="font-black text-xs">{format(day, 'dd')}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={days.length + 7} className="p-20 text-center text-slate-400 font-bold uppercase italic tracking-[0.2em]">Sincronizando Matriz de Escalas...</td></tr>
              ) : filteredVolunteers.map(v => {
                const scaledOfMonth = allEscalasOfMonth.filter(e => e.policemenIds.includes(v.policemanId));
                const scaledCount = scaledOfMonth.length;
                const aEscalar = (v.cotas || 0) - scaledCount;

                return (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="sticky left-0 z-30 p-2 border-r border-slate-100 text-center font-black text-slate-400 bg-white group-hover:bg-slate-50">{v.policeman?.graduacaoPosto.substring(0, 3)}</td>
                    <td className="sticky left-12 z-30 p-2 border-r border-slate-100 text-center font-bold text-slate-400 bg-white group-hover:bg-slate-50">{v.policeman?.matricula}</td>
                    <td className="sticky left-32 z-30 p-2 border-r border-slate-100 font-black text-pmpe-navy uppercase pl-4 bg-white group-hover:bg-slate-50 truncate">{v.policeman?.nomeGuerra}</td>
                    
                    <td className="p-2 border-r border-slate-100 text-center font-black text-amber-600 bg-amber-50/30">{v.cotas}</td>
                    <td className="p-2 border-r border-slate-100 text-center font-bold text-slate-400 italic">12</td>
                    <td className="p-2 border-r border-slate-100 text-center font-black text-emerald-600 bg-emerald-50/50">{scaledCount}</td>
                    <td className={cn(
                      "p-2 border-r border-slate-100 text-center font-black",
                      aEscalar > 0 ? "text-rose-600 bg-rose-50/50" : "text-emerald-500"
                    )}>{aEscalar}</td>

                    {/* Matrix Cells */}
                    {days.map(date => {
                      const day = getDate(date);
                      const isOrd = (ordinarySchedules[v.policemanId] || []).includes(day);
                      const escToday = scaledOfMonth.find(e => isSameDay(e.date.toDate(), date));
                      
                      return (
                        <td 
                          key={date.toISOString()}
                          onClick={() => setAssignmentModal({
                            policemanId: v.policemanId,
                            policemanName: v.policeman?.nomeGuerra || 'PM',
                            policemanMat: v.policeman?.matricula || '',
                            day,
                            date
                          })}
                          className={cn(
                            "p-0 border-r border-slate-100 text-center cursor-pointer relative group-cell",
                            escToday ? "bg-opacity-10" : ""
                          )}
                          style={escToday?.service?.color ? { backgroundColor: escToday.service.color + '15' } : {}}
                        >
                          <div className="w-full h-9 flex items-center justify-center transition-all hover:bg-pmpe-navy/5 overflow-hidden">
                            {escToday ? (
                              <motion.span 
                                initial={{ scale: 0.8 }}
                                animate={{ scale: 1 }}
                                className="w-full h-full flex items-center justify-center font-black text-[9.5px] uppercase tracking-tighter"
                                style={{ color: escToday.service?.color || '#1e293b' }}
                              >
                                {escToday.service?.sigla || 'ESC'}
                              </motion.span>
                            ) : isOrd ? (
                              <span className="text-[10px] font-black text-slate-200 uppercase opacity-40">ORD</span>
                            ) : (
                              <span className="text-slate-100 font-bold group-cell-hover:text-slate-300">X</span>
                            )}
                            
                            {/* Hover Tooltip/Action */}
                            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-pmpe-gold scale-x-0 group-cell-hover:scale-x-100 transition-transform" />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Matrix Assignment Modal */}
      <AnimatePresence>
        {assignmentModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl border border-white/20"
            >
               <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-pmpe-navy rounded-2xl flex items-center justify-center shadow-lg shadow-pmpe-navy/20">
                       <Users className="w-7 h-7 text-pmpe-gold" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-pmpe-navy uppercase tracking-tight">{assignmentModal.policemanName}</h3>
                      <p className="text-[10px] font-bold text-slate-400 mt-1 flex items-center gap-2">
                        <CalendarIcon className="w-3 h-3" /> 
                        Dia {format(assignmentModal.date, "dd 'de' MMMM", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setAssignmentModal(null)} className="p-3 hover:bg-slate-200 rounded-2xl transition-all shadow-sm"><X className="w-5 h-5 text-slate-400" /></button>
               </div>

               <div className="p-8 space-y-6 max-h-[65vh] overflow-y-auto scrollbar-none bg-white">
                  {/* Active Scale Info */}
                  {(() => {
                    const scaled = allEscalasOfMonth.find(e => 
                      isSameDay(e.date.toDate(), assignmentModal.date) && e.policemenIds.includes(assignmentModal.policemanId)
                    );
                    if (scaled) {
                      return (
                        <div className="p-5 bg-rose-50 border border-rose-100 rounded-3xl flex items-center justify-between shadow-inner">
                           <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center border border-rose-100 shadow-sm animate-pulse">
                                 <AlertCircle className="w-6 h-6 text-rose-500" />
                              </div>
                              <div>
                                 <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Escalado em:</p>
                                 <p className="text-sm font-black text-pmpe-navy uppercase">{scaled.service?.nome}</p>
                              </div>
                           </div>
                           <button 
                             onClick={() => handleRemoveFromScale(scaled.id!, assignmentModal.policemanId)}
                             className="p-3 bg-white text-rose-500 rounded-xl shadow-md border border-rose-100 hover:bg-rose-500 hover:text-white transition-all transform active:scale-90"
                             title="Remover da escala"
                           ><Trash2 className="w-5 h-5" /></button>
                        </div>
                      );
                    }
                    return (
                      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-3xl flex items-center gap-4">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-500 shadow-sm">
                           <ShieldCheck className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-black text-emerald-600 uppercase">Policial livre para lançamento</p>
                      </div>
                    );
                  })()}

                  <div className="space-y-4">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 ml-1">Lançar Novo Serviço</label>
                     <div className="grid grid-cols-1 gap-3">
                        {services.filter(s => {
                           const dStr = format(assignmentModal.date, 'yyyy-MM-dd');
                           return s.activationType === 'ALL' || (s.activeDates || []).includes(dStr);
                        }).map(s => {
                           const escToday = allEscalasOfMonth.find(e => e.serviceTypeId === s.id && isSameDay(e.date.toDate(), assignmentModal.date));
                           const pToday = escToday?.policemenIds.length || 0;
                           const target = s.vagasNecessarias || 0;
                           const isFull = target > 0 && pToday >= target;

                           return (
                             <button 
                               key={s.id}
                               disabled={submitting}
                               onClick={() => handleAssignService(s.id!)}
                               className="p-5 bg-white border border-slate-100 rounded-[24px] flex items-center justify-between group hover:border-pmpe-navy/30 hover:bg-slate-50 transition-all text-left shadow-md hover:shadow-xl active:scale-[0.98]"
                             >
                                <div className="flex items-center gap-4">
                                   <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110" style={{ backgroundColor: s.color + '15', color: s.color, border: `1px solid ${s.color}20` }}>
                                      <span className="text-[10px] font-black">{s.sigla}</span>
                                   </div>
                                   <div>
                                      <p className="text-[11px] font-black text-slate-800 uppercase leading-tight mb-1 group-hover:text-pmpe-navy">{s.nome}</p>
                                      <p className="text-[9px] font-bold text-slate-400 flex items-center gap-1.5 uppercase">
                                        <Clock className="w-3 h-3" /> {s.horarioInicio} - {s.horarioTermino}
                                      </p>
                                   </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                   <span className={cn(
                                     "text-[10px] font-black px-3 py-1 rounded-full uppercase border",
                                     isFull ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                                   )}>
                                      {pToday}/{target || '∞'}
                                   </span>
                                </div>
                             </button>
                           );
                        })}
                     </div>
                  </div>
               </div>
               
               <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                  <button 
                    onClick={() => setAssignmentModal(null)}
                    className="flex-1 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                  >Fechar</button>
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
            className="fixed bottom-10 inset-x-0 mx-auto w-fit bg-pmpe-navy text-white px-8 py-5 rounded-[28px] shadow-2xl z-[150] flex items-center gap-5 border border-white/10"
          >
            <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
               <CheckCircle2 className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-tight">Escala de Serviço Salva</p>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-0.5 italic">Os dados foram sincronizados com a unidade.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-matrix-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .custom-matrix-scroll::-webkit-scrollbar-track { background: #f8fafc; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 20px; border: 3px solid #f8fafc; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        .group-cell:hover .group-cell-hover\\:text-slate-300 { color: #cbd5e1; }
        .group-cell:hover .group-cell-hover\\:scale-x-100 { transform: scaleX(1); }
        
        table th { letter-spacing: -0.02em; }
        table td { transition: background-color 0.2s; }
        
        /* Fixed Column Support */
        table th.sticky, table td.sticky { 
          position: sticky; 
          z-index: 10; 
        }
        table th.sticky[left="0"], table td.sticky[left="0"] { left: 0; }
        table th.sticky[left="48px"], table td.sticky[left="48px"] { left: 48px; }
        table th.sticky[left="128px"], table td.sticky[left="128px"] { left: 128px; }
      `}</style>
    </div>
  );
};

export default CreateEscala;
