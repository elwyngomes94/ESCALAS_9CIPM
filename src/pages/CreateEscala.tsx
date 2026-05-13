import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc,
  query, 
  where,
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
  BarChart3,
  Target,
  ArrowRight,
  Check,
  Zap,
  Shield,
  FileSpreadsheet
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
  isWeekend,
  isToday
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
  const [activeTab, setActiveTab] = useState<'PJES' | 'OPS'>('PJES');
  
  const [assignmentModal, setAssignmentModal] = useState<{
    policemanId: string;
    policemanName: string;
    policemanMat: string;
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

  const [serviceSearchTerm, setServiceSearchTerm] = useState('');

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
        cotasPorServico: d.data().cotasPorServico ?? d.data().cotasPorEscala ?? 1
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
    const hasAnyScale = allEscalasOfMonth.some(e => e.policemenIds.includes(v.policemanId));
    // Mirror scaled personnel in both tabs as requested
    const matchesTab = v.type === activeTab || hasAnyScale;
    return matchesSearch && matchesTab;
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
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden font-sans bg-slate-50">
      
      {/* Header Operational Toolbar */}
      <div className="bg-white border-b border-slate-200 p-6 flex flex-col md:flex-row items-center justify-between gap-6 shrink-0 shadow-sm z-30">
        <div className="flex flex-wrap items-center gap-6">
           <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
              <button 
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-2 bg-white shadow-sm border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
              ><ChevronLeft className="w-5 h-5 text-pmpe-navy" /></button>
              <div className="px-8 flex items-center min-w-[200px] justify-center">
                 <span className="text-xs font-black uppercase tracking-[0.2em] text-pmpe-navy">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</span>
              </div>
              <button 
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-2 bg-white shadow-sm border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
              ><ChevronRight className="w-5 h-5 text-pmpe-navy" /></button>
           </div>
           
           <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pmpe-navy transition-colors" />
              <input 
                type="text"
                placeholder="Pesquisar Policial na Matriz..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-black outline-none focus:ring-4 focus:ring-pmpe-navy/5 w-60 transition-all uppercase tracking-widest"
              />
           </div>

           {/* Tab Switcher */}
           <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button 
                onClick={() => setActiveTab('PJES')}
                className={cn(
                  "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'PJES' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                PJES
              </button>
              <button 
                onClick={() => setActiveTab('OPS')}
                className={cn(
                  "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'OPS' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                OPS
              </button>
           </div>
        </div>

        <div className="flex items-center gap-4">
           {/* Mini Stats in Header */}
           <div className="hidden xl:flex items-center gap-6 px-6 py-3 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="text-right">
                 <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Consumo PJES</p>
                 <p className="text-xs font-black text-pmpe-navy">{Math.round((totalPjesUsed / (totalPjesLimit || 1)) * 100)}%</p>
              </div>
              <div className="w-px h-6 bg-slate-200" />
              <div className="text-right">
                 <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Consumo OPS</p>
                 <p className="text-xs font-black text-pmpe-navy">{Math.round((currentUsage.OPS / (unitQuotas?.opsTotal || 1)) * 100)}%</p>
              </div>
           </div>

           <button className="flex items-center gap-3 px-6 py-3 bg-pmpe-navy text-white rounded-2xl text-[10px] font-black uppercase hover:bg-slate-800 transition-all shadow-xl shadow-pmpe-navy/10 border border-white/10 active:scale-95">
              <Download className="w-4 h-4 text-pmpe-gold" /> Exportar Matriz
           </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col p-6 gap-6">
        
        {/* Statistics Panels Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 shrink-0">
           <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-pmpe-navy/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
              <div className="p-3 bg-pmpe-navy rounded-2xl text-pmpe-gold relative z-10 shadow-lg shadow-pmpe-navy/20">
                 <Users className="w-5 h-5" />
              </div>
              <div className="relative z-10">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Efetivo {activeTab}</p>
                 <p className="text-xl font-black text-pmpe-navy">{filteredVolunteers.length}</p>
              </div>
           </div>
           
           <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
              <div className="p-3 bg-emerald-100 rounded-2xl text-emerald-600 border border-emerald-200 relative z-10 shadow-lg shadow-emerald-500/10">
                 <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="relative z-10">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Escalados {activeTab}</p>
                 <p className="text-xl font-black text-pmpe-navy">
                    {allEscalasOfMonth.filter(e => e.service?.tipo === activeTab).length}
                 </p>
              </div>
           </div>

           <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
              <div className="p-3 bg-rose-100 rounded-2xl text-rose-600 border border-rose-200 relative z-10 shadow-lg shadow-rose-500/10">
                 <Zap className="w-5 h-5" />
              </div>
              <div className="relative z-10">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Total {activeTab} Unidade</p>
                 <div className="flex items-baseline gap-1">
                    <p className="text-xl font-black text-pmpe-navy font-mono">
                       {activeTab === 'PJES' ? totalPjesUsed : currentUsage.OPS} 
                    </p>
                    <p className="text-[10px] font-bold text-slate-300"> / {activeTab === 'PJES' ? totalPjesLimit : unitQuotas?.opsTotal}</p>
                 </div>
              </div>
           </div>

           <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-pmpe-gold/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
              <div className="p-3 bg-pmpe-gold/20 rounded-2xl text-amber-600 border border-amber-200 relative z-10 shadow-lg shadow-pmpe-gold/20">
                 <Target className="w-5 h-5" />
              </div>
              <div className="relative z-10">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Saldo Disponível</p>
                 <p className="text-xl font-black text-emerald-600 font-mono">
                    {activeTab === 'PJES' ? (totalPjesLimit - totalPjesUsed) : ((unitQuotas?.opsTotal || 0) - currentUsage.OPS)}
                 </p>
              </div>
           </div>
        </div>

        {/* Operational Matrix Board */}
        <div className="flex-1 bg-white rounded-[32px] shadow-2xl border border-slate-100 overflow-hidden flex flex-col relative">
          
          <div className="flex-1 overflow-auto custom-matrix-scroll p-1">
            <table className="w-full border-separate border-spacing-0 text-[10px] font-sans">
              <thead className="sticky top-0 z-[20]">
                <tr className="bg-pmpe-navy text-white h-14">
                  {/* Fixed Columns Headers */}
                  <th className="sticky left-0 z-30 p-2 min-w-[48px] bg-pmpe-navy text-center font-black uppercase text-[8px] border-b-2 border-black">GRA.</th>
                  <th className="sticky left-[48px] z-30 p-2 min-w-[70px] bg-pmpe-navy text-center font-black uppercase text-[8px] border-b-2 border-black border-l-2 border-black">MAT.</th>
                  <th className="sticky left-[118px] z-30 p-4 min-w-[150px] bg-pmpe-navy text-left font-black uppercase text-[8px] border-b-2 border-black border-l-2 border-black">EFETIVO</th>
                  
                  {/* Stats Columns Headers */}
                  <th className="p-2 min-w-[48px] bg-pmpe-gold text-pmpe-navy font-black text-[7px] uppercase border-b-2 border-black text-center tracking-tighter">SOLIC.</th>
                  <th className="p-2 min-w-[48px] bg-pmpe-gold text-pmpe-navy font-black text-[7px] uppercase border-b-2 border-black text-center tracking-tighter">DISP.</th>
                  <th className="p-2 min-w-[48px] bg-emerald-600 font-black text-[7px] uppercase border-b-2 border-black text-center tracking-tighter">ESCAL.</th>
                  <th className="p-2 min-w-[48px] bg-rose-600 font-black text-[7px] uppercase border-b-2 border-black text-center tracking-tighter">A ESC.</th>
                  
                  {/* Days Multi-Column (Matrix) */}
                  {days.map(day => {
                    const isWknd = isWeekend(day);
                    return (
                      <th 
                        key={day.toISOString()} 
                        className={cn(
                          "min-w-[42px] p-1 border-b-2 border-black border-l-2 border-black text-center transition-colors",
                          isWknd ? "bg-red-600" : "bg-blue-700 hover:bg-blue-800"
                        )}
                      >
                         <div className="flex flex-col items-center">
                            <span className="text-[6px] font-black opacity-60 mb-0.5 leading-none uppercase">{format(day, 'EEE', { locale: ptBR })}</span>
                            <span className="text-[11px] font-black leading-none">{format(day, 'dd')}</span>
                         </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                   <tr>
                     <td colSpan={days.length + 7} className="p-32 text-center">
                        <div className="flex flex-col items-center gap-6">
                           <div className="w-16 h-16 border-4 border-pmpe-navy/10 border-t-pmpe-navy rounded-full animate-spin" />
                           <p className="text-sm font-black text-pmpe-navy uppercase tracking-[0.2em] animate-pulse">Processando Matriz Operacional...</p>
                        </div>
                     </td>
                   </tr>
                ) : filteredVolunteers.map(v => {
                  const scaledPMRecords = allEscalasOfMonth.filter(e => e.policemenIds.includes(v.policemanId));
                  const scaledCount = scaledPMRecords.length;
                  const solicted = v.cotas || 0;
                  const remaining = solicted - scaledCount;

                  return (
                    <tr key={v.id} className="h-10 hover:bg-slate-50 transition-colors group">
                      {/* Fixed ID Info */}
                      <td className="sticky left-0 z-10 p-2 bg-white group-hover:bg-slate-50 text-center font-black text-slate-400 border-r-2 border-b-2 border-black">{v.policeman?.graduacaoPosto.substring(0, 3)}</td>
                      <td className="sticky left-[48px] z-10 p-2 bg-white group-hover:bg-slate-50 text-center font-bold text-slate-400 border-r-2 border-b-2 border-black">{v.policeman?.matricula}</td>
                      <td className="sticky left-[118px] z-10 p-2 bg-white group-hover:bg-slate-50 font-black text-pmpe-navy uppercase pl-4 border-r-2 border-b-2 border-black truncate">
                         {v.policeman?.nomeGuerra}
                      </td>

                      {/* Stats Dynamic Columns */}
                      <td className="bg-amber-50/20 text-center font-black text-amber-600 border-r-2 border-b-2 border-black">{solicted}</td>
                      <td className="bg-slate-50/50 text-center font-bold text-slate-300 italic border-r-2 border-b-2 border-black">{days.length - (ordinarySchedules[v.policemanId]?.length || 0)}</td>
                      <td className="bg-emerald-50/50 text-center font-black text-emerald-600 border-r-2 border-b-2 border-black">{scaledCount}</td>
                      <td className={cn(
                        "text-center font-black border-r-2 border-b-2 border-black",
                        remaining > 0 ? "bg-rose-50/50 text-rose-600" : "bg-emerald-50 text-emerald-500"
                      )}>{remaining}</td>

                      {/* Matrix cells for each day */}
                      {days.map(date => {
                        const dayNum = getDate(date);
                        const isOrd = (ordinarySchedules[v.policemanId] || []).includes(dayNum);
                        const escala = scaledPMRecords.find(e => isSameDay(e.date.toDate(), date));
                        
                        return (
                          <td 
                            key={date.toISOString()}
                            onClick={() => !isOrd && setAssignmentModal({ 
                              policemanId: v.policemanId, 
                              policemanName: v.policeman?.nomeGuerra || 'PM',
                              policemanMat: v.policeman?.matricula || '',
                              date
                            })}
                            className={cn(
                              "relative p-0 border-r-2 border-b-2 border-black transition-all text-center",
                              !isOrd ? "cursor-pointer hover:bg-slate-200" : "bg-slate-800",
                              !escala && !isOrd ? "bg-slate-100/80" : ""
                            )}
                            style={escala?.service?.color ? { backgroundColor: escala.service.color } : {}}
                          >
                             <div className="w-full h-full flex items-center justify-center font-black text-[9px] uppercase tracking-tighter">
                                {escala ? (
                                  <motion.span 
                                    initial={{ scale: 0.8 }} 
                                    animate={{ scale: 1 }}
                                    className="text-white drop-shadow-sm px-1 truncate"
                                  >
                                    {escala.service?.sigla || 'ESC'}
                                  </motion.span>
                                ) : isOrd ? (
                                  <span className="text-white/30 text-[7px] font-black">ORD</span>
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center group-matrix-cell">
                                     <span className="text-[10px] font-bold text-slate-300">0</span>
                                  </div>
                                )}
                             </div>
                             
                             {!isOrd && (
                               <div className="absolute inset-x-0 bottom-0 h-0.5 bg-pmpe-navy scale-x-0 group-matrix-cell-hover:scale-x-100 transition-transform origin-center" />
                             )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Matrix Ledger / Legend Footer */}
          <div className="bg-slate-50 border-t border-slate-200 p-4 flex flex-wrap gap-6 items-center shrink-0">
             <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-600 rounded shadow-sm" />
                <span className="text-[9px] font-black text-slate-500 uppercase">Finais de Semana</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-700 rounded shadow-sm" />
                <span className="text-[9px] font-black text-slate-500 uppercase">Dias de Semana</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-slate-100 border border-slate-200 rounded shadow-sm flex items-center justify-center text-[8px] text-slate-300 font-bold">0</div>
                <span className="text-[9px] font-black text-slate-500 uppercase">Disponível para Escala</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-slate-800 rounded shadow-sm flex items-center justify-center text-[7px] text-white/40 font-black">ORD</div>
                <span className="text-[9px] font-black text-slate-500 uppercase">Serviço Ordinário</span>
             </div>
             <div className="ml-auto flex items-center gap-2">
                <span className="text-[9px] font-black text-pmpe-navy uppercase opacity-40 italic tracking-widest">Utilize as SIGLAS dos serviços para identificação.</span>
             </div>
          </div>

        </div>
      </div>

      {/* Advanced Selection Modal */}
      <AnimatePresence>
        {assignmentModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md">
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
                      <h3 className="text-lg font-black text-pmpe-navy uppercase tracking-tight leading-none">{assignmentModal.policemanName}</h3>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[9px] font-black bg-pmpe-navy/10 text-pmpe-navy px-2.5 py-1 rounded-full uppercase">{assignmentModal.policemanMat}</span>
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
                  
                  {/* Active Scale Info */}
                  {(() => {
                    const scaled = allEscalasOfMonth.filter(e => 
                      isSameDay(e.date.toDate(), assignmentModal.date) && e.policemenIds.includes(assignmentModal.policemanId)
                    );
                    if (scaled.length > 0) {
                      return (
                        <div className="space-y-3">
                           <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Lançamentos de Escala Existentes</label>
                           {scaled.map(e => (
                             <div key={e.id} className="p-6 bg-rose-50 border border-rose-100 rounded-[32px] flex items-center justify-between shadow-inner">
                                <div className="flex items-center gap-4">
                                   <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm" style={{ color: e.service?.color }}>
                                      <span className="text-xs font-black">{e.service?.sigla}</span>
                                   </div>
                                   <div>
                                      <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">{e.service?.nome}</p>
                                      <p className="text-[11px] font-black text-pmpe-navy uppercase tracking-tighter mt-0.5">Remover agendamento atual?</p>
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
                    return (
                        <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-3xl flex items-center gap-4 shadow-inner">
                           <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-500 shadow-sm border border-emerald-50">
                              <ShieldCheck className="w-6 h-6" />
                           </div>
                           <div className="flex-1">
                              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest leading-none mb-1">Status Disponível</p>
                              <p className="text-[11px] font-bold text-slate-400 uppercase leading-none italic">Nenhuma escala extra lançada para este dia.</p>
                           </div>
                        </div>
                    );
                  })()}

                  <div className="space-y-4">
                     <div className="flex flex-col gap-4 px-1">
                        <div className="flex items-center justify-between">
                           <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Serviços Ativos em {format(assignmentModal.date, 'dd/MM')}</label>
                           <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 uppercase italic">Selecione para Agendar</span>
                        </div>
                        
                        <div className="relative">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                           <input 
                             type="text"
                             placeholder="Filtrar Serviços (Sigla ou Nome)..."
                             value={serviceSearchTerm}
                             onChange={(e) => setServiceSearchTerm(e.target.value)}
                             className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-pmpe-navy/10 uppercase"
                           />
                        </div>
                     </div>

                     <div className="grid grid-cols-1 gap-3">
                        {services.filter(s => {
                           const dStr = format(assignmentModal.date, 'yyyy-MM-dd');
                           const isActiveDay = s.activationType === 'ALL' || (s.activeDates || []).includes(dStr);
                           const isAlreadyIn = allEscalasOfMonth.some(e => e.serviceTypeId === s.id && isSameDay(e.date.toDate(), assignmentModal.date) && e.policemenIds.includes(assignmentModal.policemanId));
                           const isCorrectType = s.tipo === activeTab;
                           const matchesSearch = !serviceSearchTerm || s.sigla.toLowerCase().includes(serviceSearchTerm.toLowerCase()) || s.nome.toLowerCase().includes(serviceSearchTerm.toLowerCase());
                           
                           return isActiveDay && !isAlreadyIn && isCorrectType && matchesSearch;
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
                                     "text-[10px] font-black px-4 py-1.5 rounded-2xl uppercase border flex items-center gap-2 transition-all",
                                     isFull ? "bg-rose-50 text-rose-600 border-rose-100" : "bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:bg-pmpe-navy group-hover:text-white"
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
                  >Fechar Gestor</button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Notification */}
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
              <p className="text-base font-black uppercase tracking-tight">Matriz Atualizada</p>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mt-1 italic">Lançamento operacional sincronizado com sucesso.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-matrix-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .custom-matrix-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 20px; border: 3px solid #fff; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }

        .group-matrix-cell:hover .group-matrix-cell-hover\\:opacity-100 { opacity: 1; }
        .group-matrix-cell:hover .group-matrix-cell-hover\\:text-slate-400 { color: #94a3b8; }
        .group-matrix-cell:hover .group-matrix-cell-hover\\:flex { display: flex; }
      `}</style>
    </div>
  );
};

export default CreateEscala;
